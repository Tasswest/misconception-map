import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import {
  MISCONCEPTION_IDS,
  MISCONCEPTIONS,
  TAXONOMY_SNAPSHOT,
  TAXONOMY_VERSION,
} from "../src/domain/misconception-taxonomy.mjs";

const root = process.cwd();
const migrationFiles = fs
  .readdirSync(path.join(root, "db", "migrations"))
  .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right));
const expectedMigrationCount = migrationFiles.length;
const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "misconception-map-phase-one-"),
);
const databasePath = path.join(tempDirectory, "phase-one.db");

function migrate() {
  return spawnSync(process.execPath, [path.join(root, "scripts", "migrate.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      MISCONCEPTION_MAP_DB_PATH: databasePath,
    },
    encoding: "utf8",
  });
}

function expectConstraint(statement, pattern) {
  assert.throws(statement, pattern);
}

function verifyTaxonomy() {
  assert.equal(TAXONOMY_VERSION, "1.0.1");
  assert.equal(MISCONCEPTION_IDS.length, 16);
  assert.equal(MISCONCEPTIONS.length, MISCONCEPTION_IDS.length);
  assert.equal(new Set(MISCONCEPTION_IDS).size, MISCONCEPTION_IDS.length);

  const forbiddenDiagnosisStates = new Set([
    "CORRECT",
    "NEEDS_REVIEW",
    "INSUFFICIENT_EVIDENCE",
    "MULTIPLE_PLAUSIBLE",
  ]);
  const placeholderPattern = /\b(?:todo|tbd|lorem ipsum|citation needed)\b/i;

  for (const misconception of MISCONCEPTIONS) {
    assert.match(misconception.id, /^[A-Z][A-Z0-9_]+$/);
    assert.equal(forbiddenDiagnosisStates.has(misconception.id), false);
    assert.ok(misconception.label.trim());
    assert.ok(misconception.definition.trim());
    assert.ok(misconception.flawedRule.trim());
    assert.ok(misconception.formalPattern.trim());
    assert.ok(misconception.diagnosticSignals.length >= 2);
    assert.ok(misconception.counterEvidence.length >= 1);
    assert.ok(misconception.repairMove.trim());
    assert.ok(misconception.sourceIds.length >= 1);
    assert.ok(misconception.citationNote.trim());
    assert.notEqual(
      misconception.predictionProbe.likelyWrongAnswer,
      misconception.predictionProbe.correctAnswer,
    );
    assert.equal(placeholderPattern.test(JSON.stringify(misconception)), false);
    assert.equal(
      new Set(misconception.diagnosticSignals).size,
      misconception.diagnosticSignals.length,
    );
    assert.equal(
      new Set(misconception.sourceIds).size,
      misconception.sourceIds.length,
    );
  }

  assert.equal(
    new Set(TAXONOMY_SNAPSHOT.researchSources.map((source) => source.id)).size,
    TAXONOMY_SNAPSHOT.researchSources.length,
  );
  assert.equal(
    TAXONOMY_SNAPSHOT.researchSources.find(
      (source) => source.id === "NI_ZHOU_2005",
    ).kind,
    "PEER_REVIEWED_REVIEW",
  );
  assert.equal(
    TAXONOMY_SNAPSHOT.researchSources.find(
      (source) => source.id === "BEHR_ET_AL_1983",
    ).kind,
    "SCHOLARLY_BOOK_CHAPTER",
  );
  assert.match(
    MISCONCEPTIONS.find(
      (term) => term.id === "FRACTION_EQUIVALENCE_ADDITIVE",
    ).citationNote,
    /not direct evidence/i,
  );
}

function verifyDatabase() {
  const firstMigration = migrate();
  assert.equal(
    firstMigration.status,
    0,
    firstMigration.stderr || firstMigration.stdout,
  );
  assert.match(
    firstMigration.stdout,
    new RegExp(`Applied ${expectedMigrationCount} migration\\(s\\)`),
  );

  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");

  const time = {
    problem: "2024-12-01T08:00:00.000Z",
    item: "2024-12-02T08:00:00.000Z",
    oldSubmission: "2025-01-01T09:00:00.000Z",
    oldAnswer: "2025-01-01T09:01:00.000Z",
    diagnosis: "2025-01-02T10:00:00.000Z",
    modelOne: "2025-01-03T10:00:00.000Z",
    supersede: "2025-01-04T10:00:00.000Z",
    modelTwo: "2025-01-04T10:00:00.001Z",
    finalized: "2025-01-05T10:00:00.000Z",
    lock: "2025-02-01T10:00:00.000Z",
    postSubmission: "2025-03-01T09:00:00.000Z",
    postAnswer: "2025-03-01T09:01:00.000Z",
    evaluated: "2025-03-01T09:02:00.000Z",
    outcomeCreated: "2025-03-01T09:03:00.000Z",
  };

  try {
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);

    assert.equal(
      db.prepare("SELECT count(*) AS count FROM schema_migrations").get().count,
      expectedMigrationCount,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS count FROM taxonomy_terms WHERE taxonomy_version = ?",
        )
        .get(TAXONOMY_VERSION).count,
      MISCONCEPTIONS.length,
    );

    const requiredObjects = [
      ["table", "student_model_finalizations"],
      ["table", "diagnosis_run_targets"],
      ["table", "prediction_invalidations"],
      ["view", "student_prediction_metrics"],
      ["trigger", "student_model_finalization_is_evidence_backed"],
      ["trigger", "predictions_are_held_out_and_truthful"],
      ["trigger", "prediction_outcomes_match_locked_prediction"],
      ["trigger", "teaching_brief_evidence_is_scoped"],
      ["trigger", "worksheet_items_are_immutable"],
      ["trigger", "teaching_brief_evidence_is_immutable"],
      ["trigger", "live_prediction_lock_is_current"],
      ["trigger", "predictions_cannot_be_deleted_directly"],
      ["trigger", "predictions_reject_any_preexisting_answer"],
      ["trigger", "diagnoses_match_run_target"],
      ["trigger", "diagnosis_run_targets_are_scoped"],
      ["trigger", "diagnosis_run_targets_are_immutable"],
      ["trigger", "diagnosis_run_targets_cannot_be_deleted_directly"],
      ["trigger", "targeted_diagnosis_runs_cannot_be_deleted_directly"],
      ["index", "one_prediction_per_student_problem"],
    ];
    const findObject = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
    );
    for (const [type, name] of requiredObjects) {
      assert.ok(findObject.get(type, name), `${type} ${name} must exist`);
    }

    const insertClass = db.prepare(
      "INSERT INTO classes (id, name, grade_band, is_demo) VALUES (?, ?, 'GRADE_7', ?)",
    );
    insertClass.run("class_a", "Algebra 7", 1);
    insertClass.run("class_b", "Fractions 7", 1);
    insertClass.run("class_live", "Live Algebra 7", 0);

    const insertStudent = db.prepare(
      "INSERT INTO students (id, display_name) VALUES (?, ?)",
    );
    insertStudent.run("student_a", "Student A");
    insertStudent.run("student_b", "Student B");
    insertStudent.run("student_live", "Live Student");

    db.prepare(
      "INSERT INTO class_memberships (id, class_id, student_id) VALUES (?, ?, ?)",
    ).run("membership_a", "class_a", "student_a");
    db.prepare(
      "INSERT INTO class_memberships (id, class_id, student_id) VALUES (?, ?, ?)",
    ).run("membership_b", "class_b", "student_b");
    db.prepare(
      "INSERT INTO class_memberships (id, class_id, student_id) VALUES (?, ?, ?)",
    ).run("membership_live", "class_live", "student_live");
    expectConstraint(
      () =>
        db
          .prepare("UPDATE classes SET is_demo = 1 WHERE id = ?")
          .run("class_live"),
      /demo status are immutable/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE class_memberships SET student_id = ? WHERE id = ?",
          )
          .run("student_b", "membership_a"),
      /membership identity is immutable/,
    );

    const insertProblem = db.prepare(
      [
        "INSERT INTO problems",
        "(id, class_id, domain, prompt, answer_format, correct_answer, canonical_correct_answer, origin, content_hash, created_at)",
        "VALUES (@id, @classId, @domain, @prompt, @answerFormat, @correctAnswer, @canonicalCorrectAnswer, 'TEACHER', @contentHash, @createdAt)",
      ].join(" "),
    );
    const problemRows = [
      {
        id: "problem_a1",
        classId: "class_a",
        domain: "ALGEBRA",
        prompt: "Expand −(x + 4).",
        answerFormat: "EXPRESSION",
        correctAnswer: "−x − 4",
        canonicalCorrectAnswer: "-x-4",
        contentHash: "1".repeat(64),
      },
      {
        id: "problem_a2",
        classId: "class_a",
        domain: "ALGEBRA",
        prompt: "Expand 1 − (x + 2).",
        answerFormat: "EXPRESSION",
        correctAnswer: "−x − 1",
        canonicalCorrectAnswer: "-x-1",
        contentHash: "2".repeat(64),
      },
      {
        id: "problem_a3",
        classId: "class_a",
        domain: "ALGEBRA",
        prompt: "Expand −(2x + 7).",
        answerFormat: "EXPRESSION",
        correctAnswer: "−2x − 7",
        canonicalCorrectAnswer: "-2x-7",
        contentHash: "3".repeat(64),
      },
      {
        id: "problem_a4",
        classId: "class_a",
        domain: "ALGEBRA",
        prompt: "Expand 4 − (y + 3).",
        answerFormat: "EXPRESSION",
        correctAnswer: "1 − y",
        canonicalCorrectAnswer: "1-y",
        contentHash: "4".repeat(64),
      },
      {
        id: "problem_a3_clone",
        classId: "class_a",
        domain: "ALGEBRA",
        prompt: "Expand −(2x + 7). (alternate form)",
        answerFormat: "EXPRESSION",
        correctAnswer: "−2x − 7",
        canonicalCorrectAnswer: "-2x-7",
        contentHash: "3".repeat(64),
      },
      {
        id: "problem_a1_clone",
        classId: "class_a",
        domain: "ALGEBRA",
        prompt: "Expand −(x + 4). (semantic clone)",
        answerFormat: "EXPRESSION",
        correctAnswer: "−x − 4",
        canonicalCorrectAnswer: "-x-4",
        contentHash: "1".repeat(64),
      },
      {
        id: "problem_future_recorded",
        classId: "class_a",
        domain: "ALGEBRA",
        prompt: "Expand −(5q + 6).",
        answerFormat: "EXPRESSION",
        correctAnswer: "−5q − 6",
        canonicalCorrectAnswer: "-5q-6",
        contentHash: "9".repeat(64),
      },
      {
        id: "problem_b1",
        classId: "class_b",
        domain: "FRACTIONS",
        prompt: "Compute 1/2 + 1/3.",
        answerFormat: "FRACTION",
        correctAnswer: "5/6",
        canonicalCorrectAnswer: "5/6",
        contentHash: "5".repeat(64),
      },
    ];
    for (const row of problemRows) {
      insertProblem.run({ ...row, createdAt: time.problem });
    }
    expectConstraint(
      () =>
        db
          .prepare("UPDATE problems SET prompt = 'changed' WHERE id = ?")
          .run("problem_a1"),
      /problems are immutable/,
    );

    const insertAssignment = db.prepare(
      "INSERT INTO assignments (id, class_id, title, domain) VALUES (?, ?, ?, ?)",
    );
    insertAssignment.run(
      "assignment_a",
      "class_a",
      "Distribute negatives",
      "ALGEBRA",
    );
    insertAssignment.run(
      "assignment_b",
      "class_b",
      "Add fractions",
      "FRACTIONS",
    );

    const insertItem = db.prepare(
      [
        "INSERT INTO assignment_items",
        "(id, class_id, assignment_id, problem_id, position, created_at)",
        "VALUES (?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    insertItem.run(
      "item_a1",
      "class_a",
      "assignment_a",
      "problem_a1",
      1,
      time.item,
    );
    insertItem.run(
      "item_a2",
      "class_a",
      "assignment_a",
      "problem_a2",
      2,
      time.item,
    );
    insertItem.run(
      "item_a3",
      "class_a",
      "assignment_a",
      "problem_a3",
      3,
      time.item,
    );
    insertItem.run(
      "item_a4",
      "class_a",
      "assignment_a",
      "problem_a4",
      4,
      time.item,
    );
    insertItem.run(
      "item_a3_clone",
      "class_a",
      "assignment_a",
      "problem_a3_clone",
      5,
      time.item,
    );
    insertItem.run(
      "item_a1_clone",
      "class_a",
      "assignment_a",
      "problem_a1_clone",
      6,
      time.item,
    );
    insertItem.run(
      "item_future_recorded",
      "class_a",
      "assignment_a",
      "problem_future_recorded",
      7,
      time.item,
    );
    insertItem.run(
      "item_b1",
      "class_b",
      "assignment_b",
      "problem_b1",
      1,
      time.item,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE assignment_items SET problem_id = ? WHERE id = ?",
          )
          .run("problem_a2", "item_a1"),
      /assignment item provenance is immutable/,
    );

    const insertSubmission = db.prepare(
      [
        "INSERT INTO submissions",
        "(id, class_id, assignment_id, assignment_item_id, membership_id, attempt_number, input_kind, submitted_at)",
        "VALUES (?, ?, ?, ?, ?, ?, 'TYPED', ?)",
      ].join(" "),
    );
    insertSubmission.run(
      "submission_a",
      "class_a",
      "assignment_a",
      "item_a1",
      "membership_a",
      1,
      time.oldSubmission,
    );
    insertSubmission.run(
      "submission_b",
      "class_b",
      "assignment_b",
      "item_b1",
      "membership_b",
      1,
      time.oldSubmission,
    );
    insertSubmission.run(
      "submission_a_future_recorded",
      "class_a",
      "assignment_a",
      "item_future_recorded",
      "membership_a",
      3,
      time.postSubmission,
    );
    expectConstraint(
      () =>
        insertSubmission.run(
          "submission_cross_class",
          "class_a",
          "assignment_a",
          "item_a1",
          "membership_b",
          1,
          time.oldSubmission,
        ),
      /FOREIGN KEY constraint failed/,
    );
    expectConstraint(
      () =>
        db
          .prepare("UPDATE submissions SET submitted_at = ? WHERE id = ?")
          .run(time.postSubmission, "submission_a"),
      /submission identity and observed timestamp are immutable/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE submissions SET assignment_item_id = NULL WHERE id = ?",
          )
          .run("submission_a"),
      /submission assignment context is immutable/,
    );

    const insertAnswer = db.prepare(
      [
        "INSERT INTO submission_answers",
        "(id, submission_id, assignment_id, class_id, assignment_item_id, position)",
        "VALUES (?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    insertAnswer.run(
      "answer_a1",
      "submission_a",
      "assignment_a",
      "class_a",
      "item_a1",
      1,
    );
    insertAnswer.run(
      "answer_a2",
      "submission_a",
      "assignment_a",
      "class_a",
      "item_a2",
      2,
    );
    insertAnswer.run(
      "answer_b1",
      "submission_b",
      "assignment_b",
      "class_b",
      "item_b1",
      1,
    );
    insertAnswer.run(
      "answer_a1_clone",
      "submission_a",
      "assignment_a",
      "class_a",
      "item_a1_clone",
      3,
    );
    insertAnswer.run(
      "answer_future_recorded",
      "submission_a_future_recorded",
      "assignment_a",
      "class_a",
      "item_future_recorded",
      1,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE submission_answers SET assignment_item_id = ? WHERE id = ?",
          )
          .run("item_a2", "answer_a1"),
      /submission answer provenance is immutable/,
    );

    const insertAnswerVersion = db.prepare(
      [
        "INSERT INTO answer_versions",
        "(id, submission_answer_id, version, response_text, normalized_answer, source, confidence, creator_type, created_at)",
        "VALUES (?, ?, ?, ?, ?, 'TYPED', 1, 'TEACHER', ?)",
      ].join(" "),
    );
    insertAnswerVersion.run(
      "answer_version_a1_v1",
      "answer_a1",
      1,
      "−x + 4",
      "-x+4",
      time.oldAnswer,
    );
    insertAnswerVersion.run(
      "answer_version_a2_v1",
      "answer_a2",
      1,
      "1 − x + 2",
      "1-x+2",
      time.oldAnswer,
    );
    insertAnswerVersion.run(
      "answer_version_a2_v2",
      "answer_a2",
      2,
      "1 − x + 2",
      "1-x+2",
      "2025-01-01T09:01:00.001Z",
    );
    insertAnswerVersion.run(
      "answer_version_a2_v3",
      "answer_a2",
      3,
      "1 − x + 2",
      "1-x+2",
      "2025-01-01T09:01:00.002Z",
    );
    insertAnswerVersion.run(
      "answer_version_a2_v4",
      "answer_a2",
      4,
      "1 − x + 2",
      "1-x+2",
      "2025-01-01T09:01:00.003Z",
    );
    insertAnswerVersion.run(
      "answer_version_b1_v1",
      "answer_b1",
      1,
      "2/5",
      "2/5",
      time.oldAnswer,
    );
    insertAnswerVersion.run(
      "answer_version_a1_clone_v1",
      "answer_a1_clone",
      1,
      "−x + 4",
      "-x+4",
      "2025-01-01T09:01:00.004Z",
    );
    insertAnswerVersion.run(
      "answer_version_future_recorded_v1",
      "answer_future_recorded",
      1,
      "−5q + 6",
      "-5q+6",
      time.postAnswer,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE answer_versions SET response_text = 'changed' WHERE id = ?",
          )
          .run("answer_version_a1_v1"),
      /answer versions are immutable/,
    );

    const insertAiRun = db.prepare(
      [
        "INSERT INTO ai_runs",
        "(id, class_id, purpose, status, model_name, prompt_version, schema_version, created_at)",
        "VALUES (?, ?, ?, 'RUNNING', 'gpt-5.6', ?, ?, ?)",
      ].join(" "),
    );
    insertAiRun.run(
      "run_diag_a",
      "class_a",
      "DIAGNOSIS",
      "diagnosis-v1",
      "diagnosis-schema-v1",
      time.diagnosis,
    );
    insertAiRun.run(
      "run_diag_b",
      "class_b",
      "DIAGNOSIS",
      "diagnosis-v1",
      "diagnosis-schema-v1",
      time.diagnosis,
    );
    const insertDiagnosisRunTarget = db.prepare(
      "INSERT INTO diagnosis_run_targets (ai_run_id, submission_id) VALUES (?, ?)",
    );
    insertDiagnosisRunTarget.run("run_diag_a", "submission_a");
    insertDiagnosisRunTarget.run("run_diag_b", "submission_b");
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE diagnosis_run_targets SET submission_id = ? WHERE ai_run_id = ?",
          )
          .run("submission_a_future_recorded", "run_diag_a"),
      /diagnosis run targets are immutable/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "DELETE FROM diagnosis_run_targets WHERE ai_run_id = ?",
          )
          .run("run_diag_a"),
      /diagnosis run targets cannot be deleted directly/,
    );
    expectConstraint(
      () =>
        db.prepare("DELETE FROM ai_runs WHERE id = ?").run("run_diag_a"),
      /targeted diagnosis runs cannot be deleted directly/,
    );
    insertAiRun.run(
      "run_cross_class_target",
      "class_a",
      "DIAGNOSIS",
      "diagnosis-v1",
      "diagnosis-schema-v1",
      time.diagnosis,
    );
    expectConstraint(
      () =>
        insertDiagnosisRunTarget.run(
          "run_cross_class_target",
          "submission_b",
        ),
      /active diagnosis run to a same-class submission/,
    );
    insertAiRun.run(
      "run_wrong_purpose_target",
      "class_a",
      "PRACTICE",
      "diagnosis-v1",
      "diagnosis-schema-v1",
      time.diagnosis,
    );
    expectConstraint(
      () =>
        insertDiagnosisRunTarget.run(
          "run_wrong_purpose_target",
          "submission_a",
        ),
      /active diagnosis run to a same-class submission/,
    );
    insertAiRun.run(
      "run_diag_a_retry",
      "class_a",
      "DIAGNOSIS",
      "diagnosis-v1",
      "diagnosis-schema-v1",
      time.diagnosis,
    );
    insertDiagnosisRunTarget.run("run_diag_a_retry", "submission_a");
    expectConstraint(
      () =>
        db
          .prepare("UPDATE ai_runs SET class_id = ? WHERE id = ?")
          .run("class_b", "run_diag_a"),
      /AI run provenance is immutable/,
    );
    db.prepare(
      "UPDATE ai_runs SET status = 'SUCCEEDED' WHERE id IN (?, ?)",
    ).run("run_diag_a", "run_diag_b");

    const diagnosisSql = db.prepare(
      [
        "INSERT INTO diagnoses",
        "(id, answer_version_id, version, source, ai_run_id, outcome, taxonomy_version, misconception_id, confidence, severity, transcription, observed_transformation, strategy_variant, evidence_quote, transcription_confidence, reasoning_confidence, image_quality, model_name, prompt_version, schema_version, created_at)",
        "VALUES (@id, @answerVersionId, 1, 'AI', @runId, @outcome, @taxonomyVersion, @misconceptionId, @confidence, @severity, @transcription, @transformation, @strategy, @evidence, 0.98, 0.91, 'NOT_APPLICABLE', 'gpt-5.6', 'diagnosis-v1', 'diagnosis-schema-v1', @createdAt)",
      ].join(" "),
    );
    const diagnosisBase = {
      runId: "run_diag_a",
      outcome: "MISCONCEPTION",
      taxonomyVersion: TAXONOMY_VERSION,
      misconceptionId: "SIGN_ERROR_DISTRIBUTION",
      confidence: 0.91,
      severity: 3,
      transcription: "work",
      transformation: "negates first term only",
      strategy: "NEGATES_FIRST_TERM_ONLY",
      evidence: "visible sign pattern",
      createdAt: time.diagnosis,
    };
    expectConstraint(
      () =>
        diagnosisSql.run({
          ...diagnosisBase,
          id: "diagnosis_bad_confidence",
          answerVersionId: "answer_version_a2_v1",
          confidence: 1.1,
        }),
      /CHECK constraint failed/,
    );
    expectConstraint(
      () =>
        diagnosisSql.run({
          ...diagnosisBase,
          id: "diagnosis_invented_term",
          answerVersionId: "answer_version_a2_v2",
          misconceptionId: "MODEL_INVENTED_ID",
        }),
      /FOREIGN KEY constraint failed/,
    );
    expectConstraint(
      () =>
        diagnosisSql.run({
          ...diagnosisBase,
          id: "diagnosis_low_confidence",
          answerVersionId: "answer_version_a2_v3",
          confidence: 0.5,
        }),
      /low-confidence work must use a review or abstention outcome/,
    );
    expectConstraint(
      () =>
        diagnosisSql.run({
          ...diagnosisBase,
          id: "diagnosis_wrong_run",
          answerVersionId: "answer_version_a2_v4",
          runId: "run_diag_b",
        }),
      /same-class diagnosis run|exact submission answer/,
    );
    expectConstraint(
      () =>
        diagnosisSql.run({
          ...diagnosisBase,
          id: "diagnosis_same_class_wrong_submission",
          answerVersionId: "answer_version_future_recorded_v1",
        }),
      /exact submission answer/,
    );
    diagnosisSql.run({
      ...diagnosisBase,
      id: "diagnosis_a1",
      answerVersionId: "answer_version_a1_v1",
      transcription: "−(x + 4) = −x + 4",
      transformation: "−(x + 4) → −x + 4",
      evidence: "−x + 4",
    });
    diagnosisSql.run({
      ...diagnosisBase,
      id: "diagnosis_a2",
      answerVersionId: "answer_version_a2_v1",
      transcription: "1 − (x + 2) = 1 − x + 2",
      transformation: "−(x + 2) → −x + 2",
      evidence: "−x + 2",
    });

    const insertSeedDiagnosis = db.prepare(
      [
        "INSERT INTO diagnoses",
        "(id, answer_version_id, version, source, outcome, taxonomy_version, misconception_id, confidence, severity, transcription, transcription_confidence, reasoning_confidence, image_quality, created_at)",
        "VALUES (?, ?, 1, 'SEED', 'MISCONCEPTION', ?, ?, 0.9, 2, ?, 1, 1, 'NOT_APPLICABLE', ?)",
      ].join(" "),
    );
    insertSeedDiagnosis.run(
      "diagnosis_a_other",
      "answer_version_a2_v2",
      TAXONOMY_VERSION,
      "NEGATIVE_SIGN_ROLE_CONFUSION",
      "The minus sign was read as a fixed negative label.",
      time.diagnosis,
    );
    insertSeedDiagnosis.run(
      "diagnosis_b1",
      "answer_version_b1_v1",
      TAXONOMY_VERSION,
      "FRACTION_COMPONENTWISE_ADD_SUBTRACT",
      "1/2 + 1/3 = 2/5",
      time.diagnosis,
    );
    insertSeedDiagnosis.run(
      "diagnosis_a1_clone",
      "answer_version_a1_clone_v1",
      TAXONOMY_VERSION,
      "SIGN_ERROR_DISTRIBUTION",
      "−(x + 4) = −x + 4 on a semantically cloned problem",
      time.diagnosis,
    );

    const insertHypothesis = db.prepare(
      [
        "INSERT INTO student_model_hypotheses",
        "(id, class_id, membership_id, domain, scope_key, taxonomy_version, misconception_id)",
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    insertHypothesis.run(
      "hypothesis_a",
      "class_a",
      "membership_a",
      "ALGEBRA",
      "negative_distribution",
      TAXONOMY_VERSION,
      "SIGN_ERROR_DISTRIBUTION",
    );
    insertHypothesis.run(
      "hypothesis_bad",
      "class_a",
      "membership_a",
      "ALGEBRA",
      "minus_roles",
      TAXONOMY_VERSION,
      "NEGATIVE_SIGN_ROLE_CONFUSION",
    );

    const formalRule = JSON.stringify({
      inputPattern: "-(a+b)",
      transformation: "negate_first_term_only",
      outputPattern: "-a+b",
      constraints: ["two additive terms"],
      strategyVariant: "NEGATES_FIRST_TERM_ONLY",
    });
    const insertModelVersion = db.prepare(
      [
        "INSERT INTO student_model_versions",
        "(id, hypothesis_id, version, status, rule_statement, formal_pattern_json, scope_limits_json, confidence, support_count, contradiction_count, created_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    expectConstraint(
      () =>
        insertModelVersion.run(
          "model_bad_json",
          "hypothesis_bad",
          1,
          "PROVISIONAL",
          "Invalid JSON",
          "{not-json",
          "[]",
          0.5,
          0,
          0,
          time.modelOne,
        ),
      /malformed JSON|CHECK constraint failed/,
    );
    expectConstraint(
      () =>
        insertModelVersion.run(
          "model_fake_supported",
          "hypothesis_bad",
          1,
          "SUPPORTED",
          "Caller-supplied support",
          formalRule,
          "[]",
          0.8,
          2,
          0,
          time.modelOne,
        ),
      /must start provisional with zero evidence counts/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            [
              "INSERT INTO student_model_versions",
              "(id, hypothesis_id, version, status, rule_statement, formal_pattern_json, scope_limits_json, confidence, support_count, contradiction_count, ai_run_id, model_name, prompt_version, schema_version, created_at)",
              "VALUES ('model_wrong_run', 'hypothesis_bad', 1, 'PROVISIONAL', 'Wrong run', ?, '[]', 0.5, 0, 0, 'run_diag_a', 'gpt-5.6', 'diagnosis-v1', 'diagnosis-schema-v1', ?)",
            ].join(" "),
          )
          .run(formalRule, time.modelOne),
      /same-class model run/,
    );

    insertModelVersion.run(
      "model_a_v1",
      "hypothesis_a",
      1,
      "PROVISIONAL",
      "Applies a leading negative to the first term only.",
      formalRule,
      "[]",
      0.75,
      0,
      0,
      time.modelOne,
    );
    const insertEvidence = db.prepare(
      "INSERT INTO student_model_evidence (student_model_version_id, diagnosis_id, role, rationale, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertEvidence.run(
      "model_a_v1",
      "diagnosis_a1",
      "SUPPORTS",
      "The observed transformation matches the candidate strategy.",
      "2025-01-03T10:00:00.001Z",
    );
    assert.equal(
      db
        .prepare(
          "SELECT support_count FROM student_model_versions WHERE id = 'model_a_v1'",
        )
        .get().support_count,
      0,
      "provisional model rows cannot claim support before finalization",
    );
    expectConstraint(
      () =>
        insertModelVersion.run(
          "model_a_v2_too_soon",
          "hypothesis_a",
          2,
          "PROVISIONAL",
          "Second active model",
          formalRule,
          "[]",
          0.9,
          0,
          0,
          time.supersede,
        ),
      /UNIQUE constraint failed/,
    );
    db.prepare(
      "UPDATE student_model_versions SET superseded_at = ? WHERE id = ?",
    ).run(time.supersede, "model_a_v1");

    insertModelVersion.run(
      "model_a_v2",
      "hypothesis_a",
      2,
      "PROVISIONAL",
      "Applies a leading negative to the first additive term only.",
      formalRule,
      JSON.stringify(["Observed on two-term additive groups only"]),
      0.88,
      0,
      0,
      time.modelTwo,
    );
    insertEvidence.run(
      "model_a_v2",
      "diagnosis_a1",
      "SUPPORTS",
      "First problem supports the exact transformation.",
      "2025-01-04T10:00:00.002Z",
    );
    expectConstraint(
      () =>
        insertEvidence.run(
          "model_a_v2",
          "diagnosis_a_other",
          "SUPPORTS",
          "A different taxonomy term cannot support this model.",
          "2025-01-04T10:00:00.003Z",
        ),
      /supporting evidence must diagnose the model taxonomy term/,
    );

    const insertFinalization = db.prepare(
      [
        "INSERT INTO student_model_finalizations",
        "(student_model_version_id, final_status, support_count, contradiction_count, ambiguous_count, finalizer_type, note, finalized_at)",
        "VALUES (?, ?, ?, ?, ?, 'SYSTEM', ?, ?)",
      ].join(" "),
    );
    expectConstraint(
      () =>
        insertFinalization.run(
          "model_a_v2",
          "SUPPORTED",
          1,
          0,
          0,
          "One response is not enough.",
          time.finalized,
        ),
      /two distinct problems|two distinct problem content hashes/,
    );
    insertEvidence.run(
      "model_a_v2",
      "diagnosis_a2",
      "SUPPORTS",
      "A structurally different problem repeats the transformation.",
      "2025-01-04T10:00:00.004Z",
    );
    insertFinalization.run(
      "model_a_v2",
      "SUPPORTED",
      2,
      0,
      0,
      "Two different problems support this candidate strategy.",
      time.finalized,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT status, support_count, contradiction_count FROM student_model_versions WHERE id = 'model_a_v2'",
        )
        .get(),
      { status: "SUPPORTED", support_count: 2, contradiction_count: 0 },
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE student_model_versions SET rule_statement = 'changed' WHERE id = ?",
          )
          .run("model_a_v2"),
      /only finalization or one supersede transition/,
    );
    expectConstraint(
      () =>
        insertEvidence.run(
          "model_a_v2",
          "diagnosis_a_other",
          "AMBIGUOUS",
          "Finalized evidence sets are closed.",
          "2025-01-04T10:00:00.005Z",
        ),
      /active provisional model/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE student_model_finalizations SET note = 'changed' WHERE student_model_version_id = ?",
          )
          .run("model_a_v2"),
      /finalizations are append-only/,
    );

    insertHypothesis.run(
      "hypothesis_content_clone",
      "class_a",
      "membership_a",
      "ALGEBRA",
      "negative_distribution_clone_check",
      TAXONOMY_VERSION,
      "SIGN_ERROR_DISTRIBUTION",
    );
    insertModelVersion.run(
      "model_content_clone",
      "hypothesis_content_clone",
      1,
      "PROVISIONAL",
      "A candidate supported only by semantically cloned problems.",
      formalRule,
      "[]",
      0.7,
      0,
      0,
      "2025-01-04T11:00:00.000Z",
    );
    insertEvidence.run(
      "model_content_clone",
      "diagnosis_a1",
      "SUPPORTS",
      "Original rendering.",
      "2025-01-04T11:00:00.001Z",
    );
    insertEvidence.run(
      "model_content_clone",
      "diagnosis_a1_clone",
      "SUPPORTS",
      "Semantically identical rendering.",
      "2025-01-04T11:00:00.002Z",
    );
    expectConstraint(
      () =>
        insertFinalization.run(
          "model_content_clone",
          "SUPPORTED",
          2,
          0,
          0,
          "Content clones must not count as varied evidence.",
          time.finalized,
        ),
      /two distinct problem content hashes/,
    );

    const liveStart = new Date(Date.now() - 5_000).toISOString();
    const liveDiagnosisTime = new Date(Date.now() - 4_000).toISOString();
    for (const row of [
      {
        id: "problem_live_1",
        prompt: "Expand −(m + 2).",
        correctAnswer: "−m − 2",
        canonicalCorrectAnswer: "-m-2",
        contentHash: "6".repeat(64),
      },
      {
        id: "problem_live_2",
        prompt: "Expand −(3n + 5).",
        correctAnswer: "−3n − 5",
        canonicalCorrectAnswer: "-3n-5",
        contentHash: "7".repeat(64),
      },
      {
        id: "problem_live_target",
        prompt: "Expand −(4p + 1).",
        correctAnswer: "−4p − 1",
        canonicalCorrectAnswer: "-4p-1",
        contentHash: "8".repeat(64),
      },
    ]) {
      insertProblem.run({
        ...row,
        classId: "class_live",
        domain: "ALGEBRA",
        answerFormat: "EXPRESSION",
        createdAt: liveStart,
      });
    }
    insertAssignment.run(
      "assignment_live",
      "class_live",
      "Live held-out check",
      "ALGEBRA",
    );
    insertItem.run(
      "item_live_1",
      "class_live",
      "assignment_live",
      "problem_live_1",
      1,
      liveStart,
    );
    insertItem.run(
      "item_live_2",
      "class_live",
      "assignment_live",
      "problem_live_2",
      2,
      liveStart,
    );
    insertItem.run(
      "item_live_target",
      "class_live",
      "assignment_live",
      "problem_live_target",
      3,
      liveStart,
    );
    insertSubmission.run(
      "submission_live",
      "class_live",
      "assignment_live",
      "item_live_1",
      "membership_live",
      1,
      liveStart,
    );
    insertAnswer.run(
      "answer_live_1",
      "submission_live",
      "assignment_live",
      "class_live",
      "item_live_1",
      1,
    );
    insertAnswer.run(
      "answer_live_2",
      "submission_live",
      "assignment_live",
      "class_live",
      "item_live_2",
      2,
    );
    insertAnswerVersion.run(
      "answer_version_live_1",
      "answer_live_1",
      1,
      "−m + 2",
      "-m+2",
      liveStart,
    );
    insertAnswerVersion.run(
      "answer_version_live_2",
      "answer_live_2",
      1,
      "−3n + 5",
      "-3n+5",
      liveStart,
    );
    insertSeedDiagnosis.run(
      "diagnosis_live_1",
      "answer_version_live_1",
      TAXONOMY_VERSION,
      "SIGN_ERROR_DISTRIBUTION",
      "−(m + 2) = −m + 2",
      liveDiagnosisTime,
    );
    insertSeedDiagnosis.run(
      "diagnosis_live_2",
      "answer_version_live_2",
      TAXONOMY_VERSION,
      "SIGN_ERROR_DISTRIBUTION",
      "−(3n + 5) = −3n + 5",
      liveDiagnosisTime,
    );
    insertHypothesis.run(
      "hypothesis_live",
      "class_live",
      "membership_live",
      "ALGEBRA",
      "live_negative_distribution",
      TAXONOMY_VERSION,
      "SIGN_ERROR_DISTRIBUTION",
    );
    expectConstraint(
      () =>
        insertModelVersion.run(
          "model_live_backdated",
          "hypothesis_live",
          1,
          "PROVISIONAL",
          "Backdated live model",
          formalRule,
          "[]",
          0.8,
          0,
          0,
          time.modelOne,
        ),
      /live student models must use a current server timestamp/,
    );
    const liveModelTime = new Date().toISOString();
    insertModelVersion.run(
      "model_live",
      "hypothesis_live",
      1,
      "PROVISIONAL",
      "Applies a leading negative to the first additive term only.",
      formalRule,
      "[]",
      0.86,
      0,
      0,
      liveModelTime,
    );
    const liveEvidenceTime = new Date().toISOString();
    insertEvidence.run(
      "model_live",
      "diagnosis_live_1",
      "SUPPORTS",
      "First live problem supports the transformation.",
      liveEvidenceTime,
    );
    insertEvidence.run(
      "model_live",
      "diagnosis_live_2",
      "SUPPORTS",
      "Second live problem supports the transformation.",
      liveEvidenceTime,
    );
    expectConstraint(
      () =>
        insertFinalization.run(
          "model_live",
          "SUPPORTED",
          2,
          0,
          0,
          "Live finalization cannot be backdated.",
          time.finalized,
        ),
      /cannot predate its evidence|current server timestamp|active provisional model/,
    );
    const liveFinalizedAt = new Date().toISOString();
    insertFinalization.run(
      "model_live",
      "SUPPORTED",
      2,
      0,
      0,
      "Two current, distinct live problems support this model.",
      liveFinalizedAt,
    );

    const insertPrediction = db.prepare(
      [
        "INSERT INTO predictions",
        "(id, class_id, membership_id, student_model_version_id, problem_id, target_assignment_item_id, rule_applied, predicted_answer, canonical_predicted_answer, correct_answer_snapshot, canonical_correct_answer, trace_json, confidence, locked_at, created_at)",
        "VALUES (@id, @classId, @membershipId, @modelId, @problemId, @targetItemId, 1, @predictedAnswer, @canonicalPredictedAnswer, @correctAnswer, @canonicalCorrectAnswer, @trace, @confidence, @lockedAt, @createdAt)",
      ].join(" "),
    );
    const predictionA3 = {
      id: "prediction_a3",
      classId: "class_a",
      membershipId: "membership_a",
      modelId: "model_a_v2",
      problemId: "problem_a3",
      targetItemId: "item_a3",
      predictedAnswer: "−2x + 7",
      canonicalPredictedAnswer: "-2x+7",
      correctAnswer: "−2x − 7",
      canonicalCorrectAnswer: "-2x-7",
      trace: JSON.stringify({ strategyVariant: "NEGATES_FIRST_TERM_ONLY" }),
      confidence: 0.88,
      lockedAt: time.lock,
      createdAt: time.lock,
    };
    const livePrediction = {
      id: "prediction_live",
      classId: "class_live",
      membershipId: "membership_live",
      modelId: "model_live",
      problemId: "problem_live_target",
      targetItemId: "item_live_target",
      predictedAnswer: "−4p + 1",
      canonicalPredictedAnswer: "-4p+1",
      correctAnswer: "−4p − 1",
      canonicalCorrectAnswer: "-4p-1",
      trace: JSON.stringify({ strategyVariant: "NEGATES_FIRST_TERM_ONLY" }),
      confidence: 0.86,
      lockedAt: time.lock,
      createdAt: time.lock,
    };
    expectConstraint(
      () => insertPrediction.run(livePrediction),
      /live prediction locks must use a current server timestamp|supported model and exact future problem target/,
    );
    const liveLock = new Date().toISOString();
    insertPrediction.run({
      ...livePrediction,
      lockedAt: liveLock,
      createdAt: liveLock,
    });
    expectConstraint(
      () =>
        insertPrediction.run({
          ...predictionA3,
          id: "prediction_future_dated_existing_work",
          problemId: "problem_future_recorded",
          targetItemId: "item_future_recorded",
          predictedAnswer: "−5q + 6",
          canonicalPredictedAnswer: "-5q+6",
          correctAnswer: "−5q − 6",
          canonicalCorrectAnswer: "-5q-6",
        }),
      /already has recorded work/,
    );
    expectConstraint(
      () =>
        insertPrediction.run({
          ...predictionA3,
          id: "prediction_forged_truth",
          correctAnswer: "−2x + 7",
        }),
      /supported model and exact future problem target/,
    );
    expectConstraint(
      () =>
        insertPrediction.run({
          ...predictionA3,
          id: "prediction_seen_problem",
          problemId: "problem_a1",
          targetItemId: "item_a1",
          predictedAnswer: "−x + 4",
          canonicalPredictedAnswer: "-x+4",
          correctAnswer: "−x − 4",
          canonicalCorrectAnswer: "-x-4",
        }),
      /must be unseen|already has recorded work/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            [
              "INSERT INTO predictions",
              "(id, class_id, membership_id, student_model_version_id, problem_id, target_assignment_item_id, rule_applied, predicted_answer, canonical_predicted_answer, correct_answer_snapshot, canonical_correct_answer, trace_json, confidence, ai_run_id, model_name, prompt_version, schema_version, locked_at, created_at)",
              "VALUES ('prediction_wrong_run', 'class_a', 'membership_a', 'model_a_v2', 'problem_a3', 'item_a3', 1, '−2x + 7', '-2x+7', '−2x − 7', '-2x-7', '{}', 0.8, 'run_diag_a', 'gpt-5.6', 'diagnosis-v1', 'diagnosis-schema-v1', ?, ?)",
            ].join(" "),
          )
          .run(time.lock, time.lock),
      /same-class prediction run/,
    );
    insertPrediction.run(predictionA3);
    insertPrediction.run({
      ...predictionA3,
      id: "prediction_a4",
      problemId: "problem_a4",
      targetItemId: "item_a4",
      predictedAnswer: "4 − y + 3",
      canonicalPredictedAnswer: "7-y",
      correctAnswer: "1 − y",
      canonicalCorrectAnswer: "1-y",
      confidence: 0.82,
    });
    expectConstraint(
      () =>
        insertPrediction.run({
          ...predictionA3,
          id: "prediction_content_clone",
          problemId: "problem_a3_clone",
          targetItemId: "item_a3_clone",
        }),
      /one prediction per problem content/,
    );
    expectConstraint(
      () =>
        insertPrediction.run({ ...predictionA3, id: "prediction_duplicate" }),
      /UNIQUE constraint failed|one prediction per problem content/,
    );
    expectConstraint(
      () =>
        insertPrediction.run({
          ...predictionA3,
          id: "prediction_wrong_student",
          classId: "class_b",
          membershipId: "membership_b",
          problemId: "problem_b1",
          targetItemId: "item_b1",
          predictedAnswer: "2/5",
          canonicalPredictedAnswer: "2/5",
          correctAnswer: "5/6",
          canonicalCorrectAnswer: "5/6",
        }),
      /same student|supported model|already has recorded work/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE predictions SET predicted_answer = 'changed' WHERE id = ?",
          )
          .run("prediction_a3"),
      /predictions are immutable/,
    );

    insertAnswer.run(
      "answer_a4_old_late_import",
      "submission_a",
      "assignment_a",
      "class_a",
      "item_a4",
      4,
    );
    insertAnswerVersion.run(
      "answer_version_a4_old_late_import",
      "answer_a4_old_late_import",
      1,
      "4 − y + 3",
      "7-y",
      time.postAnswer,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT reason, submission_answer_id FROM prediction_invalidations WHERE prediction_id = ?",
        )
        .get("prediction_a4"),
      {
        reason: "PRIOR_WORK_DISCOVERED",
        submission_answer_id: "answer_a4_old_late_import",
      },
    );

    insertSubmission.run(
      "submission_a_later",
      "class_a",
      "assignment_a",
      "item_a3",
      "membership_a",
      2,
      time.postSubmission,
    );
    insertAnswer.run(
      "answer_a3_later",
      "submission_a_later",
      "assignment_a",
      "class_a",
      "item_a3",
      1,
    );
    insertAnswer.run(
      "answer_a4_later",
      "submission_a_later",
      "assignment_a",
      "class_a",
      "item_a4",
      2,
    );
    insertAnswerVersion.run(
      "answer_version_a3_later_v1",
      "answer_a3_later",
      1,
      "−2x + 7",
      "-2x+7",
      time.postAnswer,
    );
    insertAnswerVersion.run(
      "answer_version_a4_later_v1",
      "answer_a4_later",
      1,
      "4 − y + 3",
      "7-y",
      time.postAnswer,
    );

    const insertOutcome = db.prepare(
      [
        "INSERT INTO prediction_outcome_versions",
        "(id, prediction_id, version, answer_version_id, actual_answer_snapshot, canonical_actual_answer, match_state, evaluation_method, confidence, observed_at, evaluated_at, created_at)",
        "VALUES (@id, @predictionId, @version, @answerVersionId, @actualAnswer, @canonicalActual, @matchState, @method, @confidence, @observedAt, @evaluatedAt, @createdAt)",
      ].join(" "),
    );
    const outcomeA3 = {
      id: "outcome_a3_v1",
      predictionId: "prediction_a3",
      version: 1,
      answerVersionId: "answer_version_a3_later_v1",
      actualAnswer: "−2x + 7",
      canonicalActual: "-2x+7",
      matchState: "MATCH",
      method: "DETERMINISTIC",
      confidence: 1,
      observedAt: time.postSubmission,
      evaluatedAt: time.evaluated,
      createdAt: time.outcomeCreated,
    };
    expectConstraint(
      () =>
        insertOutcome.run({
          ...outcomeA3,
          id: "outcome_forged_snapshot",
          actualAnswer: "not the stored answer",
        }),
      /exactly snapshot valid post-lock work/,
    );
    expectConstraint(
      () =>
        insertOutcome.run({
          ...outcomeA3,
          id: "outcome_forged_match",
          matchState: "MISMATCH",
        }),
      /canonical answer comparison/,
    );
    expectConstraint(
      () =>
        insertOutcome.run({
          ...outcomeA3,
          id: "outcome_invalidated_prediction",
          predictionId: "prediction_a4",
          answerVersionId: "answer_version_a4_later_v1",
          actualAnswer: "4 − y + 3",
          canonicalActual: "7-y",
        }),
      /exactly snapshot valid post-lock work/,
    );
    insertOutcome.run(outcomeA3);
    expectConstraint(
      () =>
        insertOutcome.run({
          ...outcomeA3,
          id: "outcome_ai_review",
          version: 2,
          method: "AI_REVIEW",
          confidence: 0.9,
        }),
      /auditable run provenance/,
    );
    insertOutcome.run({
      ...outcomeA3,
      id: "outcome_a3_v2_teacher_review",
      version: 2,
      method: "TEACHER",
      confidence: 1,
      createdAt: "2025-03-01T09:04:00.000Z",
    });
    expectConstraint(
      () =>
        db
          .prepare("DELETE FROM prediction_outcome_versions WHERE id = ?")
          .run("outcome_a3_v1"),
      /prediction outcomes are append-only/,
    );
    expectConstraint(
      () =>
        db
          .prepare("DELETE FROM predictions WHERE id = ?")
          .run("prediction_a3"),
      /predictions are append-only/,
    );
    expectConstraint(
      () =>
        insertOutcome.run({
          ...outcomeA3,
          id: "outcome_answer_reused",
          predictionId: "prediction_a4",
          answerVersionId: "answer_version_a3_later_v1",
        }),
      /cannot score different predictions|exactly snapshot valid post-lock work/,
    );

    assert.deepEqual(
      db
        .prepare(
          [
            "SELECT total_predictions, valid_predictions, invalidated_predictions,",
            "observed_predictions, scorable_predictions, matched_predictions, prediction_accuracy",
            "FROM student_prediction_metrics WHERE membership_id = ?",
          ].join(" "),
        )
        .get("membership_a"),
      {
        total_predictions: 2,
        valid_predictions: 1,
        invalidated_predictions: 1,
        observed_predictions: 1,
        scorable_predictions: 1,
        matched_predictions: 1,
        prediction_accuracy: 1,
      },
    );

    const insertWorksheet = db.prepare(
      [
        "INSERT INTO worksheets",
        "(id, class_id, membership_id, student_model_version_id, assignment_id, title, rationale, status)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'READY')",
      ].join(" "),
    );
    expectConstraint(
      () =>
        insertWorksheet.run(
          "worksheet_cross_student",
          "class_b",
          "membership_b",
          "model_a_v2",
          "assignment_b",
          "Wrong scope",
          "Must fail",
        ),
      /same class and student/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            [
              "INSERT INTO worksheets",
              "(id, class_id, membership_id, student_model_version_id, assignment_id, title, rationale, status, ai_run_id, model_name, prompt_version, schema_version)",
              "VALUES ('worksheet_wrong_run', 'class_a', 'membership_a', 'model_a_v2', 'assignment_a', 'Wrong run', 'Must fail', 'READY', 'run_diag_a', 'gpt-5.6', 'diagnosis-v1', 'diagnosis-schema-v1')",
            ].join(" "),
          )
          .run(),
      /same-class practice run/,
    );
    insertWorksheet.run(
      "worksheet_a",
      "class_a",
      "membership_a",
      "model_a_v2",
      "assignment_a",
      "Practice distributing a negative",
      "Create discrepant events for the candidate rule.",
    );
    const insertWorksheetItem = db.prepare(
      [
        "INSERT INTO worksheet_items",
        "(id, worksheet_id, class_id, problem_id, position, difficulty, taxonomy_version, misconception_id, misconception_predicted_answer, hint, explanation, discrepant_event_rationale)",
        "VALUES (?, 'worksheet_a', 'class_a', 'problem_a3', ?, 2, ?, ?, '−2x + 7', 'Distribute to both terms.', 'The negative changes both signs.', 'The two rules produce visibly different constants.')",
      ].join(" "),
    );
    insertWorksheetItem.run(
      "worksheet_item_a",
      1,
      TAXONOMY_VERSION,
      "SIGN_ERROR_DISTRIBUTION",
    );
    expectConstraint(
      () =>
        insertWorksheetItem.run(
          "worksheet_item_wrong_term",
          2,
          TAXONOMY_VERSION,
          "NEGATIVE_SIGN_ROLE_CONFUSION",
        ),
      /worksheet model taxonomy term/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE worksheet_items SET misconception_id = ? WHERE id = ?",
          )
          .run("NEGATIVE_SIGN_ROLE_CONFUSION", "worksheet_item_a"),
      /worksheet items are immutable/,
    );
    db.prepare(
      [
        "INSERT INTO worksheets",
        "(id, class_id, membership_id, student_model_version_id, assignment_id, title, rationale, status, supersedes_worksheet_id)",
        "VALUES ('worksheet_a_successor', 'class_a', 'membership_a', 'model_a_v2', 'assignment_a', 'Revised practice', 'Same model lineage.', 'READY', 'worksheet_a')",
      ].join(" "),
    ).run();

    const insertBrief = db.prepare(
      [
        "INSERT INTO teaching_briefs",
        "(id, class_id, assignment_id, taxonomy_version, misconception_id, paragraph, cluster_student_count, diagnosed_student_count, evidence_cutoff_at, worked_example_problem_id)",
        "VALUES (?, 'class_a', 'assignment_a', ?, 'SIGN_ERROR_DISTRIBUTION', ?, 2, 2, ?, 'problem_a3')",
      ].join(" "),
    );
    expectConstraint(
      () =>
        db
          .prepare(
            [
              "INSERT INTO teaching_briefs",
              "(id, class_id, assignment_id, taxonomy_version, misconception_id, paragraph, cluster_student_count, diagnosed_student_count, evidence_cutoff_at, ai_run_id, model_name, prompt_version, schema_version)",
              "VALUES ('brief_wrong_run', 'class_a', 'assignment_a', ?, 'SIGN_ERROR_DISTRIBUTION', 'Wrong run.', 1, 1, ?, 'run_diag_a', 'gpt-5.6', 'diagnosis-v1', 'diagnosis-schema-v1')",
            ].join(" "),
          )
          .run(TAXONOMY_VERSION, time.finalized),
      /same-class brief run/,
    );
    insertBrief.run(
      "brief_a",
      TAXONOMY_VERSION,
      "Students are applying the outside negative to only the first term; contrast both expansions in a ten-minute worked example.",
      time.finalized,
    );
    db.prepare(
      "INSERT INTO teaching_brief_evidence (teaching_brief_id, diagnosis_id) VALUES (?, ?)",
    ).run("brief_a", "diagnosis_a1");
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE teaching_brief_evidence SET diagnosis_id = ? WHERE teaching_brief_id = ? AND diagnosis_id = ?",
          )
          .run("diagnosis_b1", "brief_a", "diagnosis_a1"),
      /teaching brief evidence is immutable/,
    );
    expectConstraint(
      () =>
        db
          .prepare(
            "INSERT INTO teaching_brief_evidence (teaching_brief_id, diagnosis_id) VALUES (?, ?)",
          )
          .run("brief_a", "diagnosis_b1"),
      /assignment and misconception cluster/,
    );
    db.prepare(
      [
        "INSERT INTO teaching_briefs",
        "(id, class_id, assignment_id, taxonomy_version, misconception_id, paragraph, cluster_student_count, diagnosed_student_count, evidence_cutoff_at, supersedes_brief_id)",
        "VALUES ('brief_a_successor', 'class_a', 'assignment_a', ?, 'SIGN_ERROR_DISTRIBUTION', 'Revised tomorrow brief.', 2, 2, ?, 'brief_a')",
      ].join(" "),
    ).run(TAXONOMY_VERSION, time.finalized);

    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE taxonomy_terms SET label = 'tampered' WHERE taxonomy_version = ? AND misconception_id = ?",
          )
          .run(TAXONOMY_VERSION, "SIGN_ERROR_DISTRIBUTION"),
      /taxonomy terms are immutable/,
    );

    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS count FROM current_student_model_versions WHERE id = ?",
        )
        .get("model_a_v2").count,
      1,
    );
    db.prepare(
      "UPDATE student_model_hypotheses SET retired_at = ? WHERE id = ?",
    ).run("2099-04-01T00:00:00.000Z", "hypothesis_a");
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS count FROM current_student_model_versions WHERE id = ?",
        )
        .get("model_a_v2").count,
      0,
    );

    db.prepare("DELETE FROM classes WHERE id = ?").run("class_b");
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS count FROM class_memberships WHERE class_id = ?",
        )
        .get("class_b").count,
      0,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM students WHERE id = ?").get(
        "student_b",
      ).count,
      1,
      "class deletion must not delete a potentially shared student record",
    );

    db.prepare("DELETE FROM classes WHERE id = ?").run("class_live");
    assert.equal(
      db
        .prepare("SELECT count(*) AS count FROM predictions WHERE id = ?")
        .get("prediction_live").count,
      0,
      "live prediction history must delete through the class privacy cascade",
    );

    db.prepare("DELETE FROM classes WHERE id = ?").run("class_a");
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM predictions").get().count,
      0,
      "privacy cascade must clear the prediction evidence graph",
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }

  const secondMigration = migrate();
  assert.equal(
    secondMigration.status,
    0,
    secondMigration.stderr || secondMigration.stdout,
  );
  assert.match(secondMigration.stdout, /Database and taxonomy are current/);

  const checksumDb = new Database(databasePath);
  checksumDb
    .prepare("UPDATE schema_migrations SET checksum = ? WHERE name = ?")
    .run("0".repeat(64), "000_app_meta.sql");
  checksumDb.close();

  const changedMigration = migrate();
  assert.notEqual(changedMigration.status, 0);
  assert.match(
    changedMigration.stderr + changedMigration.stdout,
    /Applied migration 000_app_meta\.sql has changed on disk/,
  );
}

try {
  verifyTaxonomy();
  verifyDatabase();
  console.log(
    JSON.stringify(
      {
        status: "ok",
        taxonomyVersion: TAXONOMY_VERSION,
        misconceptionCount: MISCONCEPTIONS.length,
        checks: [
          "taxonomy invariants and citation caveats",
          "fresh and idempotent migrations",
          "immutable identity and AI provenance",
          "exact immutable diagnosis-run submission targets",
          "low-confidence diagnosis abstention",
          "append-only evidence-backed Student Model finalization",
          "live timestamp integrity with deterministic demo exemptions",
          "distinct-content evidence and prediction trials",
          "held-out targets, preexisting-work guards, and late-import invalidations",
          "truthful prediction outcomes and denominator-aware metrics",
          "append-only prediction and outcome history",
          "immutable worksheet and teaching-brief scope",
          "full-graph privacy cascade with supersession chains",
          "migration checksum protection",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
