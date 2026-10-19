
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  connectionTimeoutMillis: Number(
    process.env.DB_CONNECT_TIMEOUT_MS ?? 5000
  ),
  idleTimeoutMillis: Number(
    process.env.DB_IDLE_TIMEOUT_MS ?? 30000
  )
});

pool.on("error", (error) => {
  console.error("Unexpected idle database connection error", {
    name: error.name,
    message: error.message
  });
});

export const db = drizzle(pool, {
  schema
});
