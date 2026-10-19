import { randomUUID } from "node:crypto";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.TEST_API_KEY;
const userId = process.env.TEST_USER_ID;

if (!apiKey || !userId) {
  throw new Error("TEST_API_KEY and TEST_USER_ID are required");
}

const requests = Array.from({ length: 20 }, () =>
  fetch(`${baseUrl}/api/usage/consume`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "idempotency-key": randomUUID()
    },
    body: JSON.stringify({
      userId,
      units: 10
    })
  }).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }))
);

const results = await Promise.all(requests);
const accepted = results.filter(
  (result) => result.body.accepted === true
);
const rejected = results.filter(
  (result) => result.body.accepted === false
);
const errors = results.filter(
  (result) => result.status >= 400
);

console.log("Accepted:", accepted.length);
console.log("Rejected:", rejected.length);
console.log("HTTP errors:", errors.length);
console.log("Responses:", JSON.stringify(results, null, 2));

if (accepted.length !== 10 || rejected.length !== 10 || errors.length !== 0) {
  process.exitCode = 1;
}
