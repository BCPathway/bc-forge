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
