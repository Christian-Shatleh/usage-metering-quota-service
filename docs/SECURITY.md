# Security audit and operating guidance

## Implemented controls

- API keys use 256-bit cryptographic randomness, strict format validation,
  prefix-indexed lookup, SHA-256 database storage, and timing-safe verification.
- Rotation and revocation are authenticated, transactionally serialized, and
  never log keys. Rotation returns the replacement only in its response.
- Account ownership is enforced on users, custom plans, counters, history, and
  consumption. Foreign resources are generally hidden with 404.
- Zod strict schemas reject unknown fields; numeric input is bounded to the
  PostgreSQL integer range; JSON bodies are limited to 32 KiB.
- Errors are JSON and do not expose SQL, stack traces, or secrets. Logs contain
  only method/path and sanitized error name/message for unexpected failures.
- Parameterized queries prevent SQL injection. The dashboard renders API data
  only with DOM methods and `textContent`.
- API and frontend set restrictive browser headers. Containers run as `node`,
  drop Linux capabilities, use read-only roots, and enable no-new-privileges.
- `.env`, dumps, logs, dependencies, build output, and final ZIPs are excluded
  by `.gitignore`/`.dockerignore` and by submission packaging.

## Credential response

Development credentials previously exposed in logs/files must be treated as
compromised. This project does not silently rotate them because losing the only
response would lock out the operator. After deployment, an authorized operator
should call `POST /api/accounts/api-key/rotate`, immediately store the returned
key in an approved secret manager, update clients, and verify the old key gets
401. Rotate `BOOTSTRAP_TOKEN` and the database password through their owning
systems as well.

## Remaining operational limitations

- TLS is not terminated by this local Compose stack. Use a TLS reverse proxy in
  any environment where traffic leaves the host.
- Rate limits are process-local. Use a gateway/shared store when scaling.
- API-key hashes are unsalted SHA-256 by design because keys contain 256 random
  bits; database compromise still warrants immediate rotation.
- Revocation is irreversible through the account API. Recovery is an operator
  procedure, not a public endpoint.
- No original FTS reference source was present in the workspace, so parity was
  assessed against the supplied requirements and existing behavior.

## Reporting

Do not include live keys, tokens, `.env`, dumps, or credential-bearing logs in
issues. Report a vulnerability with reproduction steps using placeholder/test
credentials and state whether existing keys need rotation.

