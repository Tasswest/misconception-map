import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { followUpEvaluationOutputSchema } from "../src/domain/generation-output.mjs";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

// 1. The strict output schema accepts a well-formed evaluation.
const validQuestion = {
  position: 1,
  questionLabel: "1.1",
  prompt: "Développer puis réduire −4(x + 3).",
  answerFormat: "EXPRESSION",
  expectedAnswer: "−4x − 12",
  points: 2,
  targetKind: "MISCONCEPTION",
  targetMisconceptionId: "SIGN_ERROR_DISTRIBUTION",
  sourceQuestionReference: "Ex. 1 · Q1.1",
  whyThisQuestion:
    "Retests distribution of a negative factor over both terms; correct work multiplies −4 into x and 3.",
};
const validEvaluation = {
  title: "Évaluation de suivi — Expressions et équations",
  overview:
    "Chaque question reprend une erreur observée dans la copie corrigée: distribution du signe, réduction des termes, et un item incertain reposé plus clairement.",
  exercises: [
    {
      position: 1,
      exerciseLabel: "Exercice 1 — Développer",
      sharedContext: null,
      questions: [
        validQuestion,
        {
          ...validQuestion,
          position: 2,
          questionLabel: "1.2",
          prompt: "Développer puis réduire −2(y − 5).",
          expectedAnswer: "−2y + 10",
          targetKind: "SLIP",
          targetMisconceptionId: null,
          sourceQuestionReference: "Ex. 3 · Q3.1",
        },
        {
          ...validQuestion,
          position: 3,
          questionLabel: "1.3",
          prompt: "Résoudre 3t + 4 = 19.",
          answerFormat: "NUMBER",
          expectedAnswer: "t = 5",
          targetKind: "UNCERTAIN_RETEST",
          targetMisconceptionId: null,
          sourceQuestionReference: "Ex. 2 · Q2.2",
        },
      ],
    },
  ],
};
followUpEvaluationOutputSchema.parse(validEvaluation);

// 2. Structural safety: a misconception retest must name its taxonomy entry,
// and only a misconception retest may carry one.
assert.equal(
  followUpEvaluationOutputSchema.safeParse({
    ...validEvaluation,
    exercises: [
      {
        ...validEvaluation.exercises[0],
        questions: [
          { ...validQuestion, targetMisconceptionId: null },
        ],
      },
    ],
  }).success,
  false,
  "a MISCONCEPTION question without a taxonomy id must be rejected",
);
assert.equal(
  followUpEvaluationOutputSchema.safeParse({
    ...validEvaluation,
    exercises: [
      {
        ...validEvaluation.exercises[0],
        questions: [
          {
            ...validQuestion,
            targetKind: "SLIP",
          },
        ],
      },
    ],
  }).success,
  false,
  "a SLIP question carrying a taxonomy id must be rejected",
);

// 3. Duplicate structure is rejected: cloned prompts and repeated positions.
assert.equal(
  followUpEvaluationOutputSchema.safeParse({
    ...validEvaluation,
    exercises: [
      {
        ...validEvaluation.exercises[0],
        questions: [
          validQuestion,
          { ...validQuestion, position: 2, questionLabel: "1.2" },
        ],
      },
    ],
  }).success,
  false,
  "two structurally identical prompts must be rejected",
);
assert.equal(
  followUpEvaluationOutputSchema.safeParse({
    ...validEvaluation,
    exercises: [
      validEvaluation.exercises[0],
      { ...validEvaluation.exercises[0] },
    ],
  }).success,
  false,
  "duplicate exercise positions must be rejected",
);

// 4. The migration keeps evaluations append-only and target-coherent.
const migration = read("db/migrations/022_follow_up_evaluations.sql");
assert.match(migration, /CREATE TABLE follow_up_evaluations/);
assert.match(migration, /\) STRICT;/);
assert.match(migration, /input_hash TEXT NOT NULL CHECK \(length\(input_hash\) = 64\)/);
assert.match(
  migration,
  /CHECK \(\(target_kind = 'MISCONCEPTION'\) = \(target_misconception_id IS NOT NULL\)\)/,
);
assert.match(migration, /follow_up_evaluations_are_append_only/);
assert.match(migration, /follow-up evaluations are append-only/);

// 5. The generation call demands source-language mirroring and full coverage,
// and the service enforces coverage instead of trusting the model.
const generation = read("src/server/openai/generate-instructional-support.ts");
assert.match(generation, /generateFollowUpEvaluation/);
assert.match(generation, /followUpEvaluationInputHash/);
assert.match(
  generation,
  /same language as the supplied source exam content/,
);
assert.match(
  generation,
  /at least one question per misconception type/,
);
assert.match(generation, /never a copy of the source question/);
const service = read("src/server/services/instructional-support.ts");
assert.match(service, /assertFollowUpCoverage/);
assert.match(service, /OPENAI_OUTPUT_INVALID/);
assert.match(service, /findFollowUpEvaluationIdByInputHash/);

// 6. The API route keeps the local guard, spend protection, and empty-body rule.
const route = read(
  "src/app/api/assignments/[assignmentId]/follow-up-evaluation/route.ts",
);
assert.match(route, /guardLocalApiRequest/);
assert.match(route, /beginAiRequest/);
assert.match(route, /requireDeclaredBodyWithinLimit/);
assert.match(route, /protectedRequest\.release\(\)/);

// 7. The printable page and entry point exist; spend estimates count the runs.
for (const file of [
  "src/app/analytics/[assignmentId]/follow-up/[evaluationId]/page.tsx",
  "src/components/follow-up/generate-follow-up-evaluation-button.tsx",
  "src/server/repositories/follow-up-evaluation.ts",
]) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
}
const page = read(
  "src/app/analytics/[assignmentId]/follow-up/[evaluationId]/page.tsx",
);
assert.match(page, /Teacher answer key/);
assert.match(page, /never enters the gradebook/);
assert.match(page, /PrintButton/);
const practiceTab = read("src/app/analytics/[assignmentId]/practice/page.tsx");
assert.match(practiceTab, /GenerateFollowUpEvaluationButton/);
const spend = read("src/server/openai/spend-protection.ts");
assert.match(spend, /FROM follow_up_evaluations/);

console.log(
  "Follow-up evaluation verification passed: strict schema, target coherence, append-only storage, coverage enforcement, guarded route, and printable answer key.",
);
