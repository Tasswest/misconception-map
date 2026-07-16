import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

import { seedDemoDatabase } from "../src/server/demo/seed-database.mjs";

const configuredDataDirectory = process.env.DATA_DIR?.trim();
const databasePath = process.env.MISCONCEPTION_MAP_DB_PATH?.trim()
  ? path.resolve(process.cwd(), process.env.MISCONCEPTION_MAP_DB_PATH.trim())
  : configuredDataDirectory
    ? path.join(
        path.resolve(process.cwd(), configuredDataDirectory),
        "misconception-map.db",
      )
    : path.join(process.cwd(), "data", "misconception-map.db");
const database = new Database(databasePath);
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");

const result = seedDemoDatabase(database);
database.close();

console.log(
  result.created
    ? "Loaded the 20-learner synthetic demo classroom with held-out Prediction Lab history."
    : "Synthetic demo classroom already exists; active demo views were restored without replacing live work.",
);
