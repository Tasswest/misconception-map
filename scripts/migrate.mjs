import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import { TAXONOMY_SNAPSHOT } from "../src/domain/misconception-taxonomy.mjs";

const root = process.cwd();
const databasePath = process.env.MISCONCEPTION_MAP_DB_PATH?.trim()
  ? path.resolve(root, process.env.MISCONCEPTION_MAP_DB_PATH.trim())
  : path.join(root, "data", "misconception-map.db");
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

const sqlFiles = fs
  .readdirSync(migrationsPath)
  .filter((file) => file.endsWith(".sql"));
const invalidMigrationFiles = sqlFiles.filter(
  (file) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(file),
);

if (invalidMigrationFiles.length > 0) {
  throw new Error(
    "Migration filenames must use a zero-padded prefix: " +
      invalidMigrationFiles.join(", "),
  );
}

const migrationFiles = sqlFiles.sort((left, right) =>
  left.localeCompare(right),
);

const findMigration = db.prepare(
  "SELECT checksum FROM schema_migrations WHERE name = ?",
);
const recordMigration = db.prepare(
  "INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)",
);

let appliedCount = 0;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireTaxonomySnapshotRows() {
  const version = TAXONOMY_SNAPSHOT.version;
  const storedSources = db
    .prepare(
      "SELECT source_id, citation_json FROM taxonomy_sources WHERE taxonomy_version = ? ORDER BY source_id",
    )
    .all(version);
  const expectedSources = [...TAXONOMY_SNAPSHOT.researchSources]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((source) => ({
      source_id: source.id,
      citation_json: canonicalJson(source),
    }));
  const storedTerms = db
    .prepare(
      [
        "SELECT misconception_id, domain, label, definition, citation_note, term_json",
        "FROM taxonomy_terms WHERE taxonomy_version = ? ORDER BY misconception_id",
      ].join(" "),
    )
    .all(version)
    .map((term) => ({ ...term, term_json: canonicalJson(JSON.parse(term.term_json)) }));
  const expectedTerms = [...TAXONOMY_SNAPSHOT.misconceptions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((term) => ({
      misconception_id: term.id,
      domain: term.domain,
      label: term.label,
      definition: term.definition,
      citation_note: term.citationNote,
      term_json: canonicalJson(term),
    }));
  const storedLinks = db
    .prepare(
      [
        "SELECT misconception_id, source_id FROM taxonomy_term_sources",
        "WHERE taxonomy_version = ? ORDER BY misconception_id, source_id",
      ].join(" "),
    )
    .all(version);
  const expectedLinks = TAXONOMY_SNAPSHOT.misconceptions
    .flatMap((term) =>
      term.sourceIds.map((sourceId) => ({
        misconception_id: term.id,
        source_id: sourceId,
      })),
    )
    .sort((left, right) =>
      `${left.misconception_id}:${left.source_id}`.localeCompare(
        `${right.misconception_id}:${right.source_id}`,
      ),
    );

  const normalizedStoredSources = storedSources.map((source) => ({
    source_id: source.source_id,
    citation_json: canonicalJson(JSON.parse(source.citation_json)),
  }));

  if (
    canonicalJson(normalizedStoredSources) !== canonicalJson(expectedSources) ||
    canonicalJson(storedTerms) !== canonicalJson(expectedTerms) ||
    canonicalJson(storedLinks) !== canonicalJson(expectedLinks)
  ) {
    throw new Error(
      "Taxonomy snapshot " + version + " does not match its code-authored rows.",
    );
  }
}

function synchronizeTaxonomy() {
  const snapshotJson = JSON.stringify(TAXONOMY_SNAPSHOT);
  const contentHash = createHash("sha256").update(snapshotJson).digest("hex");
  const existing = db
    .prepare(
      "SELECT content_hash FROM taxonomy_versions WHERE version = ?",
    )
    .get(TAXONOMY_SNAPSHOT.version);

  if (existing) {
    if (existing.content_hash !== contentHash) {
      throw new Error(
        "Taxonomy version " +
          TAXONOMY_SNAPSHOT.version +
          " changed. Bump TAXONOMY_VERSION instead of rewriting history.",
      );
    }

    requireTaxonomySnapshotRows();
    return false;
  }

  const insertVersion = db.prepare(
    "INSERT INTO taxonomy_versions (version, label, content_hash) VALUES (?, ?, ?)",
  );
  const insertSource = db.prepare(
    "INSERT INTO taxonomy_sources (taxonomy_version, source_id, citation_json) VALUES (?, ?, ?)",
  );
  const insertTerm = db.prepare(
    [
      "INSERT INTO taxonomy_terms",
      "(taxonomy_version, misconception_id, domain, label, definition, citation_note, term_json)",
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ].join(" "),
  );
  const insertTermSource = db.prepare(
    "INSERT INTO taxonomy_term_sources (taxonomy_version, misconception_id, source_id) VALUES (?, ?, ?)",
  );

  db.transaction(() => {
    insertVersion.run(
      TAXONOMY_SNAPSHOT.version,
      "Middle-school algebra and fractions taxonomy",
      contentHash,
    );

    for (const source of TAXONOMY_SNAPSHOT.researchSources) {
      insertSource.run(
        TAXONOMY_SNAPSHOT.version,
        source.id,
        JSON.stringify(source),
      );
    }

    for (const misconception of TAXONOMY_SNAPSHOT.misconceptions) {
      insertTerm.run(
        TAXONOMY_SNAPSHOT.version,
        misconception.id,
        misconception.domain,
        misconception.label,
        misconception.definition,
        misconception.citationNote,
        JSON.stringify(misconception),
      );

      for (const sourceId of misconception.sourceIds) {
        insertTermSource.run(
          TAXONOMY_SNAPSHOT.version,
          misconception.id,
          sourceId,
        );
      }
    }
  })();

  return true;
}

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

  const taxonomyAdded = synchronizeTaxonomy();

  const relativePath = path.relative(root, databasePath) || databasePath;
  console.log(
    appliedCount === 0 && !taxonomyAdded
      ? "Database and taxonomy are current at " + relativePath + "."
      : "Applied " +
          appliedCount +
          " migration(s) and synchronized taxonomy " +
          TAXONOMY_SNAPSHOT.version +
          " to " +
          relativePath +
          ".",
  );
} finally {
  db.close();
}
