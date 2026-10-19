import "dotenv/config";

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Client, Pool } = pg;

const sourceUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!sourceUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
}

const testUrl = new URL(sourceUrl);

if (!process.env.TEST_DATABASE_URL) {
  testUrl.pathname = "/fts_rebuild_test";
}

const databaseName = decodeURIComponent(testUrl.pathname.slice(1));

if (!/_test$/.test(databaseName)) {
  throw new Error(
    `Refusing to run integration tests against non-test database: ${databaseName}`
  );
}

const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";

const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();

try {
  const existing = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [databaseName]
  );

  if (existing.rowCount === 0) {
    const quotedName = `"${databaseName.replaceAll('"', '""')}"`;
    await admin.query(`CREATE DATABASE ${quotedName}`);
  }
} finally {
  await admin.end();
}

const migrationPool = new Pool({ connectionString: testUrl.toString() });
try {
  await migrate(drizzle(migrationPool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url))
  });
} finally {
  await migrationPool.end();
}

const child = spawn(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.integration.config.ts"
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: testUrl.toString(),
      BOOTSTRAP_TOKEN: "integration-test-bootstrap-token"
    }
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
