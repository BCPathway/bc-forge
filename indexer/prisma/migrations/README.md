# Prisma migrations

This directory holds the committed SQL migrations for the indexer database.
They apply to a fresh Postgres with:

```bash
cd indexer
npm run db:deploy      # prisma migrate deploy — applies pending migrations
```

Never edit an applied migration. To change the schema, edit
`../schema.prisma` and create a new migration:

```bash
npx prisma migrate dev --name <change_description>
```

`migrate dev` is a development-only command (it can reset the database).
Against production or any database with data you care about, use
`migrate deploy` (or the container startup in `../docker-compose.yml`,
which uses `migrate deploy`).

## Release archive

Every published indexer release attaches a
`bc-forge-indexer-prisma-migrations-<version>.tar.gz` archive to the GitHub
Release. It contains this whole directory plus `../schema.prisma`, so operator
migrations always match the released image. The archive and its SHA-256
checksum are attached by `.github/workflows/publish-indexer.yml`; see
[Releasing, deploying, and rolling back](../README.md#deploy-verify-and-roll-back-an-indexer-release)
for how to verify the checksum and deploy by digest.
