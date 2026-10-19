import { and, eq, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  accounts,
  accountUsageCounters,
  plans,
  users,
  userUsageCounters
} from "../db/schema.js";
import { getUtcMonthStart } from "../utils/billing-month.js";

export async function getUsageSummary(accountId: string) {
  const monthStart = getUtcMonthStart();
  const [account] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      monthlyAllowance: plans.monthlyAllowance,
      consumed: sql<number>`COALESCE(${accountUsageCounters.unitsConsumed}, 0)`.mapWith(Number)
    })
    .from(accounts)
    .innerJoin(plans, eq(accounts.planId, plans.id))
    .leftJoin(
      accountUsageCounters,
      and(
        eq(accountUsageCounters.accountId, accounts.id),
        eq(accountUsageCounters.monthStart, monthStart)
      )
    )
    .where(eq(accounts.id, accountId));

  if (!account) {
    return null;
  }

  const members = await db
    .select({
      id: users.id,
      name: users.name,
      monthlyAllowance: plans.monthlyAllowance,
      consumed: sql<number>`COALESCE(${userUsageCounters.unitsConsumed}, 0)`.mapWith(Number)
    })
    .from(users)
    .innerJoin(plans, eq(users.planId, plans.id))
    .leftJoin(
      userUsageCounters,
      and(
        eq(userUsageCounters.accountId, users.accountId),
        eq(userUsageCounters.userId, users.id),
        eq(userUsageCounters.monthStart, monthStart)
      )
    )
    .where(eq(users.accountId, accountId));

  return {
    monthStart,
    account: {
      ...account,
      remaining: Math.max(
        0,
        account.monthlyAllowance - account.consumed
      )
    },
    users: members.map((member) => ({
      ...member,
      remaining: Math.max(
        0,
        member.monthlyAllowance - member.consumed
      )
    }))
  };
}
