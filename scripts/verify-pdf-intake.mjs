import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

import {
  buildPdfInputFile,
  hasPdfSignature,
  PDF_DIRECT_INPUT_VERSION,
  PDF_MEDIA_TYPE,
} from "../src/domain/pdf-input.mjs";

const root = process.cwd();
const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n",
  "ascii",
);

assert.equal(hasPdfSignature(pdfBytes), true);
assert.equal(hasPdfSignature(Buffer.from("not a pdf")), false);
const apiInput = buildPdfInputFile(pdfBytes, "student-work.pdf");
assert.deepEqual(
  {
    type: apiInput.type,
    filename: apiInput.filename,
    detail: apiInput.detail,
  },
  {
    type: "input_file",
    filename: "student-work.pdf",
    detail: "high",
  },
);
assert.equal(
  Buffer.from(apiInput.file_data.split(",")[1], "base64").equals(pdfBytes),
  true,
);
assert.equal(apiInput.file_data.includes("student-name"), false);

const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "misconception-map-pdf-intake-"),
);
const databasePath = path.join(tempDirectory, "pdf-intake.db");

try {
  const migration = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "migrate.mjs")],
    {
      cwd: root,
      env: { ...process.env, MISCONCEPTION_MAP_DB_PATH: databasePath },
      encoding: "utf8",
    },
  );
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  try {
    database
      .prepare(
        "INSERT INTO classes (id, name, grade_band) VALUES ('pdf_class', 'PDF class', 'GRADE_7')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO students (id, display_name) VALUES ('pdf_student', 'Synthetic learner')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO class_memberships (id, class_id, student_id) VALUES ('pdf_membership', 'pdf_class', 'pdf_student')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO assignments (id, class_id, title, domain, status) VALUES ('pdf_assignment', 'pdf_class', 'PDF intake', 'ALGEBRA', 'READY')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO problems (id, class_id, domain, prompt, answer_format, correct_answer, origin) VALUES ('pdf_problem', 'pdf_class', 'ALGEBRA', 'Solve x + 1 = 2.', 'EXPRESSION', 'x = 1', 'WORKSHEET')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO assignment_items (id, class_id, assignment_id, problem_id, position) VALUES ('pdf_item', 'pdf_class', 'pdf_assignment', 'pdf_problem', 1)",
      )
      .run();

    const hash = "a".repeat(64);
    database
      .prepare(
        [
          "INSERT INTO assignment_sources",
          "(id, class_id, assignment_id, source_kind, source_bytes, original_filename, media_type, sha256, preprocessing_version)",
          "VALUES ('pdf_source', 'pdf_class', 'pdf_assignment', 'PDF', ?, 'teacher.pdf', ?, ?, ?)",
        ].join(" "),
      )
      .run(pdfBytes, PDF_MEDIA_TYPE, hash, PDF_DIRECT_INPUT_VERSION);
    database
      .prepare(
        [
          "INSERT INTO submissions",
          "(id, class_id, assignment_id, assignment_item_id, scope_kind, membership_id, input_kind)",
          "VALUES ('pdf_submission', 'pdf_class', 'pdf_assignment', NULL, 'FULL_PAGE', 'pdf_membership', 'IMAGE')",
        ].join(" "),
      )
      .run();
    database
      .prepare(
        [
          "INSERT INTO submission_assets",
          "(id, submission_id, page_position, storage_key, original_filename, media_type, byte_size, sha256, preprocessing_version)",
          "VALUES ('pdf_asset', 'pdf_submission', 1, 'uploads/submissions/pdf_submission/pdf_asset.pdf', 'student.pdf', ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(PDF_MEDIA_TYPE, pdfBytes.byteLength, hash, PDF_DIRECT_INPUT_VERSION);

    assert.equal(
      database
        .prepare(
          "SELECT media_type FROM assignment_sources WHERE id = 'pdf_source'",
        )
        .get().media_type,
      PDF_MEDIA_TYPE,
    );
    assert.equal(
      database
        .prepare(
          "SELECT media_type FROM submission_assets WHERE id = 'pdf_asset'",
        )
        .get().media_type,
      PDF_MEDIA_TYPE,
    );
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    database.close();
  }
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log(
  "PDF intake verification passed: signature guard, deidentified direct file input, teacher source persistence, and student asset persistence.",
);
