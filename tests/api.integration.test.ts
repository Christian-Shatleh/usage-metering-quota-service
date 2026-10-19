import { randomUUID } from "node:crypto";

import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import { createApp } from "../src/app.js";
import { pool } from "../src/db/index.js";
import { getUtcMonthStart } from "../src/utils/billing-month.js";

const app = createApp();
const bootstrapToken = "integration-test-bootstrap-token";

type SeedPlans = {
  account: string;
  userBasic: string;
  userPro: string;
};

let seededPlans: SeedPlans;

async function assertIsolatedDatabase() {
  const result = await pool.query<{ current_database: string }>(
    "SELECT current_database()"
  );
  expect(result.rows[0].current_database).toMatch(/_test$/);
}

async function resetDatabase() {
  await assertIsolatedDatabase();
  await pool.query(
    `TRUNCATE TABLE
       usage_requests,
       user_usage_counters,
       account_usage_counters,
       users,
       accounts,
       plans
     CASCADE`
  );

  const result = await pool.query<{
    id: string;
    scope: "account" | "user";
    name: string;
  }>(
    `INSERT INTO plans (
       scope, name, monthly_allowance,
       max_units_per_request, is_predefined
     ) VALUES
       ('account', 'Starter', 1000, 100, true),
       ('user', 'Basic', 100, 20, true),
       ('user', 'Pro', 500, 100, true)
     RETURNING id, scope, name`
  );

  seededPlans = {
    account: result.rows.find((row) => row.scope === "account")!.id,
    userBasic: result.rows.find((row) => row.name === "Basic")!.id,
    userPro: result.rows.find((row) => row.name === "Pro")!.id
  };
}

async function createAccount(name = "Test Account") {
  const response = await request(app)
    .post("/api/accounts/bootstrap")
    .set("x-bootstrap-token", bootstrapToken)
    .send({ name, planId: seededPlans.account });

  expect(response.status).toBe(201);
  expect(response.body.apiKey).toMatch(/^fts_[a-f0-9]{64}$/);
  return {
    id: response.body.account.id as string,
    apiKey: response.body.apiKey as string
  };
}

async function createUser(
  apiKey: string,
  name = "Test User",
  planId = seededPlans.userBasic
) {
  const response = await request(app)
    .post("/api/users")
    .set("x-api-key", apiKey)
    .send({ name, planId });

  expect(response.status).toBe(201);
  return response.body.user as { id: string; planId: string };
}

async function consume(
  apiKey: string,
  userId: string,
  units: number,
  idempotencyKey = randomUUID()
) {
  return request(app)
    .post("/api/usage/consume")
    .set("x-api-key", apiKey)
    .set("idempotency-key", idempotencyKey)
    .send({ userId, units });
}

beforeAll(assertIsolatedDatabase);
beforeEach(resetDatabase);
afterAll(async () => pool.end());

describe("FTS API integration", () => {
  it("bootstraps an account and enforces authentication", async () => {
    const invalidBootstrap = await request(app)
      .post("/api/accounts/bootstrap")
      .set("x-bootstrap-token", "wrong")
      .send({ name: "Nope", planId: seededPlans.account });
    expect(invalidBootstrap.status).toBe(401);

    const account = await createAccount();
    const missing = await request(app).get("/api/accounts/me");
    const invalid = await request(app)
      .get("/api/accounts/me")
      .set("x-api-key", `fts_${"0".repeat(64)}`);
    const valid = await request(app)
      .get("/api/accounts/me")
      .set("x-api-key", account.apiKey);

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(valid.status).toBe(200);
    expect(valid.body.account.id).toBe(account.id);
    expect(valid.body.account.plan.name).toBe("Starter");
  });

  it("manages users and custom plans with strict account isolation", async () => {
    const first = await createAccount("First");
    const second = await createAccount("Second");
    const user = await createUser(first.apiKey, "Alice");

    const custom = await request(app)
      .post("/api/plans/custom")
      .set("x-api-key", first.apiKey)
      .send({
        name: "Developer",
        monthlyAllowance: 250,
        maxUnitsPerRequest: 25
      });
    expect(custom.status).toBe(201);

    const secondCustom = await request(app)
      .post("/api/plans/custom")
      .set("x-api-key", second.apiKey)
      .send({
        name: "Private",
        monthlyAllowance: 300,
        maxUnitsPerRequest: 30
      });
    expect(secondCustom.status).toBe(201);

    const assignment = await request(app)
      .put(`/api/users/${user.id}/plan`)
      .set("x-api-key", first.apiKey)
      .send({ planId: custom.body.plan.id });
    expect(assignment.status).toBe(200);
    expect(assignment.body.user.planId).toBe(custom.body.plan.id);

    const crossPlan = await request(app)
      .put(`/api/users/${user.id}/plan`)
      .set("x-api-key", first.apiKey)
      .send({ planId: secondCustom.body.plan.id });
    expect(crossPlan.status).toBe(404);

    const crossUser = await request(app)
      .get(`/api/users/${user.id}`)
      .set("x-api-key", second.apiKey);
    expect(crossUser.status).toBe(404);

    const crossCustom = await request(app)
      .get(`/api/plans/custom/${custom.body.plan.id}`)
      .set("x-api-key", second.apiKey);
    expect(crossCustom.status).toBe(404);

    const editInUse = await request(app)
      .patch(`/api/plans/custom/${custom.body.plan.id}`)
      .set("x-api-key", first.apiKey)
      .send({ name: "Changed" });
    expect(editInUse.status).toBe(409);

    const listed = await request(app)
      .get("/api/users")
      .set("x-api-key", first.apiKey);
    expect(listed.status).toBe(200);
    expect(listed.body.users[0].plan.name).toBe("Developer");
  });

  it("records accepted and rejected usage with immutable snapshots", async () => {
    const account = await createAccount();
    const user = await createUser(account.apiKey, "Alice");

    const accepted = await consume(account.apiKey, user.id, 10);
    const rejected = await consume(account.apiKey, user.id, 30);

    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ accepted: true, replayed: false });
    expect(rejected.status).toBe(200);
    expect(rejected.body.accepted).toBe(false);
    expect(rejected.body.rejectionReasons).toContainEqual(
      expect.objectContaining({
        subject: "user",
        rule: "max_units_per_request"
      })
    );

    const summary = await request(app)
      .get("/api/usage/summary")
      .set("x-api-key", account.apiKey);
    expect(summary.body.monthStart).toBe(getUtcMonthStart());
    expect(summary.body.account.consumed).toBe(10);
    expect(summary.body.users[0].consumed).toBe(10);

    const history = await request(app)
      .get("/api/usage/history")
      .set("x-api-key", account.apiKey);
    expect(history.body.history).toHaveLength(2);
    expect(history.body.history[0]).toMatchObject({
      userName: "Alice",
      userPlanName: "Basic",
      accountPlanName: "Starter",
      userUsageBefore: 10,
      userUsageAfter: 10
    });
    expect(history.body.history[1]).toMatchObject({
      userUsageBefore: 0,
      userUsageAfter: 10
    });

    await expect(
      pool.query("DELETE FROM users WHERE id = $1", [user.id])
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("replays identical idempotency keys and rejects conflicting payloads", async () => {
    const account = await createAccount();
    const user = await createUser(account.apiKey);
    const key = randomUUID();

    const parallel = await Promise.all(
      Array.from({ length: 12 }, () =>
        consume(account.apiKey, user.id, 10, key)
      )
    );

    expect(parallel.every((response) => response.status === 200)).toBe(true);
    expect(parallel.filter((response) => !response.body.replayed)).toHaveLength(1);
    expect(parallel.every((response) => response.body.accepted)).toBe(true);

    const conflict = await consume(account.apiKey, user.id, 11, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("idempotency_conflict");

    const counter = await pool.query<{ units_consumed: number }>(
      "SELECT units_consumed FROM user_usage_counters WHERE user_id = $1",
      [user.id]
    );
    const history = await pool.query<{ count: string }>(
      "SELECT count(*) FROM usage_requests WHERE user_id = $1",
      [user.id]
    );
    expect(counter.rows[0].units_consumed).toBe(10);
    expect(Number(history.rows[0].count)).toBe(1);
  });

  it("accepts exactly ten of twenty simultaneous ten-unit requests", async () => {
    const account = await createAccount();
    const user = await createUser(account.apiKey);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        consume(account.apiKey, user.id, 10)
      )
    );
    const accepted = responses.filter((response) => response.body.accepted);
    const rejected = responses.filter((response) => !response.body.accepted);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(accepted).toHaveLength(10);
    expect(rejected).toHaveLength(10);

    const counter = await pool.query<{ units_consumed: number }>(
      "SELECT units_consumed FROM user_usage_counters WHERE user_id = $1",
      [user.id]
    );
    expect(counter.rows[0].units_consumed).toBe(100);
  });

  it("enforces account and per-user quotas across multiple concurrent users", async () => {
    const account = await createAccount();
    const alice = await createUser(account.apiKey, "Alice", seededPlans.userPro);
    const bob = await createUser(account.apiKey, "Bob", seededPlans.userPro);

    const responses = await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        consume(
          account.apiKey,
          index % 2 === 0 ? alice.id : bob.id,
          20
        )
      )
    );

    expect(responses.filter((response) => response.body.accepted)).toHaveLength(50);
    const counters = await pool.query<{ units_consumed: number }>(
      `SELECT units_consumed
       FROM user_usage_counters
       WHERE user_id IN ($1, $2)
       ORDER BY user_id`,
      [alice.id, bob.id]
    );
    expect(counters.rows).toHaveLength(2);
    expect(counters.rows.every((row) => row.units_consumed <= 500)).toBe(true);
    expect(counters.rows.reduce((sum, row) => sum + row.units_consumed, 0))
      .toBe(1000);
  });

  it("serializes plan assignment with consumption and audits one plan state", async () => {
    const account = await createAccount();
    const user = await createUser(account.apiKey, "Alice", seededPlans.userBasic);

    const [usageResponse, assignmentResponse] = await Promise.all([
      consume(account.apiKey, user.id, 50),
      request(app)
        .put(`/api/users/${user.id}/plan`)
        .set("x-api-key", account.apiKey)
        .send({ planId: seededPlans.userPro })
    ]);

    expect(assignmentResponse.status).toBe(200);
    expect(usageResponse.status).toBe(200);

    const audit = await pool.query<{
      user_plan_id_snapshot: string;
      decision: "accepted" | "rejected";
    }>(
      `SELECT user_plan_id_snapshot, decision
       FROM usage_requests
       WHERE user_id = $1`,
      [user.id]
    );
    expect(audit.rows).toHaveLength(1);

    if (audit.rows[0].user_plan_id_snapshot === seededPlans.userBasic) {
      expect(audit.rows[0].decision).toBe("rejected");
    } else {
      expect(audit.rows[0].user_plan_id_snapshot).toBe(seededPlans.userPro);
      expect(audit.rows[0].decision).toBe("accepted");
    }
  });

  it("rotates and revokes API keys without storing plaintext", async () => {
    const account = await createAccount();
    const rotated = await request(app)
      .post("/api/accounts/api-key/rotate")
      .set("x-api-key", account.apiKey);
    expect(rotated.status).toBe(200);
    expect(rotated.body.apiKey).toMatch(/^fts_[a-f0-9]{64}$/);

    const oldKey = await request(app)
      .get("/api/accounts/me")
      .set("x-api-key", account.apiKey);
    const newKey = await request(app)
      .get("/api/accounts/me")
      .set("x-api-key", rotated.body.apiKey);
    expect(oldKey.status).toBe(401);
    expect(newKey.status).toBe(200);

    const stored = await pool.query<{ plaintext_matches: boolean }>(
      `SELECT api_key_hash = $2 AS plaintext_matches
       FROM accounts WHERE id = $1`,
      [account.id, rotated.body.apiKey]
    );
    expect(stored.rows[0].plaintext_matches).toBe(false);

    const revoked = await request(app)
      .post("/api/accounts/api-key/revoke")
      .set("x-api-key", rotated.body.apiKey);
    expect(revoked.status).toBe(204);

    const afterRevocation = await request(app)
      .get("/api/accounts/me")
      .set("x-api-key", rotated.body.apiKey);
    expect(afterRevocation.status).toBe(401);
  });

  it("validates integer bounds and cross-account consumption", async () => {
    const first = await createAccount("First");
    const second = await createAccount("Second");
    const user = await createUser(first.apiKey);

    for (const units of [0, -1, 1.5, 2_147_483_648]) {
      const response = await consume(first.apiKey, user.id, units);
      expect(response.status).toBe(400);
    }

    const crossAccount = await consume(second.apiKey, user.id, 1);
    expect(crossAccount.status).toBe(404);
  });
});
