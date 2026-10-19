
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  primaryKey,
  unique,
  check,
  foreignKey,
  index,
  type AnyPgColumn
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";

export const planScope = pgEnum("plan_scope", [
  "account",
  "user"
]);

export const decisionStatus = pgEnum("decision_status", [
  "accepted",
  "rejected"
]);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerAccountId: uuid("owner_account_id").references(
      (): AnyPgColumn => accounts.id,
      { onDelete: "restrict" }
    ),

    scope: planScope("scope").notNull(),

    name: varchar("name", { length: 100 }).notNull(),

    monthlyAllowance: integer("monthly_allowance").notNull(),

    maxUnitsPerRequest: integer("max_units_per_request").notNull(),

    isPredefined: boolean("is_predefined")
      .notNull()
      .default(false),

    createdAt: timestamp("created_at", {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    check(
      "plans_positive_allowance",
      sql`${table.monthlyAllowance} > 0`
    ),
    check(
      "plans_positive_request_limit",
      sql`${table.maxUnitsPerRequest} > 0`
    ),
    check(
      "plans_request_within_allowance",
      sql`${table.maxUnitsPerRequest} <= ${table.monthlyAllowance}`
    ),
    check(
      "plans_ownership_consistency",
      sql`(
        ${table.isPredefined} = true
        AND ${table.ownerAccountId} IS NULL
      ) OR (
        ${table.isPredefined} = false
        AND ${table.ownerAccountId} IS NOT NULL
        AND ${table.scope} = 'user'
      )`
    ),
    index("plans_owner_account_id_idx").on(
      table.ownerAccountId
    )
  ]
);

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),

  name: varchar("name", { length: 120 }).notNull(),

  apiKeyPrefix: varchar("api_key_prefix", {
    length: 24
  }).notNull().unique(),

  apiKeyHash: varchar("api_key_hash", {
    length: 64
  }).notNull().unique(),

  apiKeyRevokedAt: timestamp("api_key_revoked_at", {
    withTimezone: true
  }),

  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, {
      onDelete: "restrict"
    }),

  createdAt: timestamp("created_at", {
    withTimezone: true
  }).notNull().defaultNow()
}, (table) => [
  check(
    "accounts_api_key_prefix_format",
    sql`${table.apiKeyPrefix} ~ '^fts_[a-f0-9]{20}$'`
  ),
  check(
    "accounts_api_key_hash_format",
    sql`${table.apiKeyHash} ~ '^[a-f0-9]{64}$'`
  )
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "cascade"
      }),

    name: varchar("name", { length: 120 }).notNull(),

    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, {
        onDelete: "restrict"
      }),

    createdAt: timestamp("created_at", {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    unique("users_account_id_id_unique").on(
      table.accountId,
      table.id
    ),
    index("users_account_id_idx").on(table.accountId),
    index("users_plan_id_idx").on(table.planId)
  ]
);

export const accountUsageCounters = pgTable(
  "account_usage_counters",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "cascade"
      }),

    monthStart: date("month_start", {
      mode: "string"
    }).notNull(),

    unitsConsumed: integer("units_consumed")
      .notNull()
      .default(0),

    updatedAt: timestamp("updated_at", {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [
        table.accountId,
        table.monthStart
      ]
    }),

    check(
      "account_usage_nonnegative",
      sql`${table.unitsConsumed} >= 0`
    )
  ]
);

export const userUsageCounters = pgTable(
  "user_usage_counters",
  {
    accountId: uuid("account_id").notNull(),

    userId: uuid("user_id").notNull(),

    monthStart: date("month_start", {
      mode: "string"
    }).notNull(),

    unitsConsumed: integer("units_consumed")
      .notNull()
      .default(0),

    updatedAt: timestamp("updated_at", {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [
        table.accountId,
        table.userId,
        table.monthStart
      ]
    }),

    foreignKey({
      columns: [
        table.accountId,
        table.userId
      ],
      foreignColumns: [
        users.accountId,
        users.id
      ]
    }).onDelete("cascade"),

    check(
      "user_usage_nonnegative",
      sql`${table.unitsConsumed} >= 0`
    )
  ]
);

export const usageRequests = pgTable(
  "usage_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),

    userId: uuid("user_id").notNull(),

    idempotencyKey: varchar("idempotency_key", {
      length: 200
    }).notNull(),

    requestHash: varchar("request_hash", {
      length: 64
    }).notNull(),

    requestedUnits: integer("requested_units").notNull(),

    decision: decisionStatus("decision").notNull(),

    rejectionReasons: jsonb("rejection_reasons")
      .notNull()
      .default(sql`'[]'::jsonb`),

    monthStart: date("month_start", {
      mode: "string"
    }).notNull(),

    accountNameSnapshot: varchar("account_name_snapshot", {
      length: 120
    }),

    userNameSnapshot: varchar("user_name_snapshot", {
      length: 120
    }),

    accountPlanIdSnapshot: uuid("account_plan_id_snapshot"),
    accountPlanNameSnapshot: varchar("account_plan_name_snapshot", {
      length: 100
    }),
    accountMonthlyAllowanceSnapshot: integer(
      "account_monthly_allowance_snapshot"
    ),
    accountMaxUnitsPerRequestSnapshot: integer(
      "account_max_units_per_request_snapshot"
    ),

    userPlanIdSnapshot: uuid("user_plan_id_snapshot"),
    userPlanNameSnapshot: varchar("user_plan_name_snapshot", {
      length: 100
    }),
    userMonthlyAllowanceSnapshot: integer(
      "user_monthly_allowance_snapshot"
    ),
    userMaxUnitsPerRequestSnapshot: integer(
      "user_max_units_per_request_snapshot"
    ),

    accountUsageBefore: integer("account_usage_before"),
    accountUsageAfter: integer("account_usage_after"),
    userUsageBefore: integer("user_usage_before"),
    userUsageAfter: integer("user_usage_after"),

    createdAt: timestamp("created_at", {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    unique("usage_requests_idempotency_unique").on(
      table.accountId,
      table.idempotencyKey
    ),

    foreignKey({
      columns: [
        table.accountId,
        table.userId
      ],
      foreignColumns: [
        users.accountId,
        users.id
      ]
    }).onDelete("restrict"),

    check(
      "usage_requests_positive_units",
      sql`${table.requestedUnits} > 0`
    ),
    check(
      "usage_requests_reasons_array",
      sql`jsonb_typeof(${table.rejectionReasons}) = 'array'`
    ),
    check(
      "usage_requests_snapshot_consistency",
      sql`(
        ${table.accountNameSnapshot} IS NULL
        AND ${table.userNameSnapshot} IS NULL
        AND ${table.accountPlanIdSnapshot} IS NULL
        AND ${table.accountPlanNameSnapshot} IS NULL
        AND ${table.accountMonthlyAllowanceSnapshot} IS NULL
        AND ${table.accountMaxUnitsPerRequestSnapshot} IS NULL
        AND ${table.userPlanIdSnapshot} IS NULL
        AND ${table.userPlanNameSnapshot} IS NULL
        AND ${table.userMonthlyAllowanceSnapshot} IS NULL
        AND ${table.userMaxUnitsPerRequestSnapshot} IS NULL
        AND ${table.accountUsageBefore} IS NULL
        AND ${table.accountUsageAfter} IS NULL
        AND ${table.userUsageBefore} IS NULL
        AND ${table.userUsageAfter} IS NULL
      ) OR (
        ${table.accountNameSnapshot} IS NOT NULL
        AND ${table.userNameSnapshot} IS NOT NULL
        AND ${table.accountPlanIdSnapshot} IS NOT NULL
        AND ${table.accountPlanNameSnapshot} IS NOT NULL
        AND ${table.accountMonthlyAllowanceSnapshot} IS NOT NULL
        AND ${table.accountMaxUnitsPerRequestSnapshot} IS NOT NULL
        AND ${table.userPlanIdSnapshot} IS NOT NULL
        AND ${table.userPlanNameSnapshot} IS NOT NULL
        AND ${table.userMonthlyAllowanceSnapshot} IS NOT NULL
        AND ${table.userMaxUnitsPerRequestSnapshot} IS NOT NULL
        AND ${table.accountUsageBefore} IS NOT NULL
        AND ${table.accountUsageAfter} IS NOT NULL
        AND ${table.userUsageBefore} IS NOT NULL
        AND ${table.userUsageAfter} IS NOT NULL
      )`
    ),
    check(
      "usage_requests_nonnegative_snapshots",
      sql`(
        ${table.accountUsageBefore} IS NULL
      ) OR (
        ${table.accountUsageBefore} >= 0
        AND ${table.accountUsageAfter} >= 0
        AND ${table.userUsageBefore} >= 0
        AND ${table.userUsageAfter} >= 0
      )`
    ),
    index("usage_requests_account_created_idx").on(
      table.accountId,
      table.createdAt
    ),
    index("usage_requests_account_user_month_idx").on(
      table.accountId,
      table.userId,
      table.monthStart
    )
  ]
);
