import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const root = process.cwd();
const databasePath = path.join(root, "data", "misconception-map.db");
const db = new Database(databasePath, { fileMustExist: true, readonly: true });

try {
  const integrity = db.pragma("integrity_check", { simple: true });
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  const requiredTables = ["app_meta", "schema_migrations"];
  const missing = requiredTables.filter((table) => !tables.includes(table));

  if (integrity !== "ok" || missing.length > 0) {
    throw new Error(
      "Database check failed. Integrity: " +
        integrity +
        "; missing: " +
        (missing.join(", ") || "none") +
        ".",
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        database: path.relative(root, databasePath) || databasePath,
        tables,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
