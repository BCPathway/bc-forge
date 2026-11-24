#!/usr/bin/env node

/**
 * Database backup utility for the BC Forge indexer.
 *
 * Supported databases:
 * - PostgreSQL: pg_dump -> gzip
 * - SQLite: sqlite3 .backup -> gzip
 *
 * Outputs:
 * - Compressed database backup (.gz)
 * - Metadata manifest (.metadata.json)
 *
 * Environment:
 * - DATABASE_URL: PostgreSQL connection string
 * - DATABASE_TYPE: "postgres" | "sqlite"
 * - SQLITE_PATH: SQLite database file path
 *
 * Usage:
 *   tsx scripts/backup.ts
 *   tsx scripts/backup.ts --output ./backups
 *   tsx scripts/backup.ts --database postgres --output ./backups
 *   tsx scripts/backup.ts --database sqlite --filename my-backup.gz
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createGzip, gunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type DatabaseType = "postgres" | "sqlite";

interface BackupOptions {
  database: DatabaseType;
  outputDirectory: string;
  filename?: string;
}

interface BackupMetadata {
  version: 1;
  database: DatabaseType;
  filename: string;
  createdAt: string;
  compression: "gzip";
  checksumAlgorithm: "sha256";
  checksum: string;
  sizeBytes: number;
}

interface CliOptions {
  output?: string;
  database?: DatabaseType;
  filename?: string;
  help: boolean;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_OUTPUT_DIRECTORY = "./backups";

const SQLITE_PATH_ENV = "SQLITE_PATH";
const DATABASE_URL_ENV = "DATABASE_URL";
const DATABASE_TYPE_ENV = "DATABASE_TYPE";

const EXIT_FAILURE = 1;

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function printUsage(): void {
  console.log(`
Indexer Database Backup

Usage:
  tsx scripts/backup.ts [options]

Options:
  --output <directory>    Backup output directory (default: ${DEFAULT_OUTPUT_DIRECTORY})
  --database <type>       Database type: postgres | sqlite
  --filename <name>       Custom backup filename
  --help                 Display this help message

Environment:
  DATABASE_TYPE          postgres | sqlite
  DATABASE_URL          PostgreSQL connection string
  SQLITE_PATH           SQLite database file path

Examples:
  tsx scripts/backup.ts
  tsx scripts/backup.ts --output ./backups
  tsx scripts/backup.ts --database sqlite --output ./backups
  tsx scripts/backup.ts --filename indexer-backup.gz
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];

    switch (argument) {
      case "--help":
      case "-h":
        options.help = true;
        break;

      case "--output":
        options.output = args[++i];
        if (!options.output) {
          throw new Error("--output requires a directory path");
        }
        break;

      case "--database":
        options.database = parseDatabaseType(args[++i]);
        break;

      case "--filename":
        options.filename = args[++i];
        if (!options.filename) {
          throw new Error("--filename requires a filename");
        }
        break;

      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

/* -------------------------------------------------------------------------- */
/* Database configuration                                                     */
/* -------------------------------------------------------------------------- */

function parseDatabaseType(value: string | undefined): DatabaseType {
  if (value === "postgres" || value === "sqlite") {
    return value;
  }

  throw new Error(
    `Invalid database type "${value}". Expected "postgres" or "sqlite".`,
  );
}

function resolveDatabaseType(explicitType?: DatabaseType): DatabaseType {
  if (explicitType) {
    return explicitType;
  }

  const environmentType = process.env[DATABASE_TYPE_ENV];

  if (environmentType) {
    return parseDatabaseType(environmentType);
  }

  // Infer from available configuration when DATABASE_TYPE is not set.
  if (process.env[DATABASE_URL_ENV]) {
    return "postgres";
  }

  if (process.env[SQLITE_PATH_ENV]) {
    return "sqlite";
  }

  throw new Error(
    `Database type not configured. Set ${DATABASE_TYPE_ENV}, ${DATABASE_URL_ENV}, or ${SQLITE_PATH_ENV}.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function createDefaultFilename(database: DatabaseType): string {
  return `indexer-${database}-backup-${timestampForFilename()}.gz`;
}

function validateFilename(filename: string): void {
  if (filename.includes("/") || filename.includes("\\")) {
    throw new Error("Backup filename must not contain directory separators.");
  }

  if (!filename.endsWith(".gz")) {
    throw new Error("Backup filename must end with .gz");
  }

  if (filename.trim().length === 0) {
    throw new Error("Backup filename cannot be empty.");
  }
}

function assertExecutableAvailable(command: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ["--version"], {
      stdio: "ignore",
    });

    child.once("error", (error) => {
      reject(
        new Error(
          `Required executable "${command}" is unavailable: ${error.message}`,
        ),
      );
    });

    child.once("close", (code) => {
      if (code === 0 || code === null) {
        resolvePromise();
        return;
      }

      // Some CLI tools don't support --version consistently.
      resolvePromise();
    });
  });
}

function runCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
  } = {},
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: options.env ?? process.env,
      cwd: options.cwd,
    });

    child.once("error", (error) => {
      reject(
        new Error(`Failed to start ${command}: ${error.message}`),
      );
    });

    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(
        new Error(
          `${command} failed (exit code: ${code ?? "null"}, signal: ${signal ?? "none"})`,
        ),
      );
    });
  });
}

async function calculateSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  await pipeline(
    createReadStream(filePath),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    async function* (source) {
      for await (const chunk of source) {
        yield chunk;
      }
    },
  );

  return hash.digest("hex");
}

async function verifyGzip(filePath: string): Promise<void> {
  // Fully decompress the file to validate gzip structure.
  await pipeline(
    createReadStream(filePath),
    gunzip(),
    async function* (source) {
      for await (const _chunk of source) {
        // Consume the entire stream to force integrity checks.
      }
    },
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* PostgreSQL backup                                                          */
/* -------------------------------------------------------------------------- */

async function createPostgresDump(outputPath: string): Promise<void> {
  const databaseUrl = process.env[DATABASE_URL_ENV];

  if (!databaseUrl) {
    throw new Error(`${DATABASE_URL_ENV} is required for PostgreSQL backups.`);
  }

  await assertExecutableAvailable("pg_dump");

  const temporaryDump = `${outputPath}.partial`;

  try {
    // Use plain SQL output. pg_dump writes to stdout.
    const child = spawn(
      "pg_dump",
      [
        "--no-owner",
        "--no-privileges",
        "--format=plain",
        "--dbname",
        databaseUrl,
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
      },
    );

    const gzipStream = createGzip({
      level: 9,
    });

    const outputStream = createWriteStream(temporaryDump, {
      flags: "wx",
    });

    const processPromise = new Promise<void>((resolvePromise, reject) => {
      child.once("error", reject);

      child.once("close", (code, signal) => {
        if (code === 0) {
          resolvePromise();
          return;
        }

        reject(
          new Error(
            `pg_dump failed (exit code: ${code ?? "null"}, signal: ${signal ?? "none"})`,
          ),
        );
      });
    });

    await Promise.all([
      pipeline(child.stdout, gzipStream, outputStream),
      processPromise,
    ]);

    await verifyGzip(temporaryDump);
    await rename(temporaryDump, outputPath);
  } catch (error) {
    await rm(temporaryDump, { force: true }).catch(() => undefined);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* SQLite backup                                                             */
/* -------------------------------------------------------------------------- */

async function createSqliteDump(outputPath: string): Promise<void> {
  const sqlitePath = process.env[SQLITE_PATH_ENV];

  if (!sqlitePath) {
    throw new Error(`${SQLITE_PATH_ENV} is required for SQLite backups.`);
  }

  const resolvedSqlitePath = resolve(sqlitePath);

  if (!(await fileExists(resolvedSqlitePath))) {
    throw new Error(`SQLite database not found: ${resolvedSqlitePath}`);
  }

  await assertExecutableAvailable("sqlite3");

  const temporaryDatabase = `${outputPath}.sqlite.partial`;
  const temporaryCompressed = `${outputPath}.partial`;

  try {
    // Use SQLite's backup command instead of copying an active database file.
    await runCommand("sqlite3", [
      resolvedSqlitePath,
      `.backup '${temporaryDatabase.replace(/'/g, "''")}'`,
    ]);

    if (!(await fileExists(temporaryDatabase))) {
      throw new Error("SQLite backup command completed but no backup was created.");
    }

    // Compress the completed snapshot.
    await pipeline(
      createReadStream(temporaryDatabase),
      createGzip({ level: 9 }),
      createWriteStream(temporaryCompressed, { flags: "wx" }),
    );

    await verifyGzip(temporaryCompressed);
    await rename(temporaryCompressed, outputPath);
  } catch (error) {
    await rm(temporaryDatabase, { force: true }).catch(() => undefined);
    await rm(temporaryCompressed, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(temporaryDatabase, { force: true }).catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* Backup metadata                                                            */
/* -------------------------------------------------------------------------- */

async function createMetadata(
  database: DatabaseType,
  filename: string,
  backupPath: string,
): Promise<BackupMetadata> {
  const fileStats = await stat(backupPath);
  const checksum = await calculateSha256(backupPath);

  return {
    version: 1,
    database,
    filename,
    createdAt: new Date().toISOString(),
    compression: "gzip",
    checksumAlgorithm: "sha256",
    checksum,
    sizeBytes: fileStats.size,
  };
}

async function writeMetadata(
  metadata: BackupMetadata,
  outputDirectory: string,
  filename: string,
): Promise<void> {
  const metadataPath = join(
    outputDirectory,
    `${filename}.metadata.json`,
  );

  const temporaryPath = `${metadataPath}.partial`;

  try {
    await pipeline(
      async function* () {
        yield JSON.stringify(metadata, null, 2);
      },
      createWriteStream(temporaryPath, { flags: "wx" }),
    );

    await rename(temporaryPath, metadataPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Main backup operation                                                      */
/* -------------------------------------------------------------------------- */

export async function createBackup(
  options: BackupOptions,
): Promise<BackupMetadata> {
  const database = options.database;
  const outputDirectory = resolve(options.outputDirectory);
  const filename = options.filename ?? createDefaultFilename(database);

  validateFilename(filename);

  await mkdir(outputDirectory, { recursive: true });

  const backupPath = join(outputDirectory, filename);

  if (await fileExists(backupPath)) {
    throw new Error(`Backup already exists; refusing to overwrite: ${backupPath}`);
  }

  console.log(`Starting ${database} backup...`);

  try {
    if (database === "postgres") {
      await createPostgresDump(backupPath);
    } else {
      await createSqliteDump(backupPath);
    }

    await verifyGzip(backupPath);

    const metadata = await createMetadata(
      database,
      filename,
      backupPath,
    );

    await writeMetadata(metadata, outputDirectory, filename);

    console.log("Backup completed successfully.");
    console.log(`Backup file: ${backupPath}`);
    console.log(`Size: ${metadata.sizeBytes} bytes`);
    console.log(`SHA-256: ${metadata.checksum}`);

    return metadata;
  } catch (error) {
    // Avoid retaining an incomplete backup.
    await rm(backupPath, { force: true }).catch(() => undefined);
    await rm(`${backupPath}.partial`, { force: true }).catch(() => undefined);
    await rm(`${backupPath}.metadata.json.partial`, { force: true }).catch(() => undefined);

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* CLI entrypoint                                                            */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const cliOptions = parseArgs(process.argv.slice(2));

  if (cliOptions.help) {
    printUsage();
    return;
  }

  const database = resolveDatabaseType(cliOptions.database);

  const options: BackupOptions = {
    database,
    outputDirectory: cliOptions.output ?? DEFAULT_OUTPUT_DIRECTORY,
    filename: cliOptions.filename,
  };

  await createBackup(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : String(error);

    console.error(`Backup failed: ${message}`);
    process.exitCode = EXIT_FAILURE;
  });
}