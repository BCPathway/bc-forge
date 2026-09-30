# Indexer microservice

Supported Node, Prisma, Stellar SDK, and package ranges are in the [compatibility matrix](../docs/COMPATIBILITY.md).

## Quick start (Docker Compose)

The fastest way to run the indexer is the bundled Compose stack, which starts
Postgres plus the indexer (API + background indexer) with one command:

```bash
docker compose up
```

Run it from this `indexer/` directory. The stack brings up:

| Service    | What it does                                                             |
| ---------- | ------------------------------------------------------------------------ |
| `postgres` | Postgres 16 with a persistent `postgres-data` volume                     |
| `indexer`  | applies migrations on start, seeds sample rows, then runs the indexer + API |

### Required environment

Two variables are mandatory; compose fails fast with a clear error if they are
missing. Put them in `indexer/.env` (git-ignored) or export them in your shell:

```bash
CONTRACT_ID=C...           # Soroban contract ID whose events get indexed
INDEXER_API_TOKEN=replace-with-a-long-random-secret
```

Optional overrides (also settable in `.env`):

- `RPC_URL` — Soroban RPC endpoint (defaults to `https://soroban-testnet.stellar.org`).
- `PORT` — host port for the API (defaults to `3000`).

Once the stack is up:

```bash
curl http://localhost:3000/health
# {"status":"ok"}

curl -H "Authorization: Bearer $INDEXER_API_TOKEN" http://localhost:3000/api/v1/stats
```

### How migrations run in the container

On startup the `indexer` container runs:

```
npx prisma migrate deploy && npx prisma db seed && node dist/index.js
```

This is the `command:` on the `indexer` service in `docker-compose.yml`:
- `prisma migrate deploy` applies the committed migrations from
  `prisma/migrations/` that have not run yet, in order. It never drafts new
  migrations and never resets data, which makes it the right command for
  start-up and for production databases. **Do not run `prisma migrate dev`
  against a database with data you care about** — `migrate dev` is a
  development command that may reset the database to reconcile drift.
- `prisma db seed` inserts a few clearly marked sample rows from
  `prisma/seed.ts` (no secrets; ledger `0` and `seed-` txHashes).
- `node dist/index.js` starts the compiled server (the image's default
  `CMD`); Compose overrides the default entry sequence with the command
  above so migrations are guaranteed to run first.

To change the schema: edit `prisma/schema.prisma`, run
`npx prisma migrate dev --name <change>` against a disposable local database,
and commit the new folder under `prisma/migrations/`. The same SQL can be
applied outside Docker with `npm run db:deploy` (`prisma migrate deploy`).
## Health and monitoring

`GET /health` remains the database readiness probe. `GET /healthz` returns
`status`, `lastIndexedLedger`, `latestNetworkLedger`, and `lag` for external
health and lag monitors. The default lag warning threshold is 100 ledgers and
can be changed with `INDEXER_LAG_THRESHOLD`.

Lag alerts are emitted as one-line JSON to stdout using the existing sanitized
logger. Alert monitors can match `alert: "indexer_lag_threshold_exceeded"`
and inspect `lastIndexedLedger`, `latestNetworkLedger`, `lag`, and `threshold`;
no paid alerting client or service integration is required.

## API authentication

The indexer read API (`/api/v1/mints`, `/api/v1/transfers`, `/api/v1/burns`,
`/api/v1/holders`, `/api/v1/supply-history`, `/api/v1/stats`) is protected by a
shared secret. Set it in the environment (dotenv loads `.env` automatically)
and send it on every request as a bearer token:

```bash
# .env
INDEXER_API_TOKEN=replace-with-a-long-random-secret
```

```bash
curl -H "Authorization: Bearer $INDEXER_API_TOKEN" http://localhost:3000/api/v1/stats
```

Requests with a missing or incorrect token receive HTTP `401` with
`{ "error": "Unauthorized" }`. The token value is never logged. `GET /health`
is registered outside the authenticated router and stays public so uptime
probes keep working.

## Holder & supply aggregates

`GET /api/v1/holders` returns the current token holders with their balances,
derived from the indexed mint, transfer, and burn events at ingestion time.
`GET /api/v1/supply-history` returns timestamped supply points, one per
supply-changing event. Both use the same cursor pagination (`limit`, `cursor`)
and optional `from_ledger` filtering as the event-list routes.

## Health/readiness probe

`GET /health` is a database readiness check. It runs a `SELECT 1` through the
shared Prisma client on every request:

- `200 { "status": "ok" }` — the database answered the ping.
- `503 { "status": "error" }` — the ping failed (wrong `DATABASE_URL`,
  database down, etc.). Hosting probes should treat this as unhealthy.

The route needs no bearer token. The response body is always a fixed literal,
so no driver error text, database URL, or credential can leak to the client;
failures are logged server-side with credentials scrubbed.

## Docker

### Building the Image

Build the production Docker container from the root directory:

```bash
docker build -f indexer/Dockerfile -t bc-forge-indexer .
```

The build context must be the repository root (not `indexer/`) because
`@bc-forge/indexer` depends on the `@bc-forge/sdk` workspace, which is
resolved via the root lockfile rather than the npm registry.

For a multi-architecture build (linux/amd64 + linux/arm64 under one
manifest list, as published by `.github/workflows/publish-indexer.yml`):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f indexer/Dockerfile -t bc-forge-indexer .
```

### Verifying the published image signature

Images published for `indexer-v*` tags are signed with Cosign keyless signing.
No private signing key is created or stored. The signature certificate is
issued through GitHub Actions OIDC and is attached to the immutable image
digest in GHCR. The signing job is the only job in
`.github/workflows/publish-indexer.yml` with `id-token: write`.

1. Copy the `sha256:` digest from the publish job summary (the same digest
   Buildx recorded for the smoked manifest).
2. Set the release tag and image digest, replacing the examples below:

   ```bash
   IMAGE=ghcr.io/bcpathway/bc-forge-indexer
   TAG=indexer-v1.2.3
   DIGEST=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   ```

3. Verify the signature against the workflow identity for that tag and the
   GitHub Actions OIDC issuer:

   ```bash
   cosign verify \
     --certificate-identity "https://github.com/BCPathway/bc-forge/.github/workflows/publish-indexer.yml@refs/tags/${TAG}" \
     --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
     "${IMAGE}@${DIGEST}"
   ```

Cosign prints the verified signature payload on success. Check that its image
digest matches `DIGEST` and that its certificate identity and issuer match the
values above. The tag is included in the identity check, while the signature
verification target is the immutable digest rather than a mutable tag.

### Running the Container

Run the image, passing the required environment variables:

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:password@host:5432/bc_forge?schema=public" \
  -e CONTRACT_ID="CABC...XYZ" \
  -e RPC_URL="https://soroban-testnet.stellar.org" \
  -e INDEXER_API_TOKEN="your-secret-token" \
  -e PORT=3000 \
  bc-forge-indexer
```

> `docker run` starts the server only — it does not apply migrations or seed
> (that is the Compose stack's job via its `command:`). Run
> `npm run db:deploy && npm run db:seed` against the target database first,
> or use the Compose quick start above.

### Environment Variables

- `PORT` — Port number the Express HTTP server listens on (defaults to `3000`).
- `DATABASE_URL` — **Required at runtime.** PostgreSQL database connection URL used by Prisma.
- `CONTRACT_ID` — **Required at runtime.** Soroban smart contract ID to index.
- `RPC_URL` — Soroban RPC endpoint URL (defaults to `https://soroban-testnet.stellar.org`).
- `INDEXER_API_TOKEN` — Bearer token used to authenticate requests to `/api/v1/*` endpoints.

### Database Migrations

Schema migrations live in `indexer/prisma/migrations/` and are applied with
`prisma migrate deploy` (`npm run prisma:deploy`). That is the command to use
against staging and production: it applies the committed migrations in order and
never prompts or resets data. `npm run prisma:migrate` (`prisma migrate dev`)
remains a local development command. Run `npm run prisma:generate` to refresh
the Prisma client after a schema change.

Migrations are **not** automatically applied when the container starts, so run
`npm run prisma:deploy` separately — or as a release step before starting the
container.

The aggregate tables `Holder` and `SupplyPoint`, which back
`GET /api/v1/holders` and `GET /api/v1/supply-history`, are created by
`20260928193226_add_holder_and_supply_point`. That migration only adds new
tables and touches no existing table, so it applies cleanly whether or not the
base schema `init` migration tracked in #1056 has been applied yet.

> Prefer the one-command path? Use the Compose stack above, whose `indexer`
> service runs `prisma migrate deploy` (never `migrate dev`) on start.
> The committed migrations live under `prisma/migrations/` and apply to a
> fresh database with `npm run db:deploy`.

### Seeding

`prisma/seed.ts` inserts at most three sample rows, all clearly marked as
seed data (placeholder `SEED_DATA_ADDRESS`, amount `1`, ledger `0`,
`seed-` txHashes). It contains no secrets. Run it with `npm run db:seed`,
or automatically via `prisma migrate reset` / the Compose stack.


## Production operations runbook

This section covers day-two operations: validating the environment before
startup, graceful start and stop procedures, database backup and restore,
cursor recovery after a restart, and how to interpret health probe responses.

> **Security note** — Never commit real credentials. Use placeholder values in
> committed files (e.g. `replace-with-a-long-random-secret`) and inject secrets
> at runtime through environment variables or a secrets manager. See
> [`SECURITY.md`](../SECURITY.md) and the [Docker](#docker) section above for
> guidance on passing secrets safely.

---

### Environment validation

Run through this checklist before starting or restarting the service in any
environment. A missing or malformed variable surfaces as a startup crash rather
than a silent failure.

| Variable | Required | Check |
|---|---|---|
| `CONTRACT_ID` | **Yes** | Must begin with `C` (Stellar contract address format) |
| `DATABASE_URL` | **Yes** | Must be a valid `postgresql://` connection string |
| `INDEXER_API_TOKEN` | **Yes** | Must be a long random secret — **never a placeholder** |
| `RPC_URL` | No | Defaults to `https://soroban-testnet.stellar.org`; set to a mainnet RPC for production |
| `PORT` | No | Defaults to `3000`; must be an integer |
| `INDEXER_LAG_THRESHOLD` | No | Defaults to `100` ledgers; tune based on acceptable lag |
| `INDEXER_RATE_LIMIT_MAX` | No | Optional request cap; a non-integer value is ignored and the built-in default is used |
| `INDEXER_RATE_LIMIT_WINDOW_MS` | No | Optional rate-limit window in milliseconds |

Quick shell validation (substitute your actual secret names):

```bash
# Verify required variables are set and non-empty
: "${CONTRACT_ID:?CONTRACT_ID is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${INDEXER_API_TOKEN:?INDEXER_API_TOKEN is required}"

# Confirm DATABASE_URL begins with the expected scheme
echo "$DATABASE_URL" | grep -q '^postgresql://' \
  || { echo "DATABASE_URL must start with postgresql://"; exit 1; }

# Confirm CONTRACT_ID looks like a Stellar contract address
echo "$CONTRACT_ID" | grep -qE '^C[A-Z2-7]{55}$' \
  || { echo "CONTRACT_ID does not look like a valid Stellar contract address"; exit 1; }
```

---

### Migration order

Production startup migrates before it serves traffic. Do not start the API
against a database that has not applied the current Prisma migrations.

1. Validate the environment in the section above. A missing `CONTRACT_ID`
   crashes startup with `CONTRACT_ID environment variable is required`. A
   missing or rejected `DATABASE_URL` fails in Prisma before the loop starts.
   `INDEXER_API_TOKEN` must be a real secret; the API rejects callers that do
   not present it.
2. Apply migrations with `npx prisma migrate deploy --schema indexer/prisma/schema.prisma`.
   Prisma runs each directory under `indexer/prisma/migrations` in
   lexicographic order (the timestamp prefix). Do not rename or edit a
   migration that has already been applied. Do not use `prisma migrate dev` or
   `prisma migrate reset` on a production database; reset drops data.
3. Start the server only after `migrate deploy` exits 0. The Compose stack
   does steps 2 and 3 itself (see
   [How migrations run in the container](#how-migrations-run-in-the-container)).
   A standalone `docker run` does not: run migrate deploy yourself, then start
   the container (see [Database Migrations](#database-migrations)).
4. Seeding (`npm run db:seed`) is not part of the production order. The seed
   file contains no secrets; do not point it at a production database.

A failed `migrate deploy` stops on the failed migration and leaves later
migrations unapplied. Keep the server down until deploy exits 0. Starting
without migrating fails requests that expect the new schema.

---

### Starting the service

#### Compose stack (recommended for first-time setup)

```bash
# From the indexer/ directory
docker compose up -d
```

Compose applies migrations (`prisma migrate deploy`) and seeds sample rows
before starting the server process, so the database is always ready when the
API accepts traffic.

Confirm the service is healthy:

```bash
curl http://localhost:3000/health
# Expected: {"status":"ok"}

curl http://localhost:3000/healthz
# Expected: {"status":"ok","lastIndexedLedger":<n>,"latestNetworkLedger":<n>,"lag":<n>}
```

#### Standalone container (production)

Apply migrations first — the standalone `docker run` path does **not** run
`prisma migrate deploy` automatically:

```bash
# 1. Apply any pending migrations
DATABASE_URL="<your-db-url>" npx prisma migrate deploy --schema indexer/prisma/schema.prisma

# 2. Start the container
docker run -d --name bc-forge-indexer \
  -p 3000:3000 \
  -e DATABASE_URL="<your-db-url>" \
  -e CONTRACT_ID="<your-contract-id>" \
  -e RPC_URL="https://soroban-mainnet.stellar.org" \
  -e INDEXER_API_TOKEN="<your-secret-token>" \
  -e PORT=3000 \
  bc-forge-indexer
```

> Do not interpolate secrets directly in shell scripts that are committed or
> logged. Prefer passing them via a secrets manager (e.g. AWS Secrets Manager,
> HashiCorp Vault) or Docker secrets and referencing the resolved value in the
> container environment.

---

### Graceful shutdown

The server handles `SIGTERM` and `SIGINT` by flushing in-flight database
connections and exiting cleanly (see `indexer/src/index.ts`). Always prefer
a graceful stop over a hard kill.

```bash
# Compose — waits for the container to stop cleanly (default timeout: 10 s)
docker compose stop indexer

# Standalone container
docker stop bc-forge-indexer        # sends SIGTERM, waits up to 10 s
docker stop -t 30 bc-forge-indexer  # extend timeout if needed
```

To stop immediately (last resort — risks incomplete writes):

```bash
docker kill bc-forge-indexer
```

After a hard kill, verify the last indexed ledger is consistent before
restarting (see [Cursor recovery](#cursor-recovery) below).

---

### Database backup and restore

#### Backup

Use `pg_dump` to take a consistent logical backup. Run it against a replica
when possible to avoid load on the primary.

```bash
# Full logical backup (plain SQL)
pg_dump \
  --no-password \
  --format=custom \
  --file="indexer-backup-$(date +%Y%m%d%H%M%S).dump" \
  "$DATABASE_URL"

# Or using Docker if psql/pg_dump is not installed locally
docker run --rm \
  -e PGPASSWORD="<db-password>" \
  postgres:16 \
  pg_dump --host <db-host> --port 5432 --username <db-user> \
          --format=custom --dbname <db-name> \
  > "indexer-backup-$(date +%Y%m%d%H%M%S).dump"
```

Store backups outside the database host. Verify them periodically with a
test restore to a throwaway database.

#### Restore

```bash
# Stop the indexer before restoring to prevent writes during the operation
docker compose stop indexer   # or docker stop bc-forge-indexer

# Restore into an existing (empty) database
pg_restore \
  --no-password \
  --clean \
  --if-exists \
  --dbname "$DATABASE_URL" \
  indexer-backup-<timestamp>.dump

# Re-apply any migrations that post-date the backup
DATABASE_URL="<your-db-url>" npx prisma migrate deploy \
  --schema indexer/prisma/schema.prisma

# Restart the service
docker compose up -d   # or docker start bc-forge-indexer
```

After the restore, confirm `/healthz` reports a sensible `lastIndexedLedger`
before directing traffic back to the service.

---

### Cursor recovery

The indexer tracks its position in the `LastIndexedLedger` table (a single row
with `id = 1`). If the service is restarted after a hard kill or an incomplete
write, it resumes from `lastLedger.ledger + 1`. No manual intervention is
needed in the normal case.

If the cursor row is missing or points to an incorrect ledger (e.g. after a
partial restore), reset it manually:

```bash
# Connect to the database
psql "$DATABASE_URL"

-- Check current cursor
SELECT * FROM "LastIndexedLedger";

-- Reset to a known-good ledger (replace <ledger_number> with the desired value)
-- The indexer will re-index from <ledger_number> + 1 on next startup.
UPDATE "LastIndexedLedger"
SET ledger = <ledger_number>
WHERE id = 1;

-- If the row is missing entirely, insert it
INSERT INTO "LastIndexedLedger" (id, ledger, hash, "parentHash")
VALUES (1, <ledger_number>, '<ledger_hash>', '<parent_hash>');
```

> Re-indexing already-processed ledgers is safe: the indexer uses
> `skipDuplicates: true` on `IndexedLedger` inserts and catches unique
> constraint violations (`P2002`) on event rows, so duplicate processing does
> not corrupt data.

After updating the cursor, restart the service:

```bash
docker compose restart indexer
# or
docker restart bc-forge-indexer
```

---

### Health probe interpretation

#### `GET /health`

A database readiness check. It runs `SELECT 1` through the shared Prisma
client.

| Response | Meaning | Action |
|---|---|---|
| `200 {"status":"ok"}` | Database is reachable | No action needed |
| `503 {"status":"error"}` | Database ping failed | Check `DATABASE_URL`, network connectivity, and database logs |

This endpoint requires no bearer token and is safe to call from external
uptime monitors.

#### `GET /healthz`

An extended health and lag check. Returns:

```json
{
  "status": "ok",
  "lastIndexedLedger": 12345678,
  "latestNetworkLedger": 12345680,
  "lag": 2
}
```

| Field | Meaning |
|---|---|
| `status` | `"ok"` when the database is reachable; `"error"` otherwise |
| `lastIndexedLedger` | Last ledger fully persisted by the indexer |
| `latestNetworkLedger` | Most recent ledger reported by the Soroban RPC |
| `lag` | Difference between `latestNetworkLedger` and `lastIndexedLedger` |

**Lag thresholds:**

- `lag` below `INDEXER_LAG_THRESHOLD` (default `100`) — normal operation.
- `lag` at or above the threshold — the indexer emits a structured warning log:
  ```json
  {"level":"warn","alert":"indexer_lag_threshold_exceeded","lastIndexedLedger":...,"latestNetworkLedger":...,"lag":...,"threshold":100}
  ```
  Monitor for this `alert` field in your log aggregator. Common causes are
  RPC connectivity issues, database slowness, or a backlog after a restart.
- A `lag` of `0` after a fresh start may indicate the `CONTRACT_ID` is
  incorrect or the RPC endpoint is unreachable.

#### Log triage

All logs are emitted as one-line JSON to stdout. Key fields:

| `level` | `msg` / context | Suggested action |
|---|---|---|
| `info` | `"starting contract indexer"` | Normal startup |
| `info` | `"indexing ledger range"` | Normal operation |
| `warn` | `alert: "indexer_lag_threshold_exceeded"` | Investigate RPC or DB performance |
| `error` | `"indexer ingestion error"` | Check `error` field; service will retry in 5 s |
| `error` | `"event processing error"` | Check `topic` and `error` fields; non-duplicate errors are logged |

To stream logs in real time:

```bash
docker logs -f bc-forge-indexer          # standalone container
docker compose logs -f indexer           # Compose stack
```

---

### Cross-references

- **Docker image and Compose stack** — [Docker](#docker) section above
- **Migration commands** — [Database Migrations](#database-migrations) section above
- **Secret handling and security policy** — [`SECURITY.md`](../SECURITY.md)
- **Pause/unpause during an incident** — [`SECURITY.md` — Incident Response](../SECURITY.md#incident-response)
- **Admin key hygiene** — [`docs/ADMIN_KEYS.md`](../docs/ADMIN_KEYS.md)
