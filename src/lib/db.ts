import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type DatabaseGlobal = typeof globalThis & {
  misconceptionMapDatabase?: Database.Database;
};

const databaseGlobal = globalThis as DatabaseGlobal;

function createDatabase() {
  const configuredPath = process.env.MISCONCEPTION_MAP_DB_PATH?.trim();
  const databasePath = configuredPath
    ? path.resolve(
        /* turbopackIgnore: true */ process.cwd(),
        configuredPath,
      )
    : path.join(
        /* turbopackIgnore: true */ process.cwd(),
        "data",
        "misconception-map.db",
      );

  // The roster and student work are sensitive local data. A private process
  // umask also covers SQLite WAL/SHM sidecars created after startup.
  process.umask(0o077);

  const databaseDirectory = path.dirname(databasePath);
  fs.mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
  if (!configuredPath) {
    fs.chmodSync(databaseDirectory, 0o700);
  }

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
