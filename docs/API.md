# API reference

Base path: `/api`. JSON endpoints return errors as
`{ "error": "message", "code": "stable_code", "details"?: [...] }`.

## Authentication

Account endpoints require `x-api-key: fts_<64 lowercase hex characters>`.
Keys are account-scoped, stored only as SHA-256 hashes, and must be transmitted
over TLS outside local development. The account bootstrap endpoint instead
requires `x-bootstrap-token`.

Examples use placeholders only:

```powershell
$headers = @{ 'x-api-key' = 'fts_<64-hex-characters>' }
Invoke-RestMethod http://127.0.0.1:3001/api/accounts/me -Headers $headers
```

## Health and plans

### `GET /healthz`

Checks database connectivity. Returns `200 { "status": "ok" }`.

### `GET /plans`

Publicly lists predefined account and user plans.

### `GET /plans/:id`

Returns a predefined plan publicly. A custom plan requires its owning account's
key; another account receives 404.

## Accounts and credentials

### `POST /accounts/bootstrap`

Header: `x-bootstrap-token`. Body:

```json
{ "name": "Example Company", "planId": "<account-plan-uuid>" }
```

Returns 201 with the account and a one-time plaintext `apiKey`. Only a global,
predefined account-scope plan is accepted.

### `GET /accounts/me`

Returns the authenticated account and its effective account plan.

### `POST /accounts/api-key/rotate`

Atomically replaces the currently authenticated key and returns the replacement
once. A concurrently superseded key receives 401.

### `POST /accounts/api-key/revoke`

Immediately revokes the current key and returns 204. Revocation has no ordinary
API recovery endpoint.

## Users

### `POST /users`

```json
{ "name": "Alice", "planId": "<assignable-user-plan-uuid>" }
```

Creates a user under the authenticated account. The plan must be a predefined
user plan or a custom user plan owned by that account.

### `GET /users` and `GET /users/:id`

List or retrieve account-owned users with effective plan details. Cross-account
lookups return 404.

### `PUT /users/:id/plan`

```json
{ "planId": "<assignable-user-plan-uuid>" }
```

The update runs in a transaction using the same account→user lock order as
consumption. Invalid IDs return 400; unavailable, foreign, or wrong-scope plans
return 404.

## Custom plans

All custom-plan endpoints require authentication. Custom plans are always
user-scope and account-owned.

- `POST /plans/custom` creates a plan with `name`, `monthlyAllowance`, and
  `maxUnitsPerRequest`.
- `GET /plans/custom` lists plans owned by the account.
- `GET /plans/custom/:id` retrieves one owned plan.
- `PATCH /plans/custom/:id` updates one or more fields. Plans currently assigned
  to a user return 409 to keep effective limits stable.

Both limits are positive PostgreSQL integers and the per-request limit cannot
exceed the monthly allowance.

## Usage

### `POST /usage/consume`

Requires a printable ASCII `idempotency-key` header of 1–200 characters.

```json
{ "userId": "<user-uuid>", "units": 10 }
```

Accepted response:

```json
{ "accepted": true, "rejectionReasons": [], "replayed": false }
```

Rejected quota response (HTTP 200 because the metering decision succeeded):

```json
{
  "accepted": false,
  "replayed": false,
  "rejectionReasons": [
    {
      "subject": "user",
      "rule": "monthly_allowance",
      "limit": 100,
      "actual": 110
    }
  ]
}
```

Same account/key/payload returns the original decision with `replayed: true`
and does not charge again. Reusing the key with another payload returns 409.
Unknown or cross-account users return 404. Invalid/non-integer/out-of-range
units return 400.

### `GET /usage/summary`

Returns UTC `monthStart`, account allowance/consumed/remaining, and equivalent
per-user values.

### `GET /usage/history`

Returns the newest 50 accepted and rejected decisions. New records include
immutable user/plan identity and before/after counter snapshots; fields may be
null on legacy rows where historical values were unknowable.

## Status codes

- 200/201/204: successful operation
- 400: invalid input or headers
- 401: missing, invalid, revoked, or superseded credential
- 404: endpoint/resource absent or hidden by account isolation
- 409: idempotency conflict or plan currently in use
- 413: request body exceeds 32 KiB
- 429: rate limit exceeded
- 500: unexpected internal error (database details and stacks are not exposed)
- 503: bootstrap is not configured

