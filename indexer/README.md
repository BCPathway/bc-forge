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
docker build -f indexer/Dockerfile -t bc-forge-indexer indexer
```

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

## Release artifacts

Each published indexer release ships two artifacts built from the same commit
(`.github/workflows/publish-indexer.yml`):

| Artifact | Where | Purpose |
| --- | --- | --- |
| Container image | `ghcr.io/bcpathway/bc-forge-indexer` | runs the API and the background indexer |
| `bc-forge-indexer-prisma-migrations-<version>.tar.gz` | GitHub Release assets | the migrations that match that image |

`<version>` is the semantic version from the `indexer-v<semver>` release tag, taken from the same commit as the image. The
archive contains `prisma/migrations/`, `prisma/schema.prisma`, and
`prisma/migration_lock.toml`, so operators can apply exactly the migrations that
shipped with the image. The release notes record the archive name, its SHA-256
checksum, the image digest, and the commit they were built from.

The image is tagged with the immutable version (for example `1.2.3`) and the
commit (`sha-<commit>`); `latest` moves only on stable releases, so a
`1.2.3-rc.1` prerelease never takes it over.

### Verify the migration archive

Download the archive and its `.sha256` companion from the release into the same
directory, then check it:

```bash
sha256sum -c bc-forge-indexer-prisma-migrations-<version>.tar.gz.sha256   # Linux
shasum -a 256 -c bc-forge-indexer-prisma-migrations-<version>.tar.gz.sha256  # macOS
```

A match prints `OK`. A mismatch means the download is corrupt or was modified —
do not apply its migrations.

## Deploy, verify, and roll back an indexer release

Production deployments pin an immutable image **digest**, never `latest` or a
mutable tag, so the running image always matches a reviewed release:

```bash
IMAGE=ghcr.io/bcpathway/bc-forge-indexer
# Copy the digest from the release notes (never deploy :latest in production).
DIGEST=sha256:1f0c8f0b0d5a2c9e4b3a6d7f8e9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a
```

### 1. Back up the database

`prisma migrate deploy` is forward-only, so take a backup before every rollout
that carries a migration:

```bash
pg_dump --format=custom "$DATABASE_URL" > "bc-forge-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

### 2. Apply the migrations

The image does not migrate on start (`CMD ["npm", "start"]`), so run the deploy
from the same digest as an explicit step before starting the new container:

```bash
docker pull "${IMAGE}@${DIGEST}"
docker run --rm -e DATABASE_URL="$DATABASE_URL" \
  "${IMAGE}@${DIGEST}" npx prisma migrate deploy
```

### 3. Roll out the new digest

```bash
docker run -d --name bc-forge-indexer --restart unless-stopped -p 3000:3000 \
  -e DATABASE_URL="$DATABASE_URL" \
  -e CONTRACT_ID="$CONTRACT_ID" \
  -e RPC_URL="$RPC_URL" \
  -e INDEXER_API_TOKEN="$INDEXER_API_TOKEN" \
  "${IMAGE}@${DIGEST}"
```

### 4. Verify health

The two probes defined in [Health and monitoring](#health-and-monitoring) are
the success criteria — a rollout is done only when both pass:

- `GET /health` returns `200 {"status":"ok"}`. A `503` means the database is
  unreachable, which is a failed rollout.
- `GET /healthz` returns `lag` (`latestNetworkLedger - lastIndexedLedger`). A
  healthy indexer keeps `lag` below `INDEXER_LAG_THRESHOLD` (default `100`).

```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/healthz
```

If either check fails, roll back before the indexer falls further behind.

### When a migration makes an image rollback unsafe

Migrations are forward-only: rolling the image back does not undo them. Rolling
back to the previous digest is safe only while that image still matches the
schema left by the new image. A migration is **not** backward compatible — and
therefore makes image rollback unsafe — when it

- drops or renames a table or column the previous image reads or writes,
- changes a column type, or adds a `NOT NULL` column, in a way the previous
  image cannot produce,
- rewrites or deletes existing rows.

Purely additive migrations (new tables, nullable columns, indexes) leave the
previous image working, so the old digest can simply be restarted. When a
migration is not backward compatible, do not roll the image back against the
migrated schema: restore the backup from step 1 and accept that writes made
after the backup are lost.

### 5. Roll back

```bash
# 1. Stop the new container.
docker stop bc-forge-indexer && docker rm bc-forge-indexer

# 2. Backward-compatible migration: start the previous digest as-is.
docker run -d --name bc-forge-indexer \
  -e DATABASE_URL="$DATABASE_URL" \
  "${IMAGE}@${PREVIOUS_DIGEST}"

# 3. Non-backward-compatible migration: restore the pre-rollout dump first,
#    then start the previous digest.
pg_restore --clean --if-exists --dbname "$DATABASE_URL" bc-forge-<timestamp>.dump

# 4. Re-run the step 4 health checks and keep the deployed digests on record so
#    the previous digest is known during an incident.
```

