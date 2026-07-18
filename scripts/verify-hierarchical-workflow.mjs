import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

import {
  DEMO_FOLLOWUP_ASSIGNMENT_ID,
  seedDemoDatabase,
} from "../src/server/demo/seed-database.mjs";
import {
  STUDENT_PAGE_DIAGNOSIS_SCHEMA_VERSION,
  studentPageDiagnosisAIOutputSchema,
} from "../src/domain/student-page-diagnosis-ai-output.mjs";
import {
  exerciseQuestionReference,
  shortExerciseLabel,
} from "../src/domain/exam-labels.ts";
import {
  WORKSHEET_EXTRACTION_SCHEMA_VERSION,
  worksheetExtractionAIOutputSchema,
} from "../src/domain/worksheet-extraction.ts";

const root = process.cwd();
const migrationsDirectory = path.join(root, "db", "migrations");
const migrationFiles = fs
  .readdirSync(migrationsDirectory)
  .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right));
const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "misconception-map-hierarchy-"),
);

function verifyStructuredOutputs() {
  assert.equal(WORKSHEET_EXTRACTION_SCHEMA_VERSION, "2.2.0");
  assert.equal(STUDENT_PAGE_DIAGNOSIS_SCHEMA_VERSION, "2.0.0");
  assert.equal(shortExerciseLabel("Exercice n° 2 — Transport"), "Ex. 2");
  assert.equal(shortExerciseLabel("Exercice no 2 — Transport"), "Ex. 2");
  assert.equal(
    exerciseQuestionReference("Exercice n° 2 — Transport", "1."),
    "Ex. 2 · Q1",
  );

  const hierarchicalExtraction = {
    sourceSummary: "Two exercises with preserved printed numbering.",
    overallConfidence: 0.94,
    exercises: [
      {
        exerciseLabel: "Exercice 1 — Fractions",
        sharedContext: "Lina shares three quarters of a cake equally.",
        questions: [
          {
            questionLabel: "1.1",
            problemStatement:
              "Lina shares three quarters of a cake equally between 2 people. What fraction of the whole cake does each person receive?",
            expectedAnswer: "3/8",
            answerKind: "FRACTION",
            domain: "FRACTIONS",
            inTaxonomyScope: true,
            extractionConfidence: 0.98,
            answerConfidence: 0.96,
            reviewNote: null,
          },
        ],
      },
      {
        exerciseLabel: "7",
        sharedContext: null,
        questions: [
          {
            questionLabel: "7.3",
            problemStatement: "Résoudre 2x + 5 = 17.",
            expectedAnswer: "x = 6",
            answerKind: "EXPRESSION",
            domain: "ALGEBRA",
            inTaxonomyScope: true,
            extractionConfidence: 0.97,
            answerConfidence: 0.99,
            reviewNote: null,
          },
        ],
      },
      {
        exerciseLabel: "Exercice 8 — Géométrie",
        sharedContext: "ABC est un triangle rectangle en A.",
        questions: [
          {
            questionLabel: "8.1",
            problemStatement:
              "ABC est un triangle rectangle en A, avec AB = 3 cm et AC = 4 cm. Calculer BC.",
            expectedAnswer: "5 cm",
            answerKind: "NUMBER",
            domain: null,
            inTaxonomyScope: false,
            extractionConfidence: 0.99,
            answerConfidence: 0.99,
            reviewNote: null,
          },
        ],
      },
    ],
  };
  assert.deepEqual(
    worksheetExtractionAIOutputSchema.parse(hierarchicalExtraction),
    hierarchicalExtraction,
  );
  assert.equal(
    worksheetExtractionAIOutputSchema.safeParse({
      sourceSummary: "Legacy flat output",
      overallConfidence: 0.9,
      problems: [],
    }).success,
    false,
  );
  assert.equal(
    worksheetExtractionAIOutputSchema.safeParse({
      ...hierarchicalExtraction,
      exercises: [
        {
          exerciseLabel: "1",
          questions: hierarchicalExtraction.exercises[0].questions,
        },
      ],
    }).success,
    false,
    "nullable fields remain required in the strict extraction contract",
  );

  const extractionService = fs.readFileSync(
    path.join(root, "src", "server", "openai", "extract-worksheet.ts"),
    "utf8",
  );
  assert.match(extractionService, /reasoning: \{ effort: "low" \}/);
  assert.match(
    extractionService,
    /buildPdfInputFile\(input\.pdfBytes, "worksheet\.pdf", "low"\)/,
  );

  const pageResult = {
    pageTranscriptionConfidence: 0.91,
    imageQuality: "GOOD",
    segmentationReviewNote: null,
    visibleProblems: [
      {
        problemPosition: 1,
        exerciseLabel: "Exercice 1 — Fractions",
        questionLabel: "1.1",
        region: null,
        diagnosis: {
          outcome: "CORRECT",
          transcription: "3/8",
          steps: [
            {
              position: 1,
              step: "3/4 ÷ 2 = 3/8",
              normalizedMath: "3/4 / 2 = 3/8",
              stepKind: "EQUATION",
              parseIssue: null,
              correctness: "CORRECT",
              correctNote: "The fraction is divided by 2.",
              errorNote: null,
              evidenceQuote: "3/4 ÷ 2 = 3/8",
            },
          ],
          observedPrompt:
            "Lina shares three quarters of a cake equally between 2 people.",
          studentAnswer: "3/8",
          normalizedAnswer: "3/8",
          misconceptionId: null,
          confidence: 0.95,
          transcriptionConfidence: 0.96,
          reasoningConfidence: 0.95,
          evidenceQuote: "3/8",
          severity: 0,
          imageQuality: "GOOD",
          observedTransformation: null,
          strategyVariant: null,
          reviewReasons: [],
          candidates: [],
        },
      },
    ],
  };
  assert.equal(studentPageDiagnosisAIOutputSchema.safeParse(pageResult).success, true);
  const unlabeledPageResult = structuredClone(pageResult);
  delete unlabeledPageResult.visibleProblems[0].questionLabel;
  assert.equal(
    studentPageDiagnosisAIOutputSchema.safeParse(unlabeledPageResult).success,
    false,
    "page segmentation must identify both the exercise and the question",
  );
}

function migrate(databasePath) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "migrate.mjs")], {
    cwd: root,
    env: { ...process.env, MISCONCEPTION_MAP_DB_PATH: databasePath },
    encoding: "utf8",
  });
}

function verifyLegacyMigration() {
  const legacyDatabasePath = path.join(tempDirectory, "legacy.db");
  const db = new Database(legacyDatabasePath);
  db.pragma("foreign_keys = ON");
  try {
    for (const migrationFile of migrationFiles.filter((file) => file < "015_")) {
      db.exec(fs.readFileSync(path.join(migrationsDirectory, migrationFile), "utf8"));
    }
    db.prepare(
      "INSERT INTO classes (id, name, grade_band, is_demo) VALUES ('legacy-class', 'Legacy class', 'GRADE_7', 1)",
    ).run();
    db.prepare(
      "INSERT INTO assignments (id, class_id, title, domain, status) VALUES ('legacy-assignment', 'legacy-class', 'Legacy flat exam', 'MIXED', 'READY')",
    ).run();
    db.prepare(
      "INSERT INTO problems (id, class_id, domain, prompt, answer_format, correct_answer, origin, content_hash) VALUES ('legacy-problem', 'legacy-class', 'ALGEBRA', 'Résoudre x + 2 = 5.', 'EXPRESSION', 'x = 3', 'ASSIGNMENT', ?)",
    ).run("a".repeat(64));
    db.prepare(
      "INSERT INTO assignment_items (id, class_id, assignment_id, problem_id, position) VALUES ('legacy-item', 'legacy-class', 'legacy-assignment', 'legacy-problem', 7)",
    ).run();
    db.prepare(
      "INSERT INTO assignment_sources (id, class_id, assignment_id, source_kind, source_text, status) VALUES ('legacy-source', 'legacy-class', 'legacy-assignment', 'TYPED', '7. Résoudre x + 2 = 5.', 'EXTRACTED')",
    ).run();
    const legacyProblems = [
      {
        position: 7,
        prompt: "Résoudre x + 2 = 5.",
        correctAnswer: "x = 3",
        answerFormat: "EXPRESSION",
        domain: "ALGEBRA",
        extractionConfidence: 0.95,
        answerConfidence: 0.95,
        reviewNote: null,
      },
    ];
    db.prepare(
      "INSERT INTO assignment_source_extractions (id, source_id, model_name, prompt_version, schema_version, openai_response_id, input_hash, output_hash, overall_confidence, problems_json, latency_ms) VALUES ('legacy-extraction', 'legacy-source', 'gpt-5.6', '1.0.0', '1.0.0', 'response-1', ?, ?, 0.95, ?, 10)",
    ).run("b".repeat(64), "c".repeat(64), JSON.stringify(legacyProblems));

    db.exec(
      fs.readFileSync(
        path.join(migrationsDirectory, "015_hierarchical_exercises.sql"),
        "utf8",
      ),
    );

    const migratedItem = db
      .prepare(
        "SELECT exercise_id, question_label FROM assignment_items WHERE id = 'legacy-item'",
      )
      .get();
    assert.deepEqual(migratedItem, {
      exercise_id: "legacy-assignment:legacy-exercise",
      question_label: "7",
    });
    assert.deepEqual(
      db
        .prepare(
          "SELECT exercise_label, shared_context FROM exercises WHERE assignment_id = 'legacy-assignment'",
        )
        .get(),
      { exercise_label: "1", shared_context: null },
    );
    assert.deepEqual(
      JSON.parse(
        db
          .prepare(
            "SELECT exercises_json FROM assignment_source_extractions WHERE id = 'legacy-extraction'",
          )
          .get().exercises_json,
      ),
      [
        {
          exerciseLabel: "1",
          sharedContext: null,
          questions: [
            {
              questionLabel: "7",
              problemStatement: "Résoudre x + 2 = 5.",
              expectedAnswer: "x = 3",
              answerKind: "EXPRESSION",
              domain: "ALGEBRA",
              extractionConfidence: 0.95,
              answerConfidence: 0.95,
              reviewNote: null,
            },
          ],
        },
      ],
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE assignment_items SET question_label = '8' WHERE id = 'legacy-item'")
          .run(),
      /grouping is immutable/,
    );
  } finally {
    db.close();
  }
}

function verifySeededHierarchy() {
  const databasePath = path.join(tempDirectory, "seed.db");
  const migration = migrate(databasePath);
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  try {
    seedDemoDatabase(db);
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.equal(
      db
        .prepare("SELECT count(*) AS count FROM exercises WHERE assignment_id = ?")
        .get(DEMO_FOLLOWUP_ASSIGNMENT_ID).count,
      3,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT item.question_label FROM assignment_items AS item JOIN exercises AS exercise ON exercise.id = item.exercise_id WHERE item.assignment_id = ? ORDER BY exercise.position, item.position",
        )
        .all(DEMO_FOLLOWUP_ASSIGNMENT_ID)
        .map((row) => row.question_label),
      ["1.1", "1.2", "2.1", "2.2", "3.1"],
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS count FROM assignment_items WHERE assignment_id = ? AND (exercise_id IS NULL OR question_label IS NULL)",
        )
        .get(DEMO_FOLLOWUP_ASSIGNMENT_ID).count,
      0,
    );

    const exercisePerformance = db
      .prepare(
        [
          "SELECT exercise.exercise_label,",
          "sum(CASE WHEN diagnosis.outcome = 'CORRECT' THEN 1 ELSE 0 END) AS correct_count,",
          "sum(CASE WHEN diagnosis.outcome IN ('CORRECT', 'MISCONCEPTION') THEN 1 ELSE 0 END) AS assessed_count,",
          "sum(CASE WHEN diagnosis.outcome NOT IN ('CORRECT', 'MISCONCEPTION') THEN 1 ELSE 0 END) AS flagged_count",
          "FROM exercises AS exercise",
          "JOIN assignment_items AS item ON item.exercise_id = exercise.id",
          "JOIN submission_answers AS answer ON answer.assignment_item_id = item.id",
          "JOIN answer_versions AS version ON version.submission_answer_id = answer.id",
          "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = version.id",
          "WHERE exercise.assignment_id = ? GROUP BY exercise.id ORDER BY exercise.position",
        ].join(" "),
      )
      .all(DEMO_FOLLOWUP_ASSIGNMENT_ID)
      .map((row) => ({
        label: row.exercise_label,
        successRate: Math.round((row.correct_count / row.assessed_count) * 100),
        flaggedCount: row.flagged_count,
      }));
    assert.deepEqual(exercisePerformance, [
      {
        label: "Exercice 1 — Signe et parenthèses",
        successRate: 77,
        flaggedCount: 1,
      },
      {
        label: "Exercice 2 — Distribution",
        successRate: 85,
        flaggedCount: 0,
      },
      {
        label: "Exercice 3 — Équation",
        successRate: 68,
        flaggedCount: 1,
      },
    ]);

    const reviewReasons = db
      .prepare(
        "SELECT diagnosis.review_reasons_json FROM diagnoses AS diagnosis JOIN answer_versions AS version ON version.id = diagnosis.answer_version_id JOIN submission_answers AS answer ON answer.id = version.submission_answer_id WHERE answer.assignment_id = ? AND diagnosis.outcome = 'NEEDS_REVIEW'",
      )
      .all(DEMO_FOLLOWUP_ASSIGNMENT_ID)
      .map((row) => JSON.parse(row.review_reasons_json));
    assert.equal(reviewReasons.length, 2);
    assert.equal(
      reviewReasons.filter((reasons) => reasons.includes("NO_TAXONOMY_MATCH")).length,
      1,
    );

    const flaggedMembershipCount = db
      .prepare(
        [
          "SELECT count(DISTINCT submission.membership_id) AS count",
          "FROM submissions AS submission",
          "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
          "JOIN answer_versions AS version ON version.submission_answer_id = answer.id",
          "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = version.id",
          "WHERE submission.assignment_id = ? AND diagnosis.outcome NOT IN ('CORRECT', 'MISCONCEPTION')",
        ].join(" "),
      )
      .get(DEMO_FOLLOWUP_ASSIGNMENT_ID).count;
    assert.equal(flaggedMembershipCount, 2);
    assert.equal(20 - flaggedMembershipCount, 18);

    const learnerTwentyExerciseCounts = db
      .prepare(
        [
          "SELECT exercise.exercise_label,",
          "sum(CASE WHEN diagnosis.outcome = 'CORRECT' THEN 1 ELSE 0 END) AS correct_count,",
          "sum(CASE WHEN diagnosis.outcome = 'MISCONCEPTION' THEN 1 ELSE 0 END) AS incorrect_count,",
          "sum(CASE WHEN diagnosis.outcome NOT IN ('CORRECT', 'MISCONCEPTION') THEN 1 ELSE 0 END) AS flagged_count",
          "FROM submissions AS submission",
          "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
          "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
          "JOIN exercises AS exercise ON exercise.id = item.exercise_id",
          "JOIN answer_versions AS version ON version.submission_answer_id = answer.id",
          "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = version.id",
          "WHERE submission.assignment_id = ? AND submission.membership_id = ?",
          "GROUP BY exercise.id ORDER BY exercise.position",
        ].join(" "),
      )
      .all(
        DEMO_FOLLOWUP_ASSIGNMENT_ID,
        "00000000-0000-4000-8000-000000002020",
      )
      .map((row) => [
        row.exercise_label,
        row.correct_count,
        row.incorrect_count,
        row.flagged_count,
      ]);
    assert.deepEqual(learnerTwentyExerciseCounts, [
      ["Exercice 1 — Signe et parenthèses", 1, 0, 1],
      ["Exercice 2 — Distribution", 2, 0, 0],
      ["Exercice 3 — Équation", 1, 0, 0],
    ]);
  } finally {
    db.close();
  }
}

function verifyGuidedAndGroupedSurfaces() {
  const stepper = fs.readFileSync(
    path.join(root, "src", "components", "assignment-stepper.tsx"),
    "utf8",
  );
  for (const label of [
    "Exam source",
    "Student copies",
    "AI correction",
    "Results",
  ]) {
    assert.match(stepper, new RegExp(label));
  }
  const dashboard = fs.readFileSync(
    path.join(root, "src", "components", "dashboard", "misconception-heatmap.tsx"),
    "utf8",
  );
  assert.match(dashboard, /Which exercise needs attention\?/);
  assert.match(dashboard, /dominantMisconception/);
  assert.match(dashboard, /flaggedCount/);
  const correctedCopy = fs.readFileSync(
    path.join(
      root,
      "src",
      "app",
      "assignments",
      "[assignmentId]",
      "students",
      "[membershipId]",
      "corrected",
      "page.tsx",
    ),
    "utf8",
  );
  assert.match(correctedCopy, /corrected-copy-summary/);
  assert.match(correctedCopy, /corrected-copy-exercise/);
  assert.match(correctedCopy, /exercise\.sharedContext/);
  assert.match(correctedCopy, /isFrenchExam\(exam\)/);
  assert.match(correctedCopy, /FRENCH_REVIEW_REASONS/);

  const setupWorkspace = fs.readFileSync(
    path.join(root, "src", "components", "diagnosis", "setup-workspace.tsx"),
    "utf8",
  );
  assert.match(setupWorkspace, /Enter an assignment title to continue\./);
  assert.match(setupWorkspace, /titleFromFilename\(file\.name\)/);

  const diagnosisService = fs.readFileSync(
    path.join(root, "src", "server", "openai", "diagnose-submission.ts"),
    "utf8",
  );
  assert.match(
    diagnosisService,
    /timeout: 210_000/,
    "multi-page student booklets must fit inside the 240-second route budget",
  );
}

try {
  verifyStructuredOutputs();
  verifyLegacyMigration();
  verifySeededHierarchy();
  verifyGuidedAndGroupedSurfaces();
  console.log(
    "Hierarchical extraction, legacy migration, page matching, and deterministic demo verification passed.",
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
