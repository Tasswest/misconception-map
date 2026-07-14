import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type DatabaseGlobal = typeof globalThis & {
  misconceptionMapDatabase?: Database.Database;
};

const databaseGlobal = globalThis as DatabaseGlobal;

function createDatabase() {
  const databasePath = path.join(
    process.cwd(),
    "data",
    "misconception-map.db",
  );

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  return database;
}

export function getDatabase() {
  if (!databaseGlobal.misconceptionMapDatabase) {
    databaseGlobal.misconceptionMapDatabase = createDatabase();
  }

  return databaseGlobal.misconceptionMapDatabase;
}
