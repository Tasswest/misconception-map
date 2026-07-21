import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

import {
  classifyGradeProposalQuestion,
  guardAIGradeProposal,
  manualGradeProposalItem,
} from "../src/domain/grading-policy.mjs";

const root = process.cwd();
const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "misconception-map-ai-grading-"),
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function runScript(script, databasePath) {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: {
      ...process.env,
      MISCONCEPTION_MAP_DB_PATH: databasePath,
      OPENAI_API_KEY: "",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${script} failed:\n${result.stderr || result.stdout}`);
}

function verifyGroundedPartialCreditPolicy() {
  const partialQuestion = {
    assignmentItemId: "00000000-0000-4000-8000-000000000001",
    diagnosisId: "00000000-0000-4000-8000-000000000002",
    position: 1,
    questionReference: "Ex. 1 · Q1.1",
    maxPoints: 4,
    diagnosis: {
      id: "00000000-0000-4000-8000-000000000002",
      outcome: "MISCONCEPTION",
      transcription: "2(x + 3)\n2x + 6\n2x + 5",
      evidenceQuote: "2x + 5",
      steps: [
        {
          position: 1,
          step: "2x + 6",
          correctness: "CORRECT",
          correctNote: "Distribution correcte.",
          errorNote: null,
        },
        {
          position: 2,
          step: "2x + 5",
          correctness: "INCORRECT",
          correctNote: null,
          errorNote: "La constante a été modifiée.",
        },
      ],
    },
  };
  assert.deepEqual(classifyGradeProposalQuestion(partialQuestion), {
    eligible: true,
    creditBasis: "PARTIAL_CORRECT_PREFIX",
    leadingCorrectStepCount: 1,
  });
  const guarded = guardAIGradeProposal(partialQuestion, {
    assignmentItemId: partialQuestion.assignmentItemId,
    proposedScore: 2,
    evidenceQuote: "2x + 6",
    justification:
      "La distribution 2x + 6 est correcte avant la modification erronée de la constante ; elle justifie un crédit partiel.",
  });
  assert.equal(guarded.proposedScore, 2);
  assert.equal(guarded.creditBasis, "PARTIAL_CORRECT_PREFIX");
  assert.throws(
    () =>
      guardAIGradeProposal(partialQuestion, {
        assignmentItemId: partialQuestion.assignmentItemId,
        proposedScore: 2,
        evidenceQuote: "travail inventé",
        justification: "Crédit partiel.",
      }),
    /not present in the diagnosis/,
  );
  assert.throws(
    () =>
      guardAIGradeProposal(partialQuestion, {
        assignmentItemId: partialQuestion.assignmentItemId,
        proposedScore: 0,
        evidenceQuote: "2x + 6",
        justification: "Aucun point.",
      }),
    /require a partial score/,
  );
}

function verifyNoScoreOnAbstention() {
  const abstainedQuestion = {
    assignmentItemId: "00000000-0000-4000-8000-000000000003",
    diagnosisId: "00000000-0000-4000-8000-000000000004",
    position: 2,
    questionReference: "Ex. 1 · Q1.2",
    maxPoints: 4,
    diagnosis: {
      id: "00000000-0000-4000-8000-000000000004",
      outcome: "NEEDS_REVIEW",
      transcription: "−3x 12",
      evidenceQuote: null,
      steps: [
        {
          position: 1,
          step: "−3x 12",
          correctness: "UNCLEAR",
          correctNote: null,
          errorNote: null,
        },
      ],
    },
  };
  const classification = classifyGradeProposalQuestion(abstainedQuestion);
  assert.deepEqual(classification, {
    eligible: false,
    manualReason: "NEEDS_REVIEW",
  });
  const manual = manualGradeProposalItem(
    abstainedQuestion,
    classification.manualReason,
  );
  assert.equal(manual.proposedScore, null);
  assert.equal(manual.justification, null);
  assert.equal(manual.creditBasis, "MANUAL_REQUIRED");
  assert.throws(
    () =>
      guardAIGradeProposal(abstainedQuestion, {
        assignmentItemId: abstainedQuestion.assignmentItemId,
        proposedScore: 0,
        evidenceQuote: "−3x 12",
        justification: "Aucun point.",
      }),
    /must not receive an AI score/,
  );
}

function verifyProposedToValidatedTransition() {
  const databasePath = path.join(tempDirectory, "transition.db");
  runScript("scripts/migrate.mjs", databasePath);
  runScript("scripts/seed.mjs", databasePath);
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  try {
    const pending = database
      .prepare(
        "SELECT id, class_id, assignment_id, membership_id, max_score FROM exam_grade_proposals WHERE status = 'PROPOSED'",
      )
      .get();
    assert.ok(pending, "the deterministic demo must contain a pending proposal");
    assert.equal(
      database
        .prepare(
          "SELECT count(*) FROM exam_grades WHERE assignment_id = ? AND membership_id = ?",
        )
        .pluck()
        .get(pending.assignment_id, pending.membership_id),
      0,
      "a proposed grade must not enter exam_grades",
    );
    const proposalItems = database
      .prepare(
        "SELECT assignment_item_id, proposed_score, max_points, manual_reason FROM exam_grade_proposal_items WHERE proposal_id = ? ORDER BY position",
      )
      .all(pending.id);
    assert.ok(
      proposalItems.some(
        (item) => item.manual_reason !== null && item.proposed_score === null,
      ),
      "the demo proposal must preserve at least one abstention as no score",
    );

    const validatedAt = "2026-02-01T10:00:00.000Z";
    const finalItems = proposalItems.map((item) => ({
      ...item,
      finalScore: item.proposed_score ?? 0,
    }));
    database.transaction(() => {
      const updateItem = database.prepare(
        "UPDATE exam_grade_proposal_items SET final_score = ?, validated_at = ? WHERE proposal_id = ? AND assignment_item_id = ?",
      );
      const insertAudit = database.prepare(
        "INSERT INTO exam_grade_validation_audit (id, proposal_id, assignment_item_id, ai_proposed_score, teacher_final_score, max_points, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const item of finalItems) {
        updateItem.run(
          item.finalScore,
          validatedAt,
          pending.id,
          item.assignment_item_id,
        );
        insertAudit.run(
          randomUUID(),
          pending.id,
          item.assignment_item_id,
          item.proposed_score,
          item.finalScore,
          item.max_points,
          validatedAt,
        );
      }
      database
        .prepare(
          "UPDATE exam_grade_proposals SET status = 'VALIDATED', validated_at = ? WHERE id = ?",
        )
        .run(validatedAt, pending.id);
      const finalTotal = finalItems.reduce(
        (sum, item) => sum + item.finalScore,
        0,
      );
      database
        .prepare(
          "INSERT INTO exam_grades (id, class_id, assignment_id, membership_id, score, max_score, graded_at, created_at, updated_at, validated_proposal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          pending.class_id,
          pending.assignment_id,
          pending.membership_id,
          finalTotal,
          pending.max_score,
          validatedAt,
          validatedAt,
          validatedAt,
          pending.id,
        );
    })();

    assert.equal(
      database
        .prepare("SELECT status FROM exam_grade_proposals WHERE id = ?")
        .pluck()
        .get(pending.id),
      "VALIDATED",
    );
    assert.equal(
      database
        .prepare(
          "SELECT count(*) FROM exam_grade_validation_audit WHERE proposal_id = ?",
        )
        .pluck()
        .get(pending.id),
      proposalItems.length,
    );
    assert.equal(
      database
        .prepare(
          "SELECT validated_proposal_id FROM exam_grades WHERE assignment_id = ? AND membership_id = ?",
        )
        .pluck()
        .get(pending.assignment_id, pending.membership_id),
      pending.id,
    );
    assert.throws(
      () =>
        database
          .prepare(
            "UPDATE exam_grade_proposals SET status = 'PROPOSED', validated_at = NULL WHERE id = ?",
          )
          .run(pending.id),
      /requires validation|PROPOSED to VALIDATED/,
    );
  } finally {
    database.close();
  }
}

function verifyImplementationGuardrails() {
  const openai = read("src/server/openai/propose-grade.ts");
  const route = read(
    "src/app/api/assignments/[assignmentId]/grades/[membershipId]/proposal/route.ts",
  );
  const repository = read("src/server/repositories/grading-proposals.ts");
  const policy = read("src/domain/grading-policy.mjs");
  const extraction = read("src/domain/worksheet-extraction.ts");
  const setup = read("src/components/diagnosis/setup-workspace.tsx");
  assert.match(openai, /responses\.stream\(/);
  assert.match(openai, /zodTextFormat\(/);
  assert.doesNotMatch(openai, /studentName|display_name|displayName/);
  assert.match(policy, /PARTIAL_CORRECT_PREFIX/);
  assert.match(openai, /manualGradeProposalItem/);
  assert.match(route, /validateGradeProposal/);
  assert.match(repository, /status = 'VALIDATED'/);
  assert.match(repository, /validated_proposal_id/);
  assert.equal(
    fs.existsSync(
      path.join(root, "src/app/api/assignments/[assignmentId]/grades/route.ts"),
    ),
    false,
    "the old direct total-grade endpoint must stay removed",
  );
  assert.match(extraction, /printedPoints/);
  assert.match(setup, /question\.points/);
}

try {
  verifyGroundedPartialCreditPolicy();
  verifyNoScoreOnAbstention();
  verifyProposedToValidatedTransition();
  verifyImplementationGuardrails();
  console.log(
    "AI grading verification passed: partial credit is evidence-grounded, abstentions receive no AI score, and only PROPOSED → VALIDATED writes a grade plus audit trail.",
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
