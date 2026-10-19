export type QuotaState = {
  monthlyAllowance: number;
  maxUnitsPerRequest: number;
  consumed: number;
};

export type QuotaRejectionReason = {
  subject: "account" | "user";
  rule: "max_units_per_request" | "monthly_allowance";
  limit: number;
  actual: number;
};

export function evaluateQuota(
  requestedUnits: number,
  account: QuotaState,
  user: QuotaState
) {
  const reasons: QuotaRejectionReason[] = [];

  if (requestedUnits > account.maxUnitsPerRequest) {
    reasons.push({
      subject: "account",
      rule: "max_units_per_request",
      limit: account.maxUnitsPerRequest,
      actual: requestedUnits
    });
  }

  if (account.consumed + requestedUnits > account.monthlyAllowance) {
    reasons.push({
      subject: "account",
      rule: "monthly_allowance",
      limit: account.monthlyAllowance,
      actual: account.consumed + requestedUnits
    });
  }

  if (requestedUnits > user.maxUnitsPerRequest) {
    reasons.push({
      subject: "user",
      rule: "max_units_per_request",
      limit: user.maxUnitsPerRequest,
      actual: requestedUnits
    });
  }

  if (user.consumed + requestedUnits > user.monthlyAllowance) {
    reasons.push({
      subject: "user",
      rule: "monthly_allowance",
      limit: user.monthlyAllowance,
      actual: user.consumed + requestedUnits
    });
  }

  return reasons;
}
