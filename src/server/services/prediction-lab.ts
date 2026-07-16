import "server-only";

import { canonicalizeMathAnswer } from "@/domain/math-normalization.mjs";
import {
  generateModelRevisionSuggestion,
  generateStudentPrediction,
} from "@/server/openai/generate-instructional-support";
import { InstructionalGenerationError } from "@/server/openai/generate-instructional-support";
import {
  getPredictionContext,
  getPredictionModelScope,
  fallbackConsistencyRevision,
  listUnsuggestedPredictionMismatches,
  persistLockedPrediction,
  persistRevisionSuggestion,
  PredictionRepositoryError,
  synchronizePredictionOutcomesForClass,
} from "@/server/repositories/prediction-lab";
import { containsRosterName } from "@/server/privacy/roster-text";
import { createDiagnosticAssignment } from "@/server/repositories/workspace";
import { prepareStudentModel } from "@/server/services/instructional-support";

export async function preparePredictionStudentModel(input: {
  classId: string;
  assignmentId: string;
  membershipId: string;
  misconceptionId: string;
}) {
  const prepared = await prepareStudentModel(input);
  if (prepared.context.row.class_id !== input.classId) {
    throw new Error("The diagnosis and Prediction Lab class did not match.");
  }
  return prepared.model;
}

export async function lockStudentPrediction(input: {
  modelVersionId: string;
  targetAssignmentItemId: string;
}) {
  const context = getPredictionContext(input);
  const run = await generateStudentPrediction({
    domain: context.domain,
    misconceptionId: context.misconceptionId,
    misconceptionLabel: context.misconceptionLabel,
    ruleStatement: context.ruleStatement,
    formalPattern: context.formalPattern,
    scopeLimits: context.scopeLimits,
    problemPrompt: context.problemPrompt,
    correctAnswer: context.correctAnswer,
    answerFormat: context.answerFormat,
    observedApplicationCount: context.observedApplicationCount,
    observedOpportunityCount: context.observedOpportunityCount,
    observedApplicationRate: context.observedApplicationRate,
    masteryEvidence: context.masteryEvidence,
  });
  const canonicalPrediction = run.result.predictedAnswer
    ? canonicalizeMathAnswer(run.result.predictedAnswer)
    : null;
  const canonicalCorrect =
    context.canonicalCorrectAnswer ??
    canonicalizeMathAnswer(context.correctAnswer);
  if (
    (run.result.predictionKind === "MASTERY" &&
      canonicalPrediction !== canonicalCorrect) ||
    (run.result.predictionKind === "FLAWED_RULE_APPLIES" &&
      canonicalPrediction === canonicalCorrect) ||
    (run.result.predictionKind === "FLAWED_RULE_APPLIES" &&
      context.observedApplicationRate !== null &&
      Math.abs(run.result.confidence - context.observedApplicationRate) > 0.001)
  ) {
    throw new InstructionalGenerationError(
      "OPENAI_OUTPUT_INVALID",
      "prediction",
    );
  }
  return persistLockedPrediction({ context, run });
}

export function createHeldOutPredictionProbe(input: {
  classId: string;
  modelVersionId: string;
  title: string;
  problemPrompt: string;
  correctAnswer: string;
  answerFormat:
    | "EXPRESSION"
    | "NUMBER"
    | "FRACTION"
    | "MULTIPLE_CHOICE"
    | "SHORT_TEXT";
}) {
  const model = getPredictionModelScope(input);
  if (containsRosterName(model.class_id, [input.problemPrompt])) {
    throw new PredictionRepositoryError(
      "PERSONAL_DATA_DETECTED",
      "Remove roster names from the held-out problem before creating it.",
    );
  }
  return createDiagnosticAssignment({
    classId: model.class_id,
    title: input.title,
    description:
      "Held-out Prediction Lab probe. Lock predictions before collecting student work.",
    domain: model.domain,
    problemPrompt: input.problemPrompt,
    correctAnswer: input.correctAnswer,
    answerFormat: input.answerFormat,
  });
}

export async function synchronizePredictionOutcomes(classId: string) {
  const outcomes = synchronizePredictionOutcomesForClass(classId);
  const mismatches = listUnsuggestedPredictionMismatches(classId);
  let suggestionsCreated = 0;
  let fallbackSuggestions = 0;
  for (const context of mismatches) {
    try {
      const run = await generateModelRevisionSuggestion({
        domain: context.domain,
        misconceptionId: context.misconceptionId,
        misconceptionLabel: context.misconceptionLabel,
        priorRuleStatement: context.ruleStatement,
        priorFormalPattern: context.formalPattern,
        priorScopeLimits: context.scopeLimits,
        observedApplicationCount: context.observedApplicationCount,
        observedOpportunityCount: context.observedOpportunityCount,
        observedApplicationRate: context.observedApplicationRate,
        predictionKind: context.predictionKind,
        problemPrompt: context.problemPrompt,
        predictedAnswer: context.predictedAnswer,
        actualAnswer: context.actualAnswer,
        correctAnswer: context.correctAnswer,
        diagnosisOutcome: context.diagnosisOutcome,
        observedTransformation: context.observedTransformation,
        evidenceQuote: context.evidenceQuote,
      });
      if (
        run.result.suggestionKind === "DOWNGRADE_CONSISTENCY" &&
        Math.abs(
          (run.result.proposedApplicationRate ?? -1) -
            (context.observedApplicationCount ?? 0) /
              ((context.observedOpportunityCount ?? 0) + 1),
        ) > 0.001
      ) {
        throw new InstructionalGenerationError(
          "OPENAI_OUTPUT_INVALID",
          "student model",
        );
      }
      persistRevisionSuggestion({ context, result: run.result, run });
    } catch (error) {
      if (!(error instanceof InstructionalGenerationError)) throw error;
      persistRevisionSuggestion({
        context,
        result: fallbackConsistencyRevision(context),
        run: null,
      });
      fallbackSuggestions += 1;
    }
    suggestionsCreated += 1;
  }
  return { ...outcomes, suggestionsCreated, fallbackSuggestions };
}
