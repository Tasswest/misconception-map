import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const root = process.cwd();
const databasePath = path.join(root, "data", "misconception-map.db");
const migrationsPath = path.join(root, "db", "migrations");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.exec(
  [
    "CREATE TABLE IF NOT EXISTS schema_migrations (",
    "name TEXT PRIMARY KEY,",
    "checksum TEXT NOT NULL,",
    "applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    ")",
  ].join(" "),
);

const migrationFiles = fs
  .readdirSync(migrationsPath)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right));

const findMigration = db.prepare(
  "SELECT checksum FROM schema_migrations WHERE name = ?",
);
const recordMigration = db.prepare(
  "INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)",
);

let appliedCount = 0;

try {
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsPath, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = findMigration.get(file);

    if (applied) {
      if (applied.checksum !== checksum) {
        throw new Error("Applied migration " + file + " has changed on disk.");
      }
      continue;
    }

    db.transaction(() => {
      db.exec(sql);
      recordMigration.run(file, checksum);
    })();
    appliedCount += 1;
  }

  const relativePath = path.relative(root, databasePath) || databasePath;
  console.log(
    appliedCount === 0
      ? "Database is current at " + relativePath + "."
      : "Applied " +
          appliedCount +
          " migration(s) to " +
          relativePath +
          ".",
  );
} finally {
  db.close();
}
