import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards the invariant behind issue #945: the tables backing the
 * `GET /api/v1/holders` and `GET /api/v1/supply-history` routes must be created
 * by a committed Prisma migration, not only declared in `schema.prisma`. A
 * schema model with no matching migration still lets `prisma generate` succeed
 * and every unit test pass, but `prisma migrate deploy` never creates the
 * table and both routes fail at runtime.
 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const prismaDir = join(packageRoot, 'prisma');
const migrationsDir = join(prismaDir, 'migrations');

/** Models this branch is responsible for migrating (issue #945). */
const AGGREGATE_MODELS = ['Holder', 'SupplyPoint'] as const;

/**
 * Models predating this branch. Their `init` migration is tracked in #1056; the
 * aggregate migration must stay independent of it.
 */
const BASE_MODELS = ['Mint', 'Transfer', 'Burn', 'LastIndexedLedger', 'Webhook'] as const;

/**
 * Strip `--` comments so keyword scans do not match prose.
 */
const withoutComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

/**
 * Every committed migration, in the order Prisma applies them.
 *
 * Read inside each test rather than at module load so a missing or unreadable
 * migration surfaces as one clear assertion failure instead of an ENOENT that
 * takes down the whole file.
 */
function committedMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      sql: withoutComments(readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The committed migration that creates the aggregate tables. */
function aggregateMigration(): { name: string; sql: string } {
  const found = committedMigrations().find((migration) => migration.sql.includes('"Holder"'));
  assert.ok(found, 'a migration creating the Holder table must be committed under prisma/migrations');
  return found;
}

test('the provider lock file pins the postgresql datasource', () => {
  const schemaSql = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
  const lock = readFileSync(join(migrationsDir, 'migration_lock.toml'), 'utf8');

  assert.match(schemaSql, /provider\s*=\s*"postgresql"/);
  assert.equal(
    lock.match(/^provider\s*=\s*"(\w+)"/m)?.[1],
    'postgresql',
    'migration_lock.toml must match the datasource provider',
  );
});

test('Holder and SupplyPoint are declared in schema.prisma', () => {
  const schemaSql = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
  const declared = [...schemaSql.matchAll(/^model\s+(\w+)/gm)].map((match) => match[1]);

  for (const model of AGGREGATE_MODELS) {
    assert.ok(declared.includes(model), `${model} must be declared in schema.prisma`);
  }
});

test('every aggregate model is created by a committed migration', () => {
  const migrations = committedMigrations();
  assert.ok(migrations.length > 0, 'at least one migration must be committed under prisma/migrations');

  for (const model of AGGREGATE_MODELS) {
    const creating = migrations.filter((migration) =>
      new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+"${model}"`).test(migration.sql),
    );

    assert.equal(
      creating.length,
      1,
      `expected exactly one committed migration creating "${model}", found ${creating.length}; ` +
        'prisma migrate deploy must be able to create the table',
    );
  }
});

test('the Holder address unique index is created by a committed migration', () => {
  const creating = committedMigrations().filter((migration) =>
    /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"Holder_address_key"\s+ON\s+"Holder"\("address"\)/.test(
      migration.sql,
    ),
  );

  assert.equal(creating.length, 1, 'Holder.address must be backed by a unique index');
});

test('the aggregate migration is additive only, so it cannot clobber existing data', () => {
  const { name, sql } = aggregateMigration();

  for (const destructive of ['DROP ', 'TRUNCATE', 'DELETE FROM', 'RENAME ']) {
    assert.ok(
      !sql.toUpperCase().includes(destructive),
      `${name} must stay additive, found ${destructive.trim()}`,
    );
  }
});

test('the aggregate migration is idempotent, so it applies in either order against the #1056 init migration', () => {
  const { name, sql } = aggregateMigration();
  const creates = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(IF\s+NOT\s+EXISTS\s+)?/gi)];

  assert.ok(creates.length > 0, `${name} must contain CREATE statements`);

  const unguarded = creates.filter((match) => !match[1]);
  assert.deepEqual(
    unguarded.map((match) => match[0].trim()),
    [],
    `${name} must guard every CREATE with IF NOT EXISTS so an init migration that already created the tables cannot fail the deploy`,
  );
});

test('the aggregate migration does not create base models, keeping it independent of the #1056 init migration', () => {
  const { name, sql } = aggregateMigration();

  for (const model of BASE_MODELS) {
    assert.ok(
      !new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+"${model}"`).test(sql),
      `${name} must not create "${model}"; that belongs to the #1056 init migration`,
    );
  }
});
