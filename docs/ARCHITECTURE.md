# Architecture and data flow

## Components

The browser loads static HTML/CSS/JavaScript from the `client` container. Its
same-origin `/api` proxy forwards only required headers and request bodies to
the TypeScript Express API. The API authenticates an account by indexed key
prefix plus timing-safe full-hash comparison, then uses PostgreSQL as the
transaction and consistency boundary.

Drizzle defines schema and reporting queries. The quota transaction uses
parameterized `pg` queries directly because its row locks and lock order are
security- and correctness-critical.

## Consumption flow

1. Validate account key, idempotency header, UUID, and bounded integer units.
2. Start a PostgreSQL transaction and lock the account row.
3. Replay or reject an existing per-account idempotency key.
4. Lock the account-owned user row, then read effective plan limits.
5. Calculate the UTC billing month and current counters.
6. Evaluate account and user request/month limits.
7. For acceptance, atomically upsert both counters. For rejection, update none.
8. Insert one history row containing the decision and immutable snapshots.
9. Commit and return the decision.

All account-scoped writers start with the account row. User assignment then
locks the user. This shared order prevents a decision from mixing old and new
plan state and avoids cyclic lock acquisition.

## Data integrity

- Composite `(account_id, user_id)` keys enforce ownership on counters and
  history.
- History uses `ON DELETE RESTRICT`; deleting a user cannot erase metering
  evidence.
- Database triggers enforce account-plan scope and user-plan ownership even for
  writes that bypass the API.
- Plan ownership, positive limits, per-request≤monthly limits, nonnegative
  counters, JSON-array reasons, API-key formats, and idempotency uniqueness are
  database constraints.
- Existing pre-snapshot history is retained with null snapshot fields rather
  than being assigned fabricated historical values.

## Scaling

Transactions coordinate correctly across multiple API instances because locks
live in PostgreSQL. The in-memory HTTP rate limiter does not coordinate across
instances; production horizontal scaling should put a shared limiter at the
gateway or use a shared rate-limit store. Account-row serialization is a
deliberate correctness tradeoff and makes one account's maximum write rate
dependent on its transaction latency, without blocking unrelated accounts.

