# FTS Usage Metering and Quota Service

FTS is a multi-account usage-metering API with atomic account and user quotas,
idempotent consumption, immutable usage audit snapshots, custom user plans, API
key lifecycle management, and a browser dashboard.

## Requirements

- Node.js 22 and npm
- PostgreSQL 17
- Docker Desktop with Compose (for container deployment)
- PowerShell 7+ for the examples below

Copy `.env.example` to `.env` and replace every placeholder. Never commit
`.env`. `DATABASE_URL` is used by host-side migrations and tests;
`DOCKER_DATABASE_URL` must address the existing database as
`fts-postgres:5432` from the API container.

## Existing-data workflow

This workflow preserves the existing `fts-postgres` container and `fts_db`.
Do not run `docker compose down -v`.

```powershell
Set-Location C:\Users\User\Desktop\ten\fts-rebuild
npm ci

# Make a recoverable custom-format backup outside the repository.
New-Item -ItemType Directory -Force ..\backups | Out-Null
docker exec fts-postgres pg_dump -U postgres -d fts_db -Fc `
  -f /tmp/fts_db_before_migration.dump
docker cp fts-postgres:/tmp/fts_db_before_migration.dump `
  ..\backups\fts_db_before_migration.dump

# Review generated SQL, then apply only versioned migrations.
Get-Content .\drizzle\0001_worthless_spitfire.sql
npm run db:migrate

npm run build
npm test
.\scripts\compose-existing.ps1 up -d --build
docker compose ps
Invoke-RestMethod http://127.0.0.1:3001/api/healthz
Invoke-WebRequest http://127.0.0.1:8080/healthz -UseBasicParsing
```

`db:migrate` is additive and preserves data. Never use `drizzle-kit push` on
the existing database. `compose-existing.ps1` uses `DOCKER_DATABASE_URL` when
provided; for the existing localhost:5433 configuration it can safely derive
the container address without printing or rewriting the credential.

## Clean installation

Use `compose.clean.yaml` only for a separate installation. It creates the named
volume `fts-clean-postgres`; it does not attach to the existing standalone
database.

```powershell
Set-Location C:\Users\User\Desktop\ten\fts-rebuild
Copy-Item .env.example .env
# Edit .env and replace all placeholders first.

docker compose -f compose.clean.yaml up -d postgres
npm ci
npm run db:migrate
npm run db:seed
docker compose -f compose.clean.yaml up -d --build
```

Stop clean-install containers without deleting their volume:

```powershell
docker compose -f compose.clean.yaml down
```

## Development and tests

```powershell
npm run dev
npm run build
npm run test:unit
npm run test:integration
npm test
```

Integration tests never use `fts_db`. If `TEST_DATABASE_URL` is absent, the
runner derives `fts_rebuild_test` from `DATABASE_URL`, creates it if needed,
applies migrations, and refuses any database name that does not end in
`_test`. Test cleanup is confined to that database.

## Billing and consistency model

- Billing months begin at `00:00:00 UTC` on the first calendar day.
- Every account-scoped write takes locks in the order **account → user → plan**.
- The account lock serializes quota decisions, plan assignment, plan edits, and
  key lifecycle operations for that account.
- Accepted requests update account and user counters in the same transaction.
- Rejected requests update neither counter but remain in history.
- An idempotency key is unique per account. Repeating an identical payload
  replays the stored result; changing the payload returns HTTP 409.
- New history rows snapshot identities, effective plans, limits, and before/
  after counters. Legacy rows remain null where the original data cannot prove
  the historical value.

## Project layout

```text
src/routes/          HTTP API
src/rules/           pure quota evaluation
src/services/        reporting queries
src/db/              Drizzle schema, connection, seed
drizzle/             ordered additive migrations
tests/               isolated PostgreSQL integration/concurrency suite
client/              same-origin dashboard and API proxy
docs/                API, architecture, security, and verification notes
```

See [API documentation](docs/API.md), [architecture](docs/ARCHITECTURE.md),
[security notes](docs/SECURITY.md), and [verification report](docs/VERIFICATION.md).

## Operational notes

- API keys are shown only in bootstrap/rotation responses. Save a rotated key
  before discarding the response; the old key is invalidated atomically.
- Revocation is immediate and intentionally leaves no API-based recovery path.
  An operator must create/recover credentials through an approved administrative
  process.
- Put TLS in front of the services outside local development.
- The included rate limiter is per process and intended for this single-instance
  deployment. Use a shared store or gateway limiter when horizontally scaling.
- The API does not auto-run migrations at startup; this prevents an accidental
  schema change during routine container restarts.

