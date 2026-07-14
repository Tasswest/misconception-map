import "server-only";

import { generateStudentPrediction } from "@/server/openai/generate-instructional-support";
import {
  getPredictionContext,
  getPredictionModelScope,
  persistLockedPrediction,
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
    answerFormat: context.answerFormat,
  });
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

export function synchronizePredictionOutcomes(classId: string) {
  return synchronizePredictionOutcomesForClass(classId);
}
