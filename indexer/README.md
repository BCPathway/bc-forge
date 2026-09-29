# Indexer microservice

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

