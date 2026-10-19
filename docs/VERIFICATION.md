# Verification report

Verification date: 2026-10-18 (Asia/Riyadh).

## Migration safety

- Inspected the live `fts_db` schema, constraints, indexes, and aggregate row
  counts before changes.
- Created a PostgreSQL custom-format backup outside the repository and validated
  its archive listing.
- Restored that backup into `fts_rebuild_migration_test`.
- Applied migration `0001_worthless_spitfire.sql` to the restored copy with
  `ON_ERROR_STOP=1`.
- Confirmed all 4 accounts, 6 users, 5 plans, and 30 usage requests survived;
  all 30 legacy requests intentionally retained null snapshot fields.
- Confirmed the new retention FK, checks, indexes, and three plan-assignment
  triggers exist.

## Automated coverage

Unit coverage includes quota acceptance, exact boundaries, monthly and request
limits, combined rejection reasons, UTC month rollover, and API-key generation/
verification.

Integration coverage runs against `fts_rebuild_test` and includes bootstrap,
authentication, account self-inspection, user CRUD reads/create, custom plans,
normal and cross-account assignment, plan-in-use protection, consumption,
counters, history snapshots, rejected no-charge behavior, same-key replay,
idempotency conflict, 20-way quota contention, multiple-user account contention,
plan assignment racing consumption, history retention, rotation/revocation,
numeric bounds, and cross-account isolation.

## Commands and recorded outcomes

The final command outcomes are updated during release verification:

| Command | Outcome |
| --- | --- |
| `npm run build` | Passed |
| `npm test` | Passed: 8 unit + 9 integration tests |
| `npm audit` | Passed: 0 vulnerabilities (production and development) |
| `npm --prefix client audit --omit=dev` | Passed: 0 vulnerabilities |
| `docker compose up -d --build` | Passed; both final images rebuilt |
| API/frontend health checks | Passed: HTTP 200; both containers healthy |
| Frontend proxy checks | Passed: plans, JSON 401, method filtering, security headers |

## Feature parity

No original/reference implementation was present. Relative to the supplied
requirements, account/user/custom-plan management, atomic usage, UTC billing,
idempotency, audit retention/snapshots, credential lifecycle, dashboard flows,
Docker deployment, and isolated tests are implemented. User deletion and account
deletion endpoints are intentionally absent; database restrictions preserve
history instead of silently deleting it. Horizontal shared rate limiting and TLS
termination remain deployment responsibilities.

Browser UI automation was attempted, but this environment exposed no controllable
browser or application target. The frontend was instead verified by JavaScript
syntax checks, production image build, static-page/proxy HTTP checks,
security-header checks, and the backend integration suite. A manual visual pass
in the operator's browser remains recommended before presentation.
