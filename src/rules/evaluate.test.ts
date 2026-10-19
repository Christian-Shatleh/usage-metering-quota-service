import { describe, expect, it } from "vitest";

import { evaluateQuota } from "./evaluate.js";

describe("Quota Evaluation", () => {
  it("accepts a valid request", () => {
    const reasons = evaluateQuota(
      10,
      {
        monthlyAllowance: 1000,
        maxUnitsPerRequest: 100,
        consumed: 100
      },
      {
        monthlyAllowance: 100,
        maxUnitsPerRequest: 20,
        consumed: 20
      }
    );

    expect(reasons).toEqual([]);
  });

  it("rejects a request exceeding the user allowance", () => {
    const reasons = evaluateQuota(
      20,
      {
        monthlyAllowance: 1000,
        maxUnitsPerRequest: 100,
        consumed: 100
      },
      {
        monthlyAllowance: 100,
        maxUnitsPerRequest: 20,
        consumed: 90
      }
    );

    expect(reasons).toContainEqual({
      subject: "user",
      rule: "monthly_allowance",
      limit: 100,
      actual: 110
    });
  });

  it("allows consumption exactly at the limit", () => {
    const reasons = evaluateQuota(
      10,
      {
        monthlyAllowance: 1000,
        maxUnitsPerRequest: 100,
        consumed: 990
      },
      {
        monthlyAllowance: 100,
        maxUnitsPerRequest: 20,
        consumed: 90
      }
    );

    expect(reasons).toHaveLength(0);
  });

  it("rejects when both monthly limits are exceeded", () => {
    const reasons = evaluateQuota(
      20,
      {
        monthlyAllowance: 1000,
        maxUnitsPerRequest: 100,
        consumed: 990
      },
      {
        monthlyAllowance: 100,
        maxUnitsPerRequest: 20,
        consumed: 90
      }
    );

    expect(reasons).toHaveLength(2);
  });

  it("reports both per-request limits independently", () => {
    const reasons = evaluateQuota(
      101,
      {
        monthlyAllowance: 1000,
        maxUnitsPerRequest: 100,
        consumed: 0
      },
      {
        monthlyAllowance: 500,
        maxUnitsPerRequest: 50,
        consumed: 0
      }
    );

    expect(reasons).toEqual([
      {
        subject: "account",
        rule: "max_units_per_request",
        limit: 100,
        actual: 101
      },
      {
        subject: "user",
        rule: "max_units_per_request",
        limit: 50,
        actual: 101
      }
    ]);
  });

  it("returns all four reasons when every limit is exceeded", () => {
    const reasons = evaluateQuota(
      20,
      {
        monthlyAllowance: 100,
        maxUnitsPerRequest: 10,
        consumed: 90
      },
      {
        monthlyAllowance: 50,
        maxUnitsPerRequest: 5,
        consumed: 40
      }
    );

    expect(reasons).toHaveLength(4);
  });
});
