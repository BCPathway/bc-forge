# Indexer microservice

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

