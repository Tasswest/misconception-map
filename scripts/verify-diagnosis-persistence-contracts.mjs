// @ts-check

import assert from "node:assert/strict";

import { normalizeProblemRegion } from "../src/domain/problem-region.mjs";
import {
  selectDiagnosisCompletionFields,
  selectStudentPageCompletionFields,
} from "../src/server/openai/diagnosis-completion-fields.mjs";

/** @typedef {import("../src/server/openai/diagnose-submission").DiagnoseSubmissionResult} DiagnoseSubmissionResult */
/** @typedef {import("../src/server/openai/diagnose-submission").DiagnoseStudentPageResult} DiagnoseStudentPageResult */
/** @typedef {import("../src/server/repositories/diagnosis").DiagnosisRunCompletionInput} DiagnosisRunCompletionInput */
/** @typedef {import("../src/server/repositories/diagnosis").StudentPageRunCompletionInput} StudentPageRunCompletionInput */

const inputHash = "a".repeat(64);
const outputHash = "b".repeat(64);

/** @type {DiagnoseSubmissionResult["result"]} */
const persistableResult = {
  diagnosis: {
    outcome: "CORRECT",
    misconceptionId: null,
    confidence: 0.96,
    severity: 0,
    transcription: "x = 4",
    steps: [
      {
        position: 1,
        step: "x = 4",
        normalizedMath: "x=4",
        stepKind: "EQUATION",
        parseIssue: null,
        correctness: "CORRECT",
        correctNote: "The equation matches the expected solution.",
        errorNote: null,
        evidenceQuote: "x = 4",
      },
    ],
    transcriptionConfidence: 0.97,
    reasoningConfidence: 0.96,
    evidenceQuote: "x = 4",
    reviewReason: null,
  },
  observedPrompt: "Solve x = 4.",
  studentAnswer: "x = 4",
  normalizedAnswer: "x=4",
  imageQuality: "GOOD",
  observedTransformation: null,
  strategyVariant: null,
  reviewReasons: [],
  candidates: [],
};

const singleServiceResult = /** @satisfies {DiagnoseSubmissionResult} */ ({
  inputHash,
  outputHash,
  responseId: "resp_single_contract_fixture",
  modelName: "gpt-5.6",
  promptVersion: "diagnosis-test",
  schemaVersion: "diagnosis-test",
  inputTokens: 120,
  outputTokens: 80,
  totalTokens: 200,
  latencyMs: 750,
  result: persistableResult,
});

const fullPageServiceResult = /** @satisfies {DiagnoseStudentPageResult} */ ({
  inputHash,
  outputHash,
  responseId: "resp_page_contract_fixture",
  modelName: "gpt-5.6",
  promptVersion: "page-diagnosis-test",
  schemaVersion: "page-diagnosis-test",
  inputTokens: 240,
  outputTokens: 160,
  totalTokens: 400,
  latencyMs: 1_250,
  result: {
    pageTranscriptionConfidence: 0.97,
    imageQuality: "GOOD",
    segmentationReviewNote: null,
    results: [
      {
        assignmentItemId: "00000000-0000-4000-8000-000000000001",
        position: 1,
        correctAnswer: "x = 4",
        region: { x: 0.1, y: 0.2, width: 0.35, height: 0.18 },
        result: persistableResult,
      },
    ],
  },
});

/** @type {NonNullable<DiagnosisRunCompletionInput["attempts"]>[number]} */
const singleAttempt = {
  rendition: "NORMALIZED",
  selected: true,
  inputHash,
  outputHash,
  responseId: singleServiceResult.responseId,
  visibleProblemCount: 1,
  minimumTranscriptionConfidence: 0.97,
  inputTokens: 120,
  outputTokens: 80,
  latencyMs: 750,
};

/** @type {StudentPageRunCompletionInput["attempts"][number]} */
const pageAttempt = {
  ...singleAttempt,
  responseId: fullPageServiceResult.responseId,
  visibleProblemCount: 1,
  inputTokens: 240,
  outputTokens: 160,
  latencyMs: 1_250,
};

const singleCompletion = selectDiagnosisCompletionFields(
  singleServiceResult,
  {
    inputTokens: singleServiceResult.inputTokens,
    outputTokens: singleServiceResult.outputTokens,
    latencyMs: singleServiceResult.latencyMs,
    attempts: [singleAttempt],
  },
);

const pageCompletion = selectStudentPageCompletionFields(
  fullPageServiceResult,
  {
    inputTokens: fullPageServiceResult.inputTokens,
    outputTokens: fullPageServiceResult.outputTokens,
    latencyMs: fullPageServiceResult.latencyMs,
    attempts: [pageAttempt],
  },
);

/** @param {DiagnosisRunCompletionInput} completion */
function acceptSinglePersistenceInput(completion) {
  return completion;
}

/** @param {StudentPageRunCompletionInput} completion */
function acceptStudentPagePersistenceInput(completion) {
  return completion;
}

const persistedSingle = acceptSinglePersistenceInput(singleCompletion);
const persistedPage = acceptStudentPagePersistenceInput(pageCompletion);
const persistenceKeys = [
  "attempts",
  "inputTokens",
  "latencyMs",
  "modelName",
  "outputHash",
  "outputTokens",
  "promptVersion",
  "responseId",
  "result",
  "schemaVersion",
];

assert.deepEqual(Object.keys(persistedSingle).sort(), persistenceKeys);
assert.deepEqual(Object.keys(persistedPage).sort(), persistenceKeys);
assert.equal("inputHash" in persistedSingle, false);
assert.equal("totalTokens" in persistedSingle, false);
assert.equal("inputHash" in persistedPage, false);
assert.equal("totalTokens" in persistedPage, false);
assert.equal(persistedSingle.result, singleServiceResult.result);
assert.equal(persistedPage.result, fullPageServiceResult.result);
assert.deepEqual(normalizeProblemRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }), {
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
});
assert.equal(
  normalizeProblemRegion({ x: 0.9, y: 0.2, width: 0.2, height: 0.4 }),
  null,
);
assert.equal(
  normalizeProblemRegion({ x: 0.1, y: 0.2, width: 0.001, height: 0.4 }),
  null,
);
/** @type {StudentPageRunCompletionInput} */
const historicalPageCompletion = {
  ...persistedPage,
  result: {
    ...persistedPage.result,
    results: persistedPage.result.results.map((result) => ({
      assignmentItemId: result.assignmentItemId,
      position: result.position,
      correctAnswer: result.correctAnswer,
      result: result.result,
    })),
  },
};
assert.equal("region" in historicalPageCompletion.result.results[0], false);

console.log(
  "Diagnosis persistence contract verification passed: actual service shapes are reduced to strict persistence fields, optional page regions are backward-compatible, and invalid regions are discarded.",
);
