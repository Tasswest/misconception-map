import {
  DIAGNOSIS_REVIEW_REASON_CODES,
  diagnosisAIOutputSchema,
} from "./diagnosis-ai-output.mjs";
import { MISCONCEPTION_BY_ID } from "./misconception-taxonomy.mjs";
import { canonicalizeMathAnswer } from "./math-normalization.mjs";

export const LOW_CONFIDENCE_REVIEW_THRESHOLD = 0.72;

const REVIEW_REASON_CODE_SET = new Set(DIAGNOSIS_REVIEW_REASON_CODES);

/** @typedef {(typeof DIAGNOSIS_REVIEW_REASON_CODES)[number]} ReviewReason */
/** @typedef {import("zod").infer<typeof diagnosisAIOutputSchema>} DiagnosisAIOutput */
/** @typedef {DiagnosisAIOutput["candidates"][number]["misconceptionId"]} MisconceptionId */

/** @param {string | null} value */
function normalizeNullableText(value) {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Evidence persisted for a diagnosis must be a literal, contiguous quote from
 * the observable work. Paraphrases are useful explanations, but not evidence.
 *
 * @param {string | null} quote
 * @param {string} transcription
 * @param {Set<ReviewReason>} policyReasons
 */
function normalizeGroundedQuote(quote, transcription, policyReasons) {
  const normalized = normalizeNullableText(quote);
  if (normalized === null) return null;

  if (transcription.includes(normalized)) return normalized;

  policyReasons.add("UNGROUNDED_EVIDENCE");
  return null;
}

/** @param {string} value */
function canonicalizeObservedMath(value) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** @param {string} value */
function containsTransformationMarker(value) {
  return /(?:=|→|⇒|↦|->|=>)/u.test(value);
}

/** @param {string} value */
function containsEquationOrAnswerMarker(value) {
  return /(?:=|≈|≃|→|⇒|->|=>)/u.test(value);
}

/** @param {string} value */
function isPlausibleScalarAnswer(value) {
  const canonical = canonicalizeObservedMath(value).replace(/[−–—]/gu, "-");
  return /^[+-]?(?:(?:\d+(?:[.,]\d+)?)|(?:\d+\/\d+)|(?:\d+\s+\d+\/\d+))$/u.test(
    canonical,
  );
}

/** @param {string} value */
function isSubstantiveMathExpression(value) {
  const canonical = canonicalizeObservedMath(value);
  // A lone variable or constant copied from a final equation is not the input
  // to an observed reasoning operation. Compound expressions (including 2x,
  // a/b, grouped terms, and explicit operations) can support a transformation.
  return !/^[+-]?(?:\p{L}+|\d+(?:[.,]\d+)?)$/u.test(canonical);
}

/**
 * @param {MisconceptionId} misconceptionId
 * @param {"ALGEBRA" | "FRACTIONS" | "MIXED"} assignmentDomain
 */
function matchesAssignmentDomain(misconceptionId, assignmentDomain) {
  if (assignmentDomain === "MIXED") return true;
  return MISCONCEPTION_BY_ID.get(misconceptionId)?.domain === assignmentDomain;
}

/**
 * Converts model-shaped output into a deterministic persistence candidate.
 * The caller must validate `coreDiagnosis` with `structuredDiagnosisSchema`
 * after this policy pass.
 *
 * @param {{
 *   output: unknown;
 *   assignmentDomain: "ALGEBRA" | "FRACTIONS" | "MIXED";
 *   inputKind: "IMAGE" | "TYPED";
 *   observedPrompt: string;
 *   correctAnswer: string;
 *   typedResponse: string | null;
 *   inTaxonomyScope?: boolean;
 * }} input
 */
export function normalizeDiagnosisAIOutput(input) {
  const parsed = diagnosisAIOutputSchema.parse(input.output);
  const inTaxonomyScope = input.inTaxonomyScope ?? true;
  const requestedOutcome =
    !inTaxonomyScope && parsed.outcome === "MISCONCEPTION"
      ? "INCORRECT"
      : parsed.outcome;

  if (
    input.inputKind === "TYPED" &&
    (input.typedResponse === null || input.typedResponse.trim().length === 0)
  ) {
    throw new TypeError("Typed diagnosis input requires observable work.");
  }

  /** @type {Set<ReviewReason>} */
  const modelReasons = new Set(parsed.reviewReasons);
  /** @type {Set<ReviewReason>} */
  const policyReasons = new Set();

  const transcription =
    input.inputKind === "TYPED"
      ? /** @type {string} */ (input.typedResponse)
      : parsed.transcription;
  let transcriptionConfidence =
    input.inputKind === "TYPED" ? 1 : parsed.transcriptionConfidence;
  const imageQuality =
    input.inputKind === "TYPED" ? "NOT_APPLICABLE" : parsed.imageQuality;

  const sortedSteps = parsed.steps
    .map((step, originalIndex) => ({ step, originalIndex }))
    .sort(
      (left, right) =>
        left.step.position - right.step.position ||
        left.originalIndex - right.originalIndex,
    );

  /** @type {Map<number, number>} */
  const normalizedStepPositionByReportedPosition = new Map();
  /** @type {Set<number>} */
  const groundedStepPositions = new Set();
  /** @type {Map<number, {start: number; end: number}>} */
  const groundedStepSpans = new Map();
  let groundingCursor = 0;
  const steps = sortedSteps.map(({ step }, index) => {
    const position = index + 1;
    if (normalizedStepPositionByReportedPosition.has(step.position)) {
      policyReasons.add("INCONSISTENT_OUTPUT");
    } else {
      normalizedStepPositionByReportedPosition.set(step.position, position);
    }

    const normalizedStep = step.step.trim();
    const parseIssue = normalizeNullableText(step.parseIssue);
    if (
      (step.stepKind === "UNPARSEABLE" && parseIssue === null) ||
      (step.stepKind !== "UNPARSEABLE" && parseIssue !== null)
    ) {
      policyReasons.add("INCONSISTENT_OUTPUT");
    }
    const groundedStart = transcription.indexOf(normalizedStep, groundingCursor);
    if (groundedStart >= 0) {
      const groundedEnd = groundedStart + normalizedStep.length;
      groundedStepPositions.add(position);
      groundedStepSpans.set(position, {
        start: groundedStart,
        end: groundedEnd,
      });
      groundingCursor = groundedEnd;
    } else {
      policyReasons.add("UNGROUNDED_EVIDENCE");
    }

    const correctNote = normalizeNullableText(step.correctNote);
    const errorNote = normalizeNullableText(step.errorNote);
    if (
      (step.correctness === "CORRECT" && correctNote === null) ||
      (step.correctness !== "CORRECT" && correctNote !== null) ||
      (step.correctness === "INCORRECT" && errorNote === null) ||
      (step.correctness === "CORRECT" && errorNote !== null)
    ) {
      policyReasons.add("INCONSISTENT_OUTPUT");
    }

    return {
      position,
      step: normalizedStep,
      normalizedMath: normalizeNullableText(step.normalizedMath),
      stepKind: step.stepKind,
      parseIssue,
      correctness: step.correctness,
      correctNote: step.correctness === "CORRECT" ? correctNote : null,
      errorNote: step.correctness === "CORRECT" ? null : errorNote,
      evidenceQuote: normalizeGroundedQuote(
        step.evidenceQuote,
        transcription,
        policyReasons,
      ),
    };
  });

  const finalMathStep = steps.findLast(
    (step) => step.stepKind !== "ANNOTATION",
  );
  const equationAnswerExpected =
    input.inputKind === "IMAGE" &&
    input.assignmentDomain === "ALGEBRA" &&
    /=/u.test(input.correctAnswer);
  const finalStepIsImplausible =
    finalMathStep !== undefined &&
    (finalMathStep.stepKind === "UNPARSEABLE" ||
      (equationAnswerExpected &&
        !containsEquationOrAnswerMarker(finalMathStep.step) &&
        !isPlausibleScalarAnswer(finalMathStep.step)));

  if (finalStepIsImplausible) {
    policyReasons.add("IMPLAUSIBLE_TRANSCRIPTION_STEP");
    transcriptionConfidence = Math.min(
      transcriptionConfidence,
      LOW_CONFIDENCE_REVIEW_THRESHOLD - 0.01,
    );
  }

  const confidence = Math.min(
    parsed.confidence,
    parsed.reasoningConfidence,
    transcriptionConfidence,
  );

  let studentAnswer = normalizeNullableText(parsed.studentAnswer);
  if (
    studentAnswer !== null &&
    !transcription.includes(studentAnswer)
  ) {
    policyReasons.add("UNGROUNDED_EVIDENCE");
    studentAnswer = null;
  }

  const evidenceQuote = normalizeGroundedQuote(
    parsed.evidenceQuote,
    transcription,
    policyReasons,
  );

  let observedTransformation = null;
  if (parsed.observedTransformation !== null) {
    const transformation = parsed.observedTransformation;
    const sourceStepPosition =
      normalizedStepPositionByReportedPosition.get(
        transformation.sourceStepPosition,
      ) ?? null;
    const inputExpression = transformation.inputExpression.trim();
    const observedOutput = transformation.observedOutput.trim();

    const sourceStep =
      sourceStepPosition === null ? null : steps[sourceStepPosition - 1];
    const inputIsDistinctFromOutput =
      canonicalizeObservedMath(inputExpression) !==
      canonicalizeObservedMath(observedOutput);
    const outputIsInSourceStep =
      sourceStep !== null && sourceStep.step.includes(observedOutput);
    const inputIsInSourceStep =
      sourceStep !== null && sourceStep.step.includes(inputExpression);
    const sourceStepSpan =
      sourceStepPosition === null
        ? null
        : groundedStepSpans.get(sourceStepPosition) ?? null;
    const inputIsInEarlierGroundedStep = steps.some((step) => {
      if (
        sourceStepPosition === null ||
        sourceStepSpan === null ||
        step.position >= sourceStepPosition ||
        !step.step.includes(inputExpression)
      ) {
        return false;
      }

      const earlierSpan = groundedStepSpans.get(step.position);
      if (!earlierSpan || earlierSpan.end > sourceStepSpan.start) return false;

      // Distinct steps need an observable line/statement boundary. This stops a
      // model from splitting the substrings of one bare final equation into a
      // fabricated input step and output step.
      const separator = transcription.slice(earlierSpan.end, sourceStepSpan.start);
      return /(?:[\r\n;]|→|⇒|↦|->|=>)/u.test(separator);
    });
    const hasObservableTransition =
      sourceStep !== null &&
      ((inputIsInSourceStep &&
        outputIsInSourceStep &&
        isSubstantiveMathExpression(inputExpression) &&
        containsTransformationMarker(sourceStep.step)) ||
        (inputIsInEarlierGroundedStep && outputIsInSourceStep));

    if (
      sourceStepPosition === null ||
      !groundedStepPositions.has(sourceStepPosition) ||
      !transcription.includes(inputExpression) ||
      !transcription.includes(observedOutput) ||
      !inputIsDistinctFromOutput ||
      !hasObservableTransition
    ) {
      policyReasons.add(
        inputIsDistinctFromOutput ? "UNGROUNDED_EVIDENCE" : "INCONSISTENT_OUTPUT",
      );
    } else {
      observedTransformation = {
        inputExpression,
        observedOutput,
        transformationDescription:
          transformation.transformationDescription.trim(),
        sourceStepPosition,
      };
    }
  }

  /** @type {Array<{
   *   rank: number;
   *   misconceptionId: MisconceptionId;
   *   confidence: number;
   *   evidenceQuote: string | null;
   * }>} */
  const normalizedCandidates = [];
  for (const candidate of [...parsed.candidates].sort(
    (left, right) =>
      left.rank - right.rank ||
      right.confidence - left.confidence ||
      left.misconceptionId.localeCompare(right.misconceptionId),
  )) {
    if (!inTaxonomyScope) continue;
    if (
      !matchesAssignmentDomain(candidate.misconceptionId, input.assignmentDomain)
    ) {
      policyReasons.add("DOMAIN_MISMATCH");
      continue;
    }

    const normalizedCandidate = {
      rank: candidate.rank,
      misconceptionId: candidate.misconceptionId,
      confidence: candidate.confidence,
      evidenceQuote: normalizeGroundedQuote(
        candidate.evidenceQuote,
        transcription,
        policyReasons,
      ),
    };
    const existingIndex = normalizedCandidates.findIndex(
      (existing) =>
        existing.misconceptionId === normalizedCandidate.misconceptionId,
    );

    if (existingIndex === -1) {
      normalizedCandidates.push(normalizedCandidate);
      continue;
    }

    // Candidate ordering is supporting metadata, not diagnostic evidence.
    // Collapse redundant copies deterministically instead of escalating an
    // otherwise well-grounded classification into an uncertainty flag.
    if (
      normalizedCandidate.confidence >
      normalizedCandidates[existingIndex].confidence
    ) {
      normalizedCandidates[existingIndex] = normalizedCandidate;
    }
  }

  if (
    inTaxonomyScope &&
    parsed.misconceptionId !== null &&
    !matchesAssignmentDomain(parsed.misconceptionId, input.assignmentDomain)
  ) {
    policyReasons.add("DOMAIN_MISMATCH");
  }

  if (requestedOutcome === "CORRECT") {
    if (
      parsed.misconceptionId !== null ||
      parsed.severity !== 0 ||
      modelReasons.size > 0 ||
      normalizedCandidates.length > 0 ||
      steps.some((step) => step.correctness !== "CORRECT")
    ) {
      policyReasons.add("INCONSISTENT_OUTPUT");
    }
  } else if (requestedOutcome === "MISCONCEPTION") {
    if (
      parsed.misconceptionId === null ||
      parsed.severity === 0 ||
      modelReasons.size > 0
    ) {
      policyReasons.add("INCONSISTENT_OUTPUT");
    }
    if (evidenceQuote === null) {
      policyReasons.add("MISSING_EVIDENCE");
    }

    const groundedIncorrectSteps = steps.filter(
      (step) =>
        step.correctness === "INCORRECT" && step.evidenceQuote !== null,
    );
    if (
      observedTransformation === null ||
      groundedIncorrectSteps.length === 0 ||
      !groundedIncorrectSteps.some(
        (step) =>
          step.position === observedTransformation.sourceStepPosition,
      )
    ) {
      // A wrong final answer can identify correctness, but not the flawed rule
      // that produced it. Definitive misconception labels require an observable
      // input→output transformation tied to a grounded invalid step.
      policyReasons.add("INSUFFICIENT_WORK_SHOWN");
    }

    if (
      parsed.misconceptionId !== null &&
      matchesAssignmentDomain(parsed.misconceptionId, input.assignmentDomain) &&
      !normalizedCandidates.some(
        (candidate) =>
          candidate.misconceptionId === parsed.misconceptionId,
      )
    ) {
      // The primary, evidence-grounded classification is authoritative. Some
      // valid model outputs omit it from the redundant candidate ranking; add
      // it deterministically without treating that omission as ambiguity.
      normalizedCandidates.push({
        rank: normalizedCandidates.length + 1,
        misconceptionId: parsed.misconceptionId,
        confidence: parsed.confidence,
        evidenceQuote,
      });
    }
  } else if (requestedOutcome === "INCORRECT") {
    if (
      steps.every((step) => step.correctness !== "INCORRECT") ||
      modelReasons.size > 0
    ) {
      policyReasons.add("INCONSISTENT_OUTPUT");
    }
  } else if (inTaxonomyScope && parsed.misconceptionId !== null) {
    policyReasons.add("INCONSISTENT_OUTPUT");
  }

  if (
    requestedOutcome === "MULTIPLE_PLAUSIBLE" &&
    normalizedCandidates.length < 2
  ) {
    policyReasons.add("INCONSISTENT_OUTPUT");
  }

  if (
    ["CORRECT", "INCORRECT", "MISCONCEPTION"].includes(requestedOutcome) &&
    parsed.confidence < LOW_CONFIDENCE_REVIEW_THRESHOLD
  ) {
    policyReasons.add("LOW_CONFIDENCE");
  }

  if (
    ["CORRECT", "INCORRECT", "MISCONCEPTION"].includes(requestedOutcome) &&
    parsed.reasoningConfidence < LOW_CONFIDENCE_REVIEW_THRESHOLD
  ) {
    policyReasons.add("LOW_REASONING_CONFIDENCE");
  }

  if (input.inputKind === "IMAGE") {
    if (imageQuality === "POOR") {
      policyReasons.add("POOR_IMAGE_QUALITY");
    } else if (imageQuality === "NOT_APPLICABLE") {
      policyReasons.add("IMAGE_QUALITY_NOT_ASSESSED");
    }

    if (
      transcriptionConfidence < LOW_CONFIDENCE_REVIEW_THRESHOLD &&
      !policyReasons.has("IMPLAUSIBLE_TRANSCRIPTION_STEP")
    ) {
      policyReasons.add("LOW_TRANSCRIPTION_CONFIDENCE");
    }

    if (
      transcription.trim().length < 2 ||
      /^\[?(?:unreadable|illegible|no legible work)\]?\.?$/i.test(
        transcription.trim(),
      )
    ) {
      policyReasons.add("UNREADABLE_TRANSCRIPTION");
    }
  }

  const requiresEvidenceAbstention =
    policyReasons.has("POOR_IMAGE_QUALITY") ||
    policyReasons.has("LOW_TRANSCRIPTION_CONFIDENCE") ||
    policyReasons.has("UNREADABLE_TRANSCRIPTION");
  const requiresTeacherReview = [...policyReasons].some(
    (reason) =>
      reason !== "POOR_IMAGE_QUALITY" &&
      reason !== "LOW_TRANSCRIPTION_CONFIDENCE" &&
      reason !== "UNREADABLE_TRANSCRIPTION",
  );

  let outcome = requestedOutcome;
  if (requiresEvidenceAbstention) {
    outcome = "INSUFFICIENT_EVIDENCE";
  } else if (requiresTeacherReview) {
    outcome = "NEEDS_REVIEW";
  }

  if (
    outcome === "MULTIPLE_PLAUSIBLE" &&
    !modelReasons.has("MULTIPLE_PLAUSIBLE_RULES")
  ) {
    modelReasons.add("MULTIPLE_PLAUSIBLE_RULES");
  }

  if (
    outcome !== "CORRECT" &&
    outcome !== "INCORRECT" &&
    outcome !== "MISCONCEPTION" &&
    modelReasons.size === 0 &&
    policyReasons.size === 0
  ) {
    modelReasons.add("MODEL_REQUESTED_REVIEW");
  }

  const reviewReasons =
    outcome === "CORRECT" || outcome === "INCORRECT" || outcome === "MISCONCEPTION"
      ? []
      : [...new Set([...modelReasons, ...policyReasons])]
          .filter((reason) => REVIEW_REASON_CODE_SET.has(reason))
          .sort();
  const misconceptionId =
    outcome === "MISCONCEPTION" ? parsed.misconceptionId : null;
  const severity = outcome === "CORRECT" ? 0 : parsed.severity;

  normalizedCandidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.rank - right.rank ||
      left.misconceptionId.localeCompare(right.misconceptionId),
  );

  return {
    coreDiagnosis: {
      outcome,
      misconceptionId,
      confidence,
      severity,
      transcription,
      steps,
      transcriptionConfidence,
      reasoningConfidence: parsed.reasoningConfidence,
      evidenceQuote,
      reviewReason:
        reviewReasons.length > 0 ? reviewReasons.join(", ") : null,
    },
    observedPrompt: input.observedPrompt,
    studentAnswer,
    // Only grounded student text is canonicalized. The model also sees the
    // answer key, so its normalization field cannot be an evidence boundary.
    normalizedAnswer:
      studentAnswer === null ? null : canonicalizeMathAnswer(studentAnswer),
    imageQuality,
    observedTransformation:
      inTaxonomyScope && outcome === "MISCONCEPTION"
        ? observedTransformation
        : null,
    strategyVariant:
      inTaxonomyScope ? normalizeNullableText(parsed.strategyVariant) : null,
    reviewReasons,
    candidates: (inTaxonomyScope ? normalizedCandidates : []).map((candidate, index) => ({
      rank: index + 1,
      misconceptionId: candidate.misconceptionId,
      confidence: candidate.confidence,
      evidenceNote:
        candidate.evidenceQuote ?? "No grounded evidence quote supplied.",
    })),
  };
}
