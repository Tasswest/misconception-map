import "server-only";

import { misconceptionIdSchema } from "@/domain/misconception-taxonomy.mjs";
import {
  followUpEvaluationInputHash,
  generateFollowUpEvaluation,
  generatePracticeWorksheet,
  generateTeachingBrief,
  InstructionalGenerationError,
  synthesizeStudentModel,
} from "@/server/openai/generate-instructional-support";
import {
  findFollowUpEvaluationIdByInputHash,
  getFollowUpGenerationContext,
  getPrintableFollowUpEvaluation,
  persistFollowUpEvaluation,
  type FollowUpGenerationContext,
} from "@/server/repositories/follow-up-evaluation";
import {
  findReusableStudentModel,
  getLargestClusterContext,
  getPracticeDiagnosisContext,
  persistPracticeWorksheet,
  getStudentModelRevisionContext,
  persistRevisedStudentModel,
  persistStudentModel,
  persistTeachingBrief,
  synchronizeStudentModelEvidence,
} from "@/server/repositories/instructional-support";

async function synthesizeModelForContext(
  context: ReturnType<typeof getPracticeDiagnosisContext>,
) {
  return synthesizeStudentModel({
    domain: context.row.domain,
    misconceptionId: context.row.misconception_id,
    misconceptionLabel: context.taxonomy.label,
    misconceptionDefinition: context.taxonomy.definition,
    problemPrompt: context.row.problem_prompt,
    correctAnswer: context.row.correct_answer,
    transcription: context.row.transcription,
    observedTransformation: context.row.observed_transformation,
    evidenceQuote: context.row.evidence_quote,
  });
}

export async function prepareStudentModel(input: {
  assignmentId: string;
  membershipId: string;
  misconceptionId: string;
}) {
  const misconceptionId = misconceptionIdSchema.parse(input.misconceptionId);
  const context = getPracticeDiagnosisContext({ ...input, misconceptionId });
  let model = findReusableStudentModel(context.row);

  if (!model) {
    const modelRun = await synthesizeModelForContext(context);
    model = persistStudentModel({ context: context.row, run: modelRun });
  } else {
    const revisionContext = getStudentModelRevisionContext({
      context: context.row,
      model,
    });
    if (revisionContext) {
      const modelRun = await synthesizeModelForContext(revisionContext);
      model = persistRevisedStudentModel({
        context: revisionContext.row,
        previous: model,
        run: modelRun,
      });
    }
  }

  model = synchronizeStudentModelEvidence({ context: context.row, model });
  return { context, model };
}

export async function generatePracticeForStudent(input: {
  assignmentId: string;
  membershipId: string;
  misconceptionId: string;
}) {
  const { context, model } = await prepareStudentModel(input);
  const misconceptionId = model.misconceptionId;

  const practiceRun = await generatePracticeWorksheet({
    domain: context.row.domain,
    misconceptionId,
    misconceptionLabel: context.taxonomy.label,
    misconceptionDefinition: context.taxonomy.definition,
    repairMove: context.taxonomy.repairMove,
    ruleStatement: model.ruleStatement,
    formalPattern: model.formalPattern,
    scopeLimits: model.scopeLimits,
  });

  const worksheet = persistPracticeWorksheet({
    context: context.row,
    model,
    run: practiceRun,
  });
  if (!worksheet) {
    throw new Error("The saved worksheet could not be reloaded.");
  }
  return worksheet;
}

type FollowUpQuestions = Awaited<
  ReturnType<typeof generateFollowUpEvaluation>
>["result"]["exercises"][number]["questions"];

function assertFollowUpCoverage(
  context: FollowUpGenerationContext,
  questions: FollowUpQuestions,
) {
  const invalid = () =>
    new InstructionalGenerationError(
      "OPENAI_OUTPUT_INVALID",
      "follow-up evaluation",
    );
  const suppliedIds = new Set<string>(
    context.payload.mistakes.misconceptions.map(
      (misconception) => misconception.misconceptionId,
    ),
  );
  const targetedIds = new Set<string>();
  for (const question of questions) {
    if (question.targetMisconceptionId !== null) {
      if (!suppliedIds.has(question.targetMisconceptionId)) throw invalid();
      targetedIds.add(question.targetMisconceptionId);
    }
  }
  for (const suppliedId of suppliedIds) {
    if (!targetedIds.has(suppliedId)) throw invalid();
  }
  if (
    context.payload.mistakes.slips.length > 0 &&
    !questions.some((question) => question.targetKind === "SLIP")
  ) {
    throw invalid();
  }
  if (
    context.payload.mistakes.uncertainItems.length > 0 &&
    !questions.some((question) => question.targetKind === "UNCERTAIN_RETEST")
  ) {
    throw invalid();
  }
}

export async function generateFollowUpEvaluationForAssignment(
  assignmentId: string,
) {
  const context = getFollowUpGenerationContext(assignmentId);
  const inputHash = followUpEvaluationInputHash(context.payload);
  const existingId = findFollowUpEvaluationIdByInputHash(
    context.assignment.id,
    inputHash,
  );
  if (existingId) {
    const existing = getPrintableFollowUpEvaluation(existingId);
    if (existing) return { evaluation: existing, reused: true };
  }
  const run = await generateFollowUpEvaluation(context.payload);
  assertFollowUpCoverage(
    context,
    run.result.exercises.flatMap((exercise) => exercise.questions),
  );
  const evaluationId = persistFollowUpEvaluation({ context, run });
  const evaluation = getPrintableFollowUpEvaluation(evaluationId);
  if (!evaluation) {
    throw new Error("The saved follow-up evaluation could not be reloaded.");
  }
  return { evaluation, reused: false };
}

export async function generateBriefForLargestCluster(assignmentId: string) {
  const context = getLargestClusterContext(assignmentId);
  const run = await generateTeachingBrief({
    domain: context.taxonomy.domain,
    misconceptionId: context.misconceptionId,
    misconceptionLabel: context.taxonomy.label,
    misconceptionDefinition: context.taxonomy.definition,
    diagnosticSignals: context.taxonomy.diagnosticSignals,
    repairMove: context.taxonomy.repairMove,
    clusterStudentCount: context.clusterStudentCount,
    diagnosedStudentCount: context.diagnosedStudentCount,
    evidenceQuotes: context.evidenceQuotes,
  });
  return persistTeachingBrief({ context, run });
}
