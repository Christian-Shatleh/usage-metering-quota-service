import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "../db/index.js";
import { plans } from "../db/schema.js";
import { authenticateAccount } from "../middleware/api-auth.js";
import { postgresPositiveInteger } from "../utils/validation.js";

export const customPlansRouter = Router();

const customPlanFields = z.object({
  name: z.string().trim().min(1).max(100),
  monthlyAllowance: postgresPositiveInteger,
  maxUnitsPerRequest: postgresPositiveInteger
}).strict();

const customPlanSchema = customPlanFields.refine(
  (value) => value.maxUnitsPerRequest <= value.monthlyAllowance,
  {
    message: "maxUnitsPerRequest cannot exceed monthlyAllowance",
    path: ["maxUnitsPerRequest"]
  }
);

const customPlanUpdateSchema = customPlanFields.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" }
);

customPlansRouter.post("/", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const parsed = customPlanSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid plan data",
      code: "validation_error",
      details: parsed.error.issues
    });
    return;
  }

  const [plan] = await db.insert(plans).values({
    ownerAccountId: account.id,
    scope: "user",
    name: parsed.data.name,
    monthlyAllowance: parsed.data.monthlyAllowance,
    maxUnitsPerRequest: parsed.data.maxUnitsPerRequest,
    isPredefined: false
  }).returning();

  res.status(201).json({ plan });
});

customPlansRouter.get("/", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const result = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.ownerAccountId, account.id),
        eq(plans.isPredefined, false),
        eq(plans.scope, "user")
      )
    )
    .orderBy(plans.createdAt);

  res.json({ plans: result });
});

customPlansRouter.get("/:id", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const planId = z.uuid().safeParse(req.params.id);
  if (!planId.success) {
    res.status(400).json({ error: "Invalid plan ID", code: "validation_error" });
    return;
  }

  const [plan] = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.id, planId.data),
        eq(plans.ownerAccountId, account.id),
        eq(plans.isPredefined, false),
        eq(plans.scope, "user")
      )
    )
    .limit(1);

  if (!plan) {
    res.status(404).json({ error: "Plan not found", code: "not_found" });
    return;
  }

  res.json({ plan });
});

customPlansRouter.patch("/:id", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const planId = z.uuid().safeParse(req.params.id);
  const body = customPlanUpdateSchema.safeParse(req.body);

  if (!planId.success || !body.success) {
    res.status(400).json({
      error: "Invalid plan update",
      code: "validation_error",
      details: body.success ? undefined : body.error.issues
    });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
      [account.id]
    );

    const currentResult = await client.query<{
      name: string;
      monthly_allowance: number;
      max_units_per_request: number;
    }>(
      `SELECT name, monthly_allowance, max_units_per_request
       FROM plans
       WHERE id = $1
         AND owner_account_id = $2
         AND is_predefined = false
         AND scope = 'user'
       FOR UPDATE`,
      [planId.data, account.id]
    );
    const current = currentResult.rows[0];

    if (!current) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Plan not found", code: "not_found" });
      return;
    }

    const inUse = await client.query(
      "SELECT 1 FROM users WHERE plan_id = $1 LIMIT 1",
      [planId.data]
    );

    if (inUse.rowCount) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "A plan assigned to a user cannot be edited",
        code: "plan_in_use"
      });
      return;
    }

    const next = {
      name: body.data.name ?? current.name,
      monthlyAllowance:
        body.data.monthlyAllowance ?? current.monthly_allowance,
      maxUnitsPerRequest:
        body.data.maxUnitsPerRequest ?? current.max_units_per_request
    };

    if (next.maxUnitsPerRequest > next.monthlyAllowance) {
      await client.query("ROLLBACK");
      res.status(400).json({
        error: "maxUnitsPerRequest cannot exceed monthlyAllowance",
        code: "validation_error"
      });
      return;
    }

    const updated = await client.query(
      `UPDATE plans
       SET name = $2,
           monthly_allowance = $3,
           max_units_per_request = $4
       WHERE id = $1
       RETURNING id, owner_account_id AS "ownerAccountId", scope, name,
                 monthly_allowance AS "monthlyAllowance",
                 max_units_per_request AS "maxUnitsPerRequest",
                 is_predefined AS "isPredefined", created_at AS "createdAt"`,
      [
        planId.data,
        next.name,
        next.monthlyAllowance,
        next.maxUnitsPerRequest
      ]
    );

    await client.query("COMMIT");
    res.json({ plan: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
