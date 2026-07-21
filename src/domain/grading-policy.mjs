export const MANUAL_SCORING_REASONS = [
  "NEEDS_REVIEW",
  "ABSTAINED",
  "CANNOT_CORRECT",
];

const ABSTENTION_OUTCOMES = new Set([
  "INSUFFICIENT_EVIDENCE",
  "MULTIPLE_PLAUSIBLE",
]);

/**
 * @typedef {{
 *   position: number,
 *   step: string,
 *   correctness: "CORRECT" | "INCORRECT" | "UNCLEAR",
 *   correctNote: string | null,
 *   errorNote: string | null
 * }} GradingDiagnosisStep
 * @typedef {{
 *   id: string,
 *   outcome: "CORRECT" | "INCORRECT" | "MISCONCEPTION" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE" | "MULTIPLE_PLAUSIBLE",
 *   transcription: string,
 *   evidenceQuote: string | null,
 *   steps: GradingDiagnosisStep[]
 * }} GradingDiagnosis
 * @typedef {{
 *   assignmentItemId: string,
 *   diagnosisId: string | null,
 *   position: number,
 *   questionReference: string,
 *   maxPoints: number,
 *   diagnosis: GradingDiagnosis | null
 * }} GradingQuestion
 * @typedef {{
 *   assignmentItemId: string,
 *   proposedScore: number,
 *   evidenceQuote: string,
 *   justification: string
 * }} AIProposedItem
 */

/** @param {GradingQuestion} question */
export function classifyGradeProposalQuestion(question) {
  if (!question.diagnosis) {
    return { eligible: false, manualReason: "CANNOT_CORRECT" };
  }
  if (question.diagnosis.outcome === "NEEDS_REVIEW") {
    return { eligible: false, manualReason: "NEEDS_REVIEW" };
  }
  if (ABSTENTION_OUTCOMES.has(question.diagnosis.outcome)) {
    return { eligible: false, manualReason: "ABSTAINED" };
  }
  if (question.diagnosis.outcome === "CORRECT") {
    return {
      eligible: true,
      creditBasis: "FULL_CORRECT_REASONING",
      leadingCorrectStepCount: question.diagnosis.steps.length,
    };
  }
  if (
    question.diagnosis.outcome !== "INCORRECT" &&
    question.diagnosis.outcome !== "MISCONCEPTION"
  ) {
    return { eligible: false, manualReason: "CANNOT_CORRECT" };
  }

  const firstFlawedStep = question.diagnosis.steps.findIndex(
    (step) => step.correctness === "INCORRECT",
  );
  if (firstFlawedStep < 0) {
    return { eligible: false, manualReason: "CANNOT_CORRECT" };
  }
  const prefix = question.diagnosis.steps.slice(0, firstFlawedStep);
  const leadingCorrectStepCount = prefix.every(
    (step) => step.correctness === "CORRECT",
  )
    ? prefix.length
    : 0;
  return {
    eligible: true,
    creditBasis:
      leadingCorrectStepCount > 0
        ? "PARTIAL_CORRECT_PREFIX"
        : "ZERO_NO_CREDITABLE_WORK",
    leadingCorrectStepCount,
  };
}

/** @param {string} value */
function normalizedEvidence(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** @param {GradingQuestion} question @param {AIProposedItem} proposed */
export function guardAIGradeProposal(question, proposed) {
  const classification = classifyGradeProposalQuestion(question);
  if (!classification.eligible) {
    throw new Error("Manual-scoring questions must not receive an AI score.");
  }
  const diagnosis = question.diagnosis;
  if (!diagnosis) {
    throw new Error("An AI score requires a corrected diagnosis.");
  }
  if (proposed.assignmentItemId !== question.assignmentItemId) {
    throw new Error("The AI grade proposal targeted the wrong question.");
  }
  if (!Number.isFinite(proposed.proposedScore)) {
    throw new Error("The AI grade proposal score is not finite.");
  }
  const score = Math.round(proposed.proposedScore * 100) / 100;
  if (score < 0 || score > question.maxPoints) {
    throw new Error("The AI grade proposal exceeds the question points.");
  }

  const groundingText = normalizedEvidence(
    [
      diagnosis.transcription,
      diagnosis.evidenceQuote ?? "",
      ...diagnosis.steps.map((step) => step.step),
    ].join("\n"),
  );
  const evidenceQuote = normalizedEvidence(proposed.evidenceQuote);
  if (!evidenceQuote || !groundingText.includes(evidenceQuote)) {
    throw new Error("The AI grade proposal cites work not present in the diagnosis.");
  }

  if (classification.creditBasis === "FULL_CORRECT_REASONING") {
    return {
      ...proposed,
      proposedScore: question.maxPoints,
      creditBasis: classification.creditBasis,
      evidenceQuote,
    };
  }
  if (classification.creditBasis === "PARTIAL_CORRECT_PREFIX") {
    if (score <= 0 || score >= question.maxPoints) {
      throw new Error(
        "Grounded correct steps before the flaw require a partial score.",
      );
    }
    return {
      ...proposed,
      proposedScore: score,
      creditBasis: classification.creditBasis,
      evidenceQuote,
    };
  }
  if (score !== 0) {
    throw new Error(
      "A response without a grounded correct prefix cannot receive automatic credit.",
    );
  }
  return {
    ...proposed,
    proposedScore: 0,
    creditBasis: classification.creditBasis,
    evidenceQuote,
  };
}

/**
 * @param {GradingQuestion} question
 * @param {"NEEDS_REVIEW" | "ABSTAINED" | "CANNOT_CORRECT"} manualReason
 */
export function manualGradeProposalItem(question, manualReason) {
  if (!MANUAL_SCORING_REASONS.includes(manualReason)) {
    throw new Error("Unknown manual scoring reason.");
  }
  return {
    assignmentItemId: question.assignmentItemId,
    diagnosisId: question.diagnosis?.id ?? null,
    position: question.position,
    questionReference: question.questionReference,
    maxPoints: question.maxPoints,
    proposedScore: null,
    creditBasis: "MANUAL_REQUIRED",
    evidenceQuote: null,
    justification: null,
    manualReason,
  };
}
