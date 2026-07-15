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
const db = new Database(databasePath, { fileMustExist: true, readonly: true });

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

try {
  db.pragma("foreign_keys = ON");
  const integrity = db.pragma("integrity_check", { simple: true });
  const foreignKeyViolations = db.pragma("foreign_key_check");

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
  const requiredTables = [
    "ai_runs",
    "answer_versions",
    "app_meta",
    "assignment_source_extractions",
    "assignment_sources",
    "assignment_items",
    "assignments",
    "audit_events",
    "class_memberships",
    "classes",
    "diagnoses",
    "diagnosis_candidates",
    "diagnosis_run_targets",
    "diagnosis_reviews",
    "diagnosis_steps",
    "prediction_invalidations",
    "prediction_outcome_versions",
    "predictions",
    "problems",
    "schema_migrations",
    "student_model_evidence",
    "student_model_finalizations",
    "student_model_hypotheses",
    "student_model_reviews",
    "student_model_versions",
    "students",
    "submission_answers",
    "submission_assets",
    "submissions",
    "taxonomy_sources",
    "taxonomy_term_sources",
    "taxonomy_terms",
    "taxonomy_versions",
    "teaching_brief_evidence",
    "teaching_briefs",
    "upload_batches",
    "worksheet_items",
    "worksheets",
  ];
  const missingTables = requiredTables.filter((table) => !tables.includes(table));

  const requiredViews = [
    "current_student_model_versions",
    "student_prediction_metrics",
  ];
  const views = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
    .all()
    .map((row) => row.name);
  const missingViews = requiredViews.filter((view) => !views.includes(view));

  const requiredTriggers = [
    "ai_run_provenance_is_immutable",
    "answer_versions_are_immutable",
    "assignment_item_provenance_is_immutable",
    "assignment_source_extractions_are_immutable",
    "audit_events_are_immutable",
    "class_membership_identity_is_immutable",
    "classes_delete_immutable_graph_in_order",
    "classes_preserve_demo_identity",
    "definitive_diagnoses_require_confidence",
    "diagnoses_ai_run_is_scoped",
    "diagnoses_match_run_target",
    "diagnoses_are_immutable",
    "diagnosis_candidates_are_immutable",
    "diagnosis_run_targets_are_immutable",
    "diagnosis_run_targets_are_scoped",
    "diagnosis_run_targets_cannot_be_deleted_directly",
    "diagnosis_review_reasons_must_be_array",
    "diagnosis_reviews_are_immutable",
    "diagnosis_steps_are_immutable",
    "confirmed_assignment_sources_are_immutable",
    "late_prior_work_invalidates_prediction",
    "live_diagnosis_timestamp_is_current",
    "live_prediction_lock_is_current",
    "model_supersession_invalidates_predictions",
    "live_student_model_evidence_timestamp_is_current",
    "live_student_model_timestamp_is_current",
    "prediction_ai_run_is_scoped",
    "prediction_answer_not_reused_across_predictions",
    "prediction_invalidations_are_immutable",
    "prediction_invalidations_cannot_be_deleted_directly",
    "prediction_outcomes_are_immutable",
    "prediction_outcomes_cannot_be_deleted_directly",
    "prediction_outcomes_match_locked_prediction",
    "prediction_outcomes_reject_unaudited_ai_review",
    "prediction_outcome_timeline_is_valid",
    "prediction_trace_must_be_object",
    "predictions_are_held_out_and_truthful",
    "predictions_are_immutable",
    "predictions_cannot_be_deleted_directly",
    "predictions_match_model_student",
    "predictions_reject_any_preexisting_answer",
    "predictions_reject_duplicate_problem_content",
    "problems_are_immutable",
    "student_model_ai_run_is_scoped",
    "student_model_evidence_cannot_be_deleted_directly",
    "student_model_evidence_is_immutable",
    "student_model_evidence_matches_student",
    "student_model_evidence_requires_open_candidate",
    "student_model_finalization_has_temporal_integrity",
    "student_model_finalization_is_evidence_backed",
    "student_model_finalization_updates_status",
    "student_model_finalizations_are_immutable",
    "student_model_finalizations_cannot_be_deleted_directly",
    "student_model_hypothesis_domain_matches_taxonomy",
    "student_model_hypotheses_only_retire",
    "student_model_json_shapes",
    "student_model_reviews_are_immutable",
    "student_model_versions_delete_scoped_artifacts",
    "student_model_versions_only_controlled_transitions",
    "student_model_versions_start_provisional",
    "submission_answers_are_immutable",
    "submission_answer_region_is_valid_on_insert",
    "submission_answer_region_is_valid_on_update",
    "submission_assignment_item_is_immutable",
    "submissions_require_scoped_assignment_item",
    "submissions_preserve_observed_identity",
    "supported_models_require_distinct_problem_content",
    "taxonomy_sources_are_immutable",
    "taxonomy_sources_cannot_be_deleted",
    "taxonomy_term_sources_are_immutable",
    "taxonomy_term_sources_cannot_be_deleted",
    "taxonomy_terms_are_immutable",
    "taxonomy_terms_cannot_be_deleted",
    "taxonomy_versions_are_immutable",
    "taxonomy_versions_cannot_be_deleted",
    "targeted_diagnosis_runs_cannot_be_deleted_directly",
    "teaching_brief_ai_run_is_scoped",
    "teaching_brief_evidence_is_scoped",
    "teaching_brief_evidence_is_immutable",
    "teaching_brief_supersession_is_scoped",
    "teaching_briefs_are_immutable",
    "upload_batches_delete_scoped_submissions",
    "worksheet_ai_run_is_scoped",
    "worksheet_items_are_immutable",
    "worksheet_items_match_model_term",
    "worksheet_supersession_is_scoped",
    "worksheets_match_model_scope",
    "worksheets_preserve_provenance",
  ];
  const triggers = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .all()
    .map((row) => row.name);
  const missingTriggers = requiredTriggers.filter(
    (trigger) => !triggers.includes(trigger),
  );

  const migrationFileNames = fs
    .readdirSync(migrationsPath)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const invalidMigrationNames = migrationFileNames.filter(
    (file) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(file),
  );
  const expectedMigrations = new Map(
    migrationFileNames.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(migrationsPath, file), "utf8"))
        .digest("hex"),
    ]),
  );
  const appliedMigrations = db
    .prepare("SELECT name, checksum FROM schema_migrations ORDER BY name")
    .all();
  const appliedMigrationMap = new Map(
    appliedMigrations.map((migration) => [migration.name, migration.checksum]),
  );
  const migrationLedgerIssues = [
    ...invalidMigrationNames.map((name) => `invalid filename ${name}`),
    ...[...expectedMigrations].flatMap(([name, checksum]) => {
      if (!appliedMigrationMap.has(name)) return [`missing ${name}`];
      if (appliedMigrationMap.get(name) !== checksum) {
        return [`checksum mismatch ${name}`];
      }
      return [];
    }),
    ...[...appliedMigrationMap.keys()]
      .filter((name) => !expectedMigrations.has(name))
      .map((name) => `unexpected ${name}`),
  ];

  const taxonomyVersion = db
    .prepare("SELECT content_hash FROM taxonomy_versions WHERE version = ?")
    .get(TAXONOMY_SNAPSHOT.version);
  const expectedTaxonomyHash = createHash("sha256")
    .update(JSON.stringify(TAXONOMY_SNAPSHOT))
    .digest("hex");
  const storedSources = db
    .prepare(
      "SELECT source_id, citation_json FROM taxonomy_sources WHERE taxonomy_version = ? ORDER BY source_id",
    )
    .all(TAXONOMY_SNAPSHOT.version)
    .map((source) => ({
      source_id: source.source_id,
      citation_json: canonicalJson(JSON.parse(source.citation_json)),
    }));
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
    .all(TAXONOMY_SNAPSHOT.version)
    .map((term) => ({
      ...term,
      term_json: canonicalJson(JSON.parse(term.term_json)),
    }));
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
    .all(TAXONOMY_SNAPSHOT.version);
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
  const taxonomyRowsMatch =
    canonicalJson(storedSources) === canonicalJson(expectedSources) &&
    canonicalJson(storedTerms) === canonicalJson(expectedTerms) &&
    canonicalJson(storedLinks) === canonicalJson(expectedLinks);

  const failures = {
    integrity: integrity === "ok" ? [] : [integrity],
    foreignKeys: foreignKeyViolations,
    missingTables,
    missingViews,
    missingTriggers,
    migrationLedgerIssues,
    taxonomyHash:
      taxonomyVersion?.content_hash === expectedTaxonomyHash
        ? []
        : ["content hash mismatch"],
    taxonomyRows: taxonomyRowsMatch ? [] : ["stored rows differ from code"],
  };
  const hasFailures = Object.values(failures).some((items) => items.length > 0);

  if (hasFailures) {
    throw new Error(`Database check failed: ${JSON.stringify(failures)}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        database: path.relative(root, databasePath) || databasePath,
        tableCount: tables.length,
        migrationCount: appliedMigrations.length,
        taxonomyVersion: TAXONOMY_SNAPSHOT.version,
        misconceptionCount: TAXONOMY_SNAPSHOT.misconceptions.length,
        taxonomySnapshotExact: taxonomyRowsMatch,
        views: requiredViews,
        integrity,
        foreignKeyViolations: foreignKeyViolations.length,
        migrationLedgerIssues,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
