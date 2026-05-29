import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

/** Open (or create) a SQLite database, provision the schema, and return a Drizzle handle. */
export function createDb(path: string = process.env.DB_PATH ?? "mc.db"): DrizzleDb {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(schema.SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}
