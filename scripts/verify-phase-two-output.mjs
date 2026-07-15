import assert from "node:assert/strict";

import { zodTextFormat } from "openai/helpers/zod";

import { diagnosisAIOutputSchema } from "../src/domain/diagnosis-ai-output.mjs";
import {
  LOW_CONFIDENCE_REVIEW_THRESHOLD,
  normalizeDiagnosisAIOutput,
} from "../src/domain/diagnosis-policy.mjs";

const baseOutput = {
  outcome: "MISCONCEPTION",
  transcription: "-(x + 4) = -x + 4",
  steps: [
    {
      position: 1,
      step: "-(x + 4) = -x + 4",
      normalizedMath: "-(x+4)=-x+4",
      stepKind: "EQUATION",
      parseIssue: null,
      correctness: "INCORRECT",
      correctNote: null,
      errorNote: "The sign changed only the first term.",
      evidenceQuote: "-x + 4",
    },
  ],
  observedPrompt: "Expand -(x + 4).",
  studentAnswer: "-x + 4",
  normalizedAnswer: "-x + 4",
  misconceptionId: "SIGN_ERROR_DISTRIBUTION",
  confidence: 0.93,
  transcriptionConfidence: 0.96,
  reasoningConfidence: 0.91,
  evidenceQuote: "-x + 4",
  severity: 3,
  imageQuality: "GOOD",
  observedTransformation: {
    inputExpression: "-(x + 4)",
    observedOutput: "-x + 4",
    transformationDescription: "Changed only the first sign.",
    sourceStepPosition: 1,
  },
  strategyVariant: "Changes the first sign only.",
  reviewReasons: [],
  candidates: [
    {
      rank: 1,
      misconceptionId: "SIGN_ERROR_DISTRIBUTION",
      confidence: 0.93,
      evidenceQuote: "-x + 4",
    },
  ],
};

function normalize(output, overrides = {}) {
  return normalizeDiagnosisAIOutput({
    output,
    assignmentDomain: "ALGEBRA",
    inputKind: "IMAGE",
    observedPrompt: "Expand -(x + 4).",
    correctAnswer: "-x - 4",
    typedResponse: null,
    ...overrides,
  });
}

const textFormat = zodTextFormat(
  diagnosisAIOutputSchema,
  "misconception_diagnosis_verifier",
);
const rootSchema = textFormat.schema;

assert.equal(rootSchema.type, "object");
assert.equal(rootSchema.additionalProperties, false);
assert.equal("anyOf" in rootSchema, false);
assert.deepEqual(
  [...rootSchema.required].sort(),
  Object.keys(rootSchema.properties).sort(),
);
assert.equal(textFormat.strict, true);
assert.equal(LOW_CONFIDENCE_REVIEW_THRESHOLD, 0.72);

assert.throws(() =>
  diagnosisAIOutputSchema.parse({ ...baseOutput, unexpected: true }),
);

const valid = normalize(baseOutput);
assert.equal(valid.coreDiagnosis.outcome, "MISCONCEPTION");
assert.equal(
  valid.coreDiagnosis.misconceptionId,
  "SIGN_ERROR_DISTRIBUTION",
);
assert.equal(valid.coreDiagnosis.confidence, 0.91);
assert.deepEqual(valid.reviewReasons, []);
assert.equal(valid.candidates[0].rank, 1);

const missingPrimaryCandidate = normalize({
  ...baseOutput,
  candidates: [],
});
assert.equal(
  missingPrimaryCandidate.coreDiagnosis.outcome,
  "MISCONCEPTION",
);
assert.deepEqual(missingPrimaryCandidate.reviewReasons, []);
assert.equal(
  missingPrimaryCandidate.candidates[0].misconceptionId,
  "SIGN_ERROR_DISTRIBUTION",
);

const duplicatePrimaryCandidate = normalize({
  ...baseOutput,
  candidates: [
    ...baseOutput.candidates,
    {
      ...baseOutput.candidates[0],
      rank: 2,
      confidence: 0.9,
    },
  ],
});
assert.equal(
  duplicatePrimaryCandidate.coreDiagnosis.outcome,
  "MISCONCEPTION",
);
assert.deepEqual(duplicatePrimaryCandidate.reviewReasons, []);
assert.equal(duplicatePrimaryCandidate.candidates.length, 1);

const bareWrongAnswer = normalize({
  ...baseOutput,
  transcription: "2/5",
  studentAnswer: "2/5",
  normalizedAnswer: "2/5",
  steps: [
    {
      position: 1,
      step: "2/5",
      normalizedMath: "2/5",
      stepKind: "ANSWER",
      parseIssue: null,
      correctness: "INCORRECT",
      correctNote: null,
      errorNote: "The final answer is incorrect.",
      evidenceQuote: "2/5",
    },
  ],
  evidenceQuote: "2/5",
  observedTransformation: null,
});
assert.equal(bareWrongAnswer.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.ok(
  bareWrongAnswer.reviewReasons.includes("INSUFFICIENT_WORK_SHOWN"),
);

const bareWrongAnswerWithSelfTransformation = normalize({
  ...baseOutput,
  transcription: "2/5",
  studentAnswer: "2/5",
  normalizedAnswer: "2/5",
  steps: [
    {
      position: 1,
      step: "2/5",
      normalizedMath: "2/5",
      stepKind: "ANSWER",
      parseIssue: null,
      correctness: "INCORRECT",
      correctNote: null,
      errorNote: "The final answer is incorrect.",
      evidenceQuote: "2/5",
    },
  ],
  evidenceQuote: "2/5",
  observedTransformation: {
    inputExpression: "2/5",
    observedOutput: "2/5",
    transformationDescription: "Repeated the bare answer.",
    sourceStepPosition: 1,
  },
});
assert.equal(
  bareWrongAnswerWithSelfTransformation.coreDiagnosis.outcome,
  "NEEDS_REVIEW",
);
assert.ok(
  bareWrongAnswerWithSelfTransformation.reviewReasons.includes(
    "INSUFFICIENT_WORK_SHOWN",
  ),
);
assert.ok(
  bareWrongAnswerWithSelfTransformation.reviewReasons.includes(
    "INCONSISTENT_OUTPUT",
  ),
);

const bareFinalEquation = normalize({
  ...baseOutput,
  transcription: "x = 4",
  studentAnswer: "x = 4",
  normalizedAnswer: "x=4",
  steps: [
    {
      position: 1,
      step: "x = 4",
      normalizedMath: "x=4",
      stepKind: "EQUATION",
      parseIssue: null,
      correctness: "INCORRECT",
      correctNote: null,
      errorNote: "Only the final equation is visible.",
      evidenceQuote: "x = 4",
    },
  ],
  evidenceQuote: "x = 4",
  observedTransformation: {
    inputExpression: "x",
    observedOutput: "4",
    transformationDescription: "Claims a final value.",
    sourceStepPosition: 1,
  },
});
assert.equal(bareFinalEquation.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.ok(
  bareFinalEquation.reviewReasons.includes("INSUFFICIENT_WORK_SHOWN"),
);

const bareFinalEquationSplitIntoInventedSteps = normalize({
  ...baseOutput,
  transcription: "x = 4",
  studentAnswer: "x = 4",
  normalizedAnswer: "x=4",
  steps: [
    {
      position: 1,
      step: "x",
      normalizedMath: "x",
      stepKind: "EXPRESSION",
      parseIssue: null,
      correctness: "CORRECT",
      correctNote: "This is a valid expression copied from the visible equation.",
      errorNote: null,
      evidenceQuote: "x",
    },
    {
      position: 2,
      step: "x = 4",
      normalizedMath: "x=4",
      stepKind: "EQUATION",
      parseIssue: null,
      correctness: "INCORRECT",
      correctNote: null,
      errorNote: "Only the final equation is visible.",
      evidenceQuote: "x = 4",
    },
  ],
  evidenceQuote: "x = 4",
  observedTransformation: {
    inputExpression: "x",
    observedOutput: "4",
    transformationDescription: "Claims a final value.",
    sourceStepPosition: 2,
  },
});
assert.equal(
  bareFinalEquationSplitIntoInventedSteps.coreDiagnosis.outcome,
  "NEEDS_REVIEW",
);
assert.ok(
  bareFinalEquationSplitIntoInventedSteps.reviewReasons.includes(
    "UNGROUNDED_EVIDENCE",
  ),
);
assert.ok(
  bareFinalEquationSplitIntoInventedSteps.reviewReasons.includes(
    "INSUFFICIENT_WORK_SHOWN",
  ),
);

const inventedReasoningStep = normalize({
  ...baseOutput,
  transcription: "-x + 4",
  studentAnswer: "-x + 4",
  steps: [baseOutput.steps[0]],
});
assert.equal(inventedReasoningStep.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.ok(
  inventedReasoningStep.reviewReasons.includes("UNGROUNDED_EVIDENCE"),
);
assert.ok(
  inventedReasoningStep.reviewReasons.includes("INSUFFICIENT_WORK_SHOWN"),
);

const misconceptionWithoutIncorrectStep = normalize({
  ...baseOutput,
  steps: baseOutput.steps.map((step) => ({
    ...step,
    correctness: "CORRECT",
  })),
});
assert.equal(
  misconceptionWithoutIncorrectStep.coreDiagnosis.outcome,
  "NEEDS_REVIEW",
);
assert.ok(
  misconceptionWithoutIncorrectStep.reviewReasons.includes(
    "INSUFFICIENT_WORK_SHOWN",
  ),
);

const correctWithIncorrectStep = normalize({
  ...baseOutput,
  outcome: "CORRECT",
  misconceptionId: null,
  severity: 0,
  observedTransformation: null,
  strategyVariant: null,
  candidates: [],
});
assert.equal(correctWithIncorrectStep.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.ok(
  correctWithIncorrectStep.reviewReasons.includes("INCONSISTENT_OUTPUT"),
);

const correctWithCandidate = normalize({
  ...baseOutput,
  outcome: "CORRECT",
  misconceptionId: null,
  severity: 0,
  observedTransformation: null,
  strategyVariant: null,
  steps: baseOutput.steps.map((step) => ({
    ...step,
    correctness: "CORRECT",
    correctNote: "The equality follows from a valid operation.",
    errorNote: null,
  })),
});
assert.equal(correctWithCandidate.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.ok(correctWithCandidate.reviewReasons.includes("INCONSISTENT_OUTPUT"));

const lowConfidence = normalize({
  ...baseOutput,
  confidence: 0.6,
});
assert.equal(lowConfidence.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.equal(lowConfidence.coreDiagnosis.misconceptionId, null);
assert.ok(lowConfidence.reviewReasons.includes("LOW_CONFIDENCE"));

const ungrounded = normalize({
  ...baseOutput,
  evidenceQuote: "a quote that is not present",
});
assert.equal(ungrounded.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.equal(ungrounded.coreDiagnosis.evidenceQuote, null);
assert.ok(ungrounded.reviewReasons.includes("UNGROUNDED_EVIDENCE"));
assert.ok(ungrounded.reviewReasons.includes("MISSING_EVIDENCE"));

const wrongDomain = normalize(
  {
    ...baseOutput,
    misconceptionId: "FRACTION_AS_TWO_NUMBERS",
    candidates: [
      {
        rank: 1,
        misconceptionId: "FRACTION_AS_TWO_NUMBERS",
        confidence: 0.93,
        evidenceQuote: "-x + 4",
      },
    ],
  },
  { assignmentDomain: "ALGEBRA" },
);
assert.equal(wrongDomain.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.equal(wrongDomain.coreDiagnosis.misconceptionId, null);
assert.deepEqual(wrongDomain.candidates, []);
assert.ok(wrongDomain.reviewReasons.includes("DOMAIN_MISMATCH"));

const poorImage = normalize({
  ...baseOutput,
  imageQuality: "POOR",
});
assert.equal(poorImage.coreDiagnosis.outcome, "INSUFFICIENT_EVIDENCE");
assert.ok(poorImage.reviewReasons.includes("POOR_IMAGE_QUALITY"));

const lowTranscription = normalize({
  ...baseOutput,
  transcriptionConfidence: 0.4,
});
assert.equal(
  lowTranscription.coreDiagnosis.outcome,
  "INSUFFICIENT_EVIDENCE",
);
assert.ok(
  lowTranscription.reviewReasons.includes("LOW_TRANSCRIPTION_CONFIDENCE"),
);

const implausibleFinalLine = normalize(
  {
    ...baseOutput,
    transcription: "−3(x+4)=0\nx+4=0\n4−x",
    steps: [
      {
        position: 1,
        step: "−3(x+4)=0",
        normalizedMath: "-3(x+4)=0",
        stepKind: "EQUATION",
        parseIssue: null,
        correctness: "CORRECT",
        correctNote: "This is the original equation from the student work.",
        errorNote: null,
        evidenceQuote: "−3(x+4)=0",
      },
      {
        position: 2,
        step: "x+4=0",
        normalizedMath: "x+4=0",
        stepKind: "EQUATION",
        parseIssue: null,
        correctness: "CORRECT",
        correctNote: "Dividing both sides by −3 preserves equality.",
        errorNote: null,
        evidenceQuote: "x+4=0",
      },
      {
        position: 3,
        step: "4−x",
        normalizedMath: "4-x",
        stepKind: "EXPRESSION",
        parseIssue: null,
        correctness: "INCORRECT",
        correctNote: null,
        errorNote: "This fragment does not state a solved equation.",
        evidenceQuote: "4−x",
      },
    ],
    observedPrompt: "Solve −3(x+4)=0 for x.",
    studentAnswer: "4−x",
    normalizedAnswer: null,
    evidenceQuote: "4−x",
    observedTransformation: {
      inputExpression: "x+4=0",
      observedOutput: "4−x",
      transformationDescription: "Produced a variable-containing fragment.",
      sourceStepPosition: 3,
    },
  },
  {
    observedPrompt: "Solve −3(x+4)=0 for x.",
    correctAnswer: "x=−4",
  },
);
assert.equal(implausibleFinalLine.coreDiagnosis.outcome, "NEEDS_REVIEW");
assert.ok(
  implausibleFinalLine.coreDiagnosis.transcriptionConfidence <
    LOW_CONFIDENCE_REVIEW_THRESHOLD,
);
assert.ok(
  implausibleFinalLine.reviewReasons.includes(
    "IMPLAUSIBLE_TRANSCRIPTION_STEP",
  ),
);
assert.ok(
  !implausibleFinalLine.reviewReasons.includes("LOW_TRANSCRIPTION_CONFIDENCE"),
);

const typed = normalizeDiagnosisAIOutput({
  output: {
    ...baseOutput,
    outcome: "CORRECT",
    transcription: "model-rewritten answer",
    steps: [
      {
        position: 1,
        step: "x = 4",
        normalizedMath: "x=4",
        stepKind: "EQUATION",
        parseIssue: null,
        correctness: "CORRECT",
        correctNote: "The value makes the equation true.",
        errorNote: null,
        evidenceQuote: "x = 4",
      },
    ],
    studentAnswer: "x = 4",
    normalizedAnswer: "x = -4",
    misconceptionId: null,
    severity: 0,
    imageQuality: "GOOD",
    observedTransformation: null,
    strategyVariant: null,
    evidenceQuote: "x = 4",
    reviewReasons: [],
    candidates: [],
  },
  assignmentDomain: "ALGEBRA",
  inputKind: "TYPED",
  observedPrompt: "Solve x + 2 = 6.",
  correctAnswer: "x = 4",
  typedResponse: "x = 4",
});
assert.equal(typed.coreDiagnosis.outcome, "CORRECT");
assert.equal(typed.coreDiagnosis.transcription, "x = 4");
assert.equal(typed.studentAnswer, "x = 4");
assert.equal(typed.normalizedAnswer, "x=4");
assert.equal(typed.imageQuality, "NOT_APPLICABLE");
assert.equal(typed.coreDiagnosis.transcriptionConfidence, 1);

console.log(
  "Phase 2 AI-output verification passed: strict schema, grounding, problem-aware parseability, domain, confidence, and abstention policies.",
);
