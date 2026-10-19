import { createHash } from "node:crypto";

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "../db/index.js";
import { usageRequests } from "../db/schema.js";
import { authenticateAccount } from "../middleware/api-auth.js";
import {
  evaluateQuota,
  type QuotaRejectionReason
} from "../rules/evaluate.js";
import { getUsageSummary } from "../services/usage-report.js";
import {
  idempotencyKeySchema,
  postgresPositiveInteger
} from "../utils/validation.js";
import { verifyApiKey } from "../utils/api-key.js";

export const usageRouter = Router();

const consumeSchema = z.object({
  userId: z.uuid(),
  units: postgresPositiveInteger
}).strict();

type StoredRequest = {
  request_hash: string;
  decision: "accepted" | "rejected";
  rejection_reasons: QuotaRejectionReason[];
};

type QuotaDetails = {
  account_name: string;
  user_name: string;
  account_plan_id: string;
  account_plan_name: string;
  account_monthly_allowance: number;
  account_max_units_per_request: number;
  user_plan_id: string;
  user_plan_name: string;
  user_monthly_allowance: number;
  user_max_units_per_request: number;
};

function hashRequest(userId: string, units: number) {
  return createHash("sha256")
    .update(JSON.stringify({ userId, units }))
    .digest("hex");
}

usageRouter.post("/consume", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const idempotency = idempotencyKeySchema.safeParse(
    req.header("idempotency-key")?.trim()
  );

  if (!idempotency.success) {
    res.status(400).json({
      error: "A valid idempotency-key header is required",
      code: "validation_error"
    });
    return;
  }

  const parsed = consumeSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid usage request",
      code: "validation_error",
      details: parsed.error.issues
    });
    return;
  }

  const { userId, units } = parsed.data;
  const idempotencyKey = idempotency.data;
  const requestHash = hashRequest(userId, units);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Account is always the first lock for account-scoped writes. This makes
    // quota decisions, assignments, custom-plan edits, and rotations serial.
    const lockedAccount = await client.query<{
      api_key_hash: string;
    }>(
      `SELECT api_key_hash
       FROM accounts
       WHERE id = $1 AND api_key_revoked_at IS NULL
       FOR UPDATE`,
      [account.id]
    );

    if (
      lockedAccount.rowCount !== 1 ||
      !verifyApiKey(
        req.header("x-api-key")!,
        lockedAccount.rows[0].api_key_hash
      )
    ) {
      await client.query("ROLLBACK");
      res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
      return;
    }

    const previousResult = await client.query<StoredRequest>(
      `SELECT request_hash, decision, rejection_reasons
       FROM usage_requests
       WHERE account_id = $1 AND idempotency_key = $2`,
      [account.id, idempotencyKey]
    );
    const previous = previousResult.rows[0];

    if (previous) {
      if (previous.request_hash !== requestHash) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "Idempotency key was already used for a different request",
          code: "idempotency_conflict"
        });
        return;
      }

      await client.query("COMMIT");
      res.json({
        accepted: previous.decision === "accepted",
        rejectionReasons: previous.rejection_reasons,
        replayed: true
      });
      return;
    }

    // The user is the second lock. Every writer follows account -> user.
    const quotaResult = await client.query<QuotaDetails>(
      `SELECT
         accounts.name AS account_name,
         users.name AS user_name,
         account_plan.id AS account_plan_id,
         account_plan.name AS account_plan_name,
         account_plan.monthly_allowance AS account_monthly_allowance,
         account_plan.max_units_per_request AS account_max_units_per_request,
         user_plan.id AS user_plan_id,
         user_plan.name AS user_plan_name,
         user_plan.monthly_allowance AS user_monthly_allowance,
         user_plan.max_units_per_request AS user_max_units_per_request
       FROM accounts
       JOIN plans AS account_plan ON account_plan.id = accounts.plan_id
       JOIN users ON users.account_id = accounts.id AND users.id = $2
       JOIN plans AS user_plan ON user_plan.id = users.plan_id
       WHERE accounts.id = $1
       FOR UPDATE OF users`,
      [account.id, userId]
    );
    const quota = quotaResult.rows[0];

    if (!quota) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "User not found", code: "not_found" });
      return;
    }

    const monthResult = await client.query<{ month_start: string }>(
      `SELECT date_trunc(
         'month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
       )::date::text AS month_start`
    );
    const monthStart = monthResult.rows[0].month_start;

    const accountCounterResult = await client.query<{
      units_consumed: number;
    }>(
      `SELECT units_consumed
       FROM account_usage_counters
       WHERE account_id = $1 AND month_start = $2`,
      [account.id, monthStart]
    );
    const userCounterResult = await client.query<{
      units_consumed: number;
    }>(
      `SELECT units_consumed
       FROM user_usage_counters
       WHERE account_id = $1 AND user_id = $2 AND month_start = $3`,
      [account.id, userId, monthStart]
    );

    const accountBefore = accountCounterResult.rows[0]?.units_consumed ?? 0;
    const userBefore = userCounterResult.rows[0]?.units_consumed ?? 0;
    const rejectionReasons = evaluateQuota(
      units,
      {
        monthlyAllowance: quota.account_monthly_allowance,
        maxUnitsPerRequest: quota.account_max_units_per_request,
        consumed: accountBefore
      },
      {
        monthlyAllowance: quota.user_monthly_allowance,
        maxUnitsPerRequest: quota.user_max_units_per_request,
        consumed: userBefore
      }
    );

    const accepted = rejectionReasons.length === 0;
    const accountAfter = accepted ? accountBefore + units : accountBefore;
    const userAfter = accepted ? userBefore + units : userBefore;

    if (accepted) {
      await client.query(
        `INSERT INTO account_usage_counters
           (account_id, month_start, units_consumed)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, month_start)
         DO UPDATE SET
           units_consumed = account_usage_counters.units_consumed
             + EXCLUDED.units_consumed,
           updated_at = now()`,
        [account.id, monthStart, units]
      );

      await client.query(
        `INSERT INTO user_usage_counters
           (account_id, user_id, month_start, units_consumed)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, user_id, month_start)
         DO UPDATE SET
           units_consumed = user_usage_counters.units_consumed
             + EXCLUDED.units_consumed,
           updated_at = now()`,
        [account.id, userId, monthStart, units]
      );
    }

    await client.query(
      `INSERT INTO usage_requests (
         account_id, user_id, idempotency_key, request_hash,
         requested_units, decision, rejection_reasons, month_start,
         account_name_snapshot, user_name_snapshot,
         account_plan_id_snapshot, account_plan_name_snapshot,
         account_monthly_allowance_snapshot,
         account_max_units_per_request_snapshot,
         user_plan_id_snapshot, user_plan_name_snapshot,
         user_monthly_allowance_snapshot,
         user_max_units_per_request_snapshot,
         account_usage_before, account_usage_after,
         user_usage_before, user_usage_after
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8,
         $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
         $19, $20, $21, $22
       )`,
      [
        account.id,
        userId,
        idempotencyKey,
        requestHash,
        units,
        accepted ? "accepted" : "rejected",
        JSON.stringify(rejectionReasons),
        monthStart,
        quota.account_name,
        quota.user_name,
        quota.account_plan_id,
        quota.account_plan_name,
        quota.account_monthly_allowance,
        quota.account_max_units_per_request,
        quota.user_plan_id,
        quota.user_plan_name,
        quota.user_monthly_allowance,
        quota.user_max_units_per_request,
        accountBefore,
        accountAfter,
        userBefore,
        userAfter
      ]
    );

    await client.query("COMMIT");
    res.json({ accepted, rejectionReasons, replayed: false });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

usageRouter.get("/summary", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const summary = await getUsageSummary(account.id);

  if (!summary) {
    res.status(404).json({ error: "Account not found", code: "not_found" });
    return;
  }

  res.json(summary);
});

usageRouter.get("/history", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const history = await db
    .select({
      id: usageRequests.id,
      userId: usageRequests.userId,
      userName: usageRequests.userNameSnapshot,
      requestedUnits: usageRequests.requestedUnits,
      decision: usageRequests.decision,
      rejectionReasons: usageRequests.rejectionReasons,
      monthStart: usageRequests.monthStart,
      accountPlanName: usageRequests.accountPlanNameSnapshot,
      userPlanName: usageRequests.userPlanNameSnapshot,
      accountUsageBefore: usageRequests.accountUsageBefore,
      accountUsageAfter: usageRequests.accountUsageAfter,
      userUsageBefore: usageRequests.userUsageBefore,
      userUsageAfter: usageRequests.userUsageAfter,
      createdAt: usageRequests.createdAt
    })
    .from(usageRequests)
    .where(eq(usageRequests.accountId, account.id))
    .orderBy(desc(usageRequests.createdAt))
    .limit(50);

  res.json({ history });
});
