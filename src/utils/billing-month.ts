export function getUtcMonthStart(now = new Date()) {
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    "01"
  ].join("-");
}
