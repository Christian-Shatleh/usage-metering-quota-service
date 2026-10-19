import { describe, expect, it } from "vitest";

import { getUtcMonthStart } from "./billing-month.js";

describe("UTC billing month", () => {
  it("uses UTC when local-calendar dates could differ", () => {
    expect(getUtcMonthStart(new Date("2026-03-31T23:59:59.999Z")))
      .toBe("2026-03-01");
    expect(getUtcMonthStart(new Date("2026-04-01T00:00:00.000Z")))
      .toBe("2026-04-01");
  });
});
