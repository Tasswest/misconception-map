import "server-only";

import { misconceptionIdSchema } from "@/domain/misconception-taxonomy.mjs";
import {
  generatePracticeWorksheet,
  generateTeachingBrief,
  synthesizeStudentModel,
} from "@/server/openai/generate-instructional-support";
import {
  findReusableStudentModel,
  getLargestClusterContext,
  getPracticeDiagnosisContext,
  persistPracticeWorksheet,
  persistStudentModel,
  persistTeachingBrief,
} from "@/server/repositories/instructional-support";

export async function generatePracticeForStudent(input: {
  assignmentId: string;
  membershipId: string;
  misconceptionId: string;
}) {
  const misconceptionId = misconceptionIdSchema.parse(input.misconceptionId);
  const context = getPracticeDiagnosisContext({ ...input, misconceptionId });
  let model = findReusableStudentModel(context.row);

  if (!model) {
    const modelRun = await synthesizeStudentModel({
      domain: context.row.domain,
      misconceptionId,
      misconceptionLabel: context.taxonomy.label,
      misconceptionDefinition: context.taxonomy.definition,
      problemPrompt: context.row.problem_prompt,
      correctAnswer: context.row.correct_answer,
      transcription: context.row.transcription,
      observedTransformation: context.row.observed_transformation,
      evidenceQuote: context.row.evidence_quote,
    });
    model = persistStudentModel({ context: context.row, run: modelRun });
  }

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
