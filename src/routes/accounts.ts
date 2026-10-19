import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "../db/index.js";
import { accounts, plans } from "../db/schema.js";
import { authenticateAccount } from "../middleware/api-auth.js";
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey
} from "../utils/api-key.js";

export const accountsRouter = Router();

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  planId: z.uuid()
}).strict();

accountsRouter.post("/bootstrap", async (req, res) => {
  const expectedToken = process.env.BOOTSTRAP_TOKEN;
  const suppliedToken = req.header("x-bootstrap-token");

  if (!expectedToken) {
    res.status(503).json({
      error: "Account bootstrap is not configured",
      code: "bootstrap_unavailable"
    });
    return;
  }

  if (
    !suppliedToken ||
    !verifyApiKey(suppliedToken, hashApiKey(expectedToken))
  ) {
    res.status(401).json({
      error: "Invalid bootstrap token",
      code: "unauthorized"
    });
    return;
  }

  const parsed = createAccountSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid account data",
      code: "validation_error",
      details: parsed.error.issues
    });
    return;
  }

  const [plan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        eq(plans.id, parsed.data.planId),
        eq(plans.scope, "account"),
        eq(plans.isPredefined, true),
        isNull(plans.ownerAccountId)
      )
    )
    .limit(1);

  if (!plan) {
    res.status(400).json({
      error: "Invalid account plan",
      code: "invalid_plan"
    });
    return;
  }

  const apiKey = generateApiKey();

  const [account] = await db
    .insert(accounts)
    .values({
      name: parsed.data.name,
      planId: plan.id,
      apiKeyPrefix: apiKey.slice(0, 24),
      apiKeyHash: hashApiKey(apiKey)
    })
    .returning({
      id: accounts.id,
      name: accounts.name,
      planId: accounts.planId,
      createdAt: accounts.createdAt
    });

  res.status(201).json({ account, apiKey });
});

accountsRouter.get("/me", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const [result] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      createdAt: accounts.createdAt,
      plan: {
        id: plans.id,
        name: plans.name,
        monthlyAllowance: plans.monthlyAllowance,
        maxUnitsPerRequest: plans.maxUnitsPerRequest
      }
    })
    .from(accounts)
    .innerJoin(plans, eq(accounts.planId, plans.id))
    .where(eq(accounts.id, account.id))
    .limit(1);

  if (!result) {
    res.status(404).json({ error: "Account not found", code: "not_found" });
    return;
  }

  res.json({ account: result });
});

accountsRouter.post("/api-key/rotate", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const suppliedKey = req.header("x-api-key")!;
  const newKey = generateApiKey();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const locked = await client.query<{
      api_key_hash: string;
      api_key_revoked_at: Date | null;
    }>(
      `SELECT api_key_hash, api_key_revoked_at
       FROM accounts
       WHERE id = $1
       FOR UPDATE`,
      [account.id]
    );
    const current = locked.rows[0];

    if (
      !current ||
      current.api_key_revoked_at ||
      !verifyApiKey(suppliedKey, current.api_key_hash)
    ) {
      await client.query("ROLLBACK");
      res.status(401).json({
        error: "Credential is no longer current",
        code: "unauthorized"
      });
      return;
    }

    await client.query(
      `UPDATE accounts
       SET api_key_prefix = $2,
           api_key_hash = $3,
           api_key_revoked_at = NULL
       WHERE id = $1`,
      [account.id, newKey.slice(0, 24), hashApiKey(newKey)]
    );
    await client.query("COMMIT");

    res.json({
      apiKey: newKey,
      message: "API key rotated; the previous key is no longer valid"
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

accountsRouter.post("/api-key/revoke", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const suppliedKey = req.header("x-api-key")!;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const locked = await client.query<{
      api_key_hash: string;
      api_key_revoked_at: Date | null;
    }>(
      `SELECT api_key_hash, api_key_revoked_at
       FROM accounts
       WHERE id = $1
       FOR UPDATE`,
      [account.id]
    );
    const current = locked.rows[0];

    if (
      !current ||
      current.api_key_revoked_at ||
      !verifyApiKey(suppliedKey, current.api_key_hash)
    ) {
      await client.query("ROLLBACK");
      res.status(401).json({
        error: "Credential is no longer current",
        code: "unauthorized"
      });
      return;
    }

    await client.query(
      `UPDATE accounts
       SET api_key_revoked_at = now()
       WHERE id = $1`,
      [account.id]
    );
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
