
import { Router } from "express";
import { z } from "zod";
import { and, eq, isNull , or} from "drizzle-orm";

import { db } from "../db/index.js";
import { plans, users } from "../db/schema.js";
import { authenticateAccount } from "../middleware/api-auth.js";

export const usersRouter = Router();

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  planId: z.uuid()
}).strict();

usersRouter.post("/", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createUserSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid user data",
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
        eq(plans.scope, "user"),
        eq(plans.isPredefined, true),
        isNull(plans.ownerAccountId)
      )
    )
    .limit(1);

  if (!plan) {
    res.status(400).json({
      error: "Invalid user plan"
    });
    return;
  }

  const [user] = await db
    .insert(users)
    .values({
      accountId: account.id,
      name: parsed.data.name,
      planId: plan.id
    })
    .returning();

  res.status(201).json({ user });
});

usersRouter.get("/", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.accountId, account.id));

  res.json({ users: result });
});

usersRouter.get("/:id", async (req, res) => {
  const account = await authenticateAccount(req);

  if (!account) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = z.uuid().safeParse(req.params.id);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, parsed.data),
        eq(users.accountId, account.id)
      )
    )
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ user });
});
