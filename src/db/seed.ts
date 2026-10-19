
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, isNull } from "drizzle-orm";

import { plans } from "./schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const db = drizzle(pool);

const predefinedPlans = [
  {
    name: "Starter",
    scope: "account" as const,
    monthlyAllowance: 1000,
    maxUnitsPerRequest: 100
  },
  {
    name: "Business",
    scope: "account" as const,
    monthlyAllowance: 10000,
    maxUnitsPerRequest: 500
  },
  {
    name: "Basic",
    scope: "user" as const,
    monthlyAllowance: 100,
    maxUnitsPerRequest: 20
  },
  {
    name: "Pro",
    scope: "user" as const,
    monthlyAllowance: 500,
    maxUnitsPerRequest: 100
  }
];

async function seed() {
  for (const plan of predefinedPlans) {
    const [existing] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(
        and(
          eq(plans.name, plan.name),
          eq(plans.scope, plan.scope),
          eq(plans.isPredefined, true),
          isNull(plans.ownerAccountId)
        )
      )
      .limit(1);

    if (existing) {
      console.log(`${plan.name} already exists`);
      continue;
    }

    await db.insert(plans).values({
      ...plan,
      isPredefined: true
    });

    console.log(`Created plan: ${plan.name}`);
  }
}

seed()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
