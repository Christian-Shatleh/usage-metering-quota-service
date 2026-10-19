
import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.js";
import { plans } from "../db/schema.js";
import { authenticateAccount } from "../middleware/api-auth.js";

export const plansRouter = Router();

plansRouter.get("/", async (req, res) => {
  const result = await db
    .select({
      id: plans.id,
      name: plans.name,
      scope: plans.scope,
      monthlyAllowance: plans.monthlyAllowance,
      maxUnitsPerRequest: plans.maxUnitsPerRequest
    })
    .from(plans)
    .where(eq(plans.isPredefined, true));

  res.json({
    plans: result
  });
});

plansRouter.get("/:id", async (req, res) => {
  const planId = z.uuid().safeParse(req.params.id);

  if (!planId.success) {
    res.status(400).json({ error: "Invalid plan ID", code: "validation_error" });
    return;
  }

  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.id, planId.data))
    .limit(1);

  if (!plan) {
    res.status(404).json({ error: "Plan not found", code: "not_found" });
    return;
  }

  if (!plan.isPredefined || plan.ownerAccountId !== null) {
    const account = await authenticateAccount(req);
    if (!account) {
      res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
      return;
    }
    if (plan.ownerAccountId !== account.id) {
      res.status(404).json({ error: "Plan not found", code: "not_found" });
      return;
    }
  }

  res.json({ plan });
});
