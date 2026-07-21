import "server-only";

import { randomUUID } from "node:crypto";

import { exerciseQuestionReference } from "@/domain/exam-labels";
import {
  validateGradeProposalInputSchema,
  type ValidateGradeProposalInput,
} from "@/domain/grading-proposal";
import { getDatabase } from "@/lib/db";
import type {
  GradingProposalQuestion,
  GradingProposalRun,
} from "@/server/openai/propose-grade";
import { entityIdSchema } from "@/server/repositories/workspace";

export class GradingProposalRepositoryError extends Error {
  readonly code:
    | "COPY_NOT_READY"
    | "PROPOSAL_NOT_FOUND"
    | "PROPOSAL_ALREADY_VALIDATED"
    | "INVALID_FINAL_SCORE";
  readonly status: number;

  constructor(
    code: GradingProposalRepositoryError["code"],
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "GradingProposalRepositoryError";
    this.code = code;
    this.status = status;
  }
}

type ProposalItemRow = {
  assignment_item_id: string;
  position: number;
  question_reference: string;
  max_points: number;
  proposed_score: number | null;
  final_score: number | null;
  credit_basis:
    | "FULL_CORRECT_REASONING"
    | "PARTIAL_CORRECT_PREFIX"
    | "ZERO_NO_CREDITABLE_WORK"
    | "MANUAL_REQUIRED";
  evidence_quote: string | null;
  justification: string | null;
  manual_reason: "NEEDS_REVIEW" | "ABSTAINED" | "CANNOT_CORRECT" | null;
  validated_at: string | null;
};

type ProposalRow = {
  id: string;
  assignment_id: string;
  membership_id: string;
  version: number;
  status: "PROPOSED" | "VALIDATED";
  proposed_total: number;
  max_score: number;
  incomplete: 0 | 1;
  manual_item_count: number;
  created_at: string;
  validated_at: string | null;
};

export type GradeProposal = {
  id: string;
  assignmentId: string;
  membershipId: string;
  version: number;
  status: "PROPOSED" | "VALIDATED";
  proposedTotal: number;
  finalTotal: number | null;
  maxScore: number;
  incomplete: boolean;
  manualItemCount: number;
  createdAt: string;
  validatedAt: string | null;
  items: Array<{
    assignmentItemId: string;
    position: number;
    questionReference: string;
    maxPoints: number;
    proposedScore: number | null;
    finalScore: number | null;
    creditBasis: ProposalItemRow["credit_basis"];
    evidenceQuote: string | null;
    justification: string | null;
    manualReason: ProposalItemRow["manual_reason"];
    validatedAt: string | null;
  }>;
};

function mapProposal(row: ProposalRow, items: ProposalItemRow[]): GradeProposal {
  const mappedItems = items.map((item) => ({
    assignmentItemId: item.assignment_item_id,
    position: item.position,
    questionReference: item.question_reference,
    maxPoints: item.max_points,
    proposedScore: item.proposed_score,
    finalScore: item.final_score,
    creditBasis: item.credit_basis,
    evidenceQuote: item.evidence_quote,
    justification: item.justification,
    manualReason: item.manual_reason,
    validatedAt: item.validated_at,
  }));
  const finalTotal = mappedItems.every((item) => item.finalScore !== null)
    ? mappedItems.reduce((sum, item) => sum + (item.finalScore ?? 0), 0)
    : null;
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    membershipId: row.membership_id,
    version: row.version,
    status: row.status,
    proposedTotal: row.proposed_total,
    finalTotal,
    maxScore: row.max_score,
    incomplete: row.incomplete === 1,
    manualItemCount: row.manual_item_count,
    createdAt: row.created_at,
    validatedAt: row.validated_at,
    items: mappedItems,
  };
}

export function getGradeProposal(
  assignmentIdInput: string,
  membershipIdInput: string,
): GradeProposal | null {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
  const membershipId = entityIdSchema.parse(membershipIdInput);
  const database = getDatabase();
  const row = database
    .prepare(
      [
        "SELECT id, assignment_id, membership_id, version, status, proposed_total, max_score,",
        "incomplete, manual_item_count, created_at, validated_at",
        "FROM exam_grade_proposals WHERE assignment_id = ? AND membership_id = ?",
        "ORDER BY version DESC LIMIT 1",
      ].join(" "),
    )
    .get(assignmentId, membershipId) as ProposalRow | undefined;
  if (!row) return null;
  const items = database
    .prepare(
      [
        "SELECT assignment_item_id, position, question_reference, max_points, proposed_score, final_score,",
        "credit_basis, evidence_quote, justification, manual_reason, validated_at",
        "FROM exam_grade_proposal_items WHERE proposal_id = ? ORDER BY position",
      ].join(" "),
    )
    .all(row.id) as ProposalItemRow[];
  return mapProposal(row, items);
}

export function getGradingProposalContext(
  assignmentIdInput: string,
  membershipIdInput: string,
): { classId: string; questions: GradingProposalQuestion[] } {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
  const membershipId = entityIdSchema.parse(membershipIdInput);
  const database = getDatabase();
  const header = database
    .prepare(
      [
        "SELECT assignment.class_id",
        "FROM assignments AS assignment",
        "JOIN class_memberships AS membership ON membership.id = ?",
        "AND membership.class_id = assignment.class_id AND membership.archived_at IS NULL",
        "WHERE assignment.id = ? AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
      ].join(" "),
    )
    .get(membershipId, assignmentId) as { class_id: string } | undefined;
  if (!header) {
    throw new GradingProposalRepositoryError(
      "COPY_NOT_READY",
      "That corrected copy is no longer available.",
      404,
    );
  }

  const itemRows = database
    .prepare(
      [
        "SELECT item.id AS assignment_item_id, item.position, item.points, item.question_label,",
        "problem.prompt, problem.correct_answer, exercise.exercise_label",
        "FROM assignment_items AS item",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id AND exercise.assignment_id = item.assignment_id",
        "WHERE item.assignment_id = ? AND item.class_id = ?",
        "ORDER BY exercise.position, item.position",
      ].join(" "),
    )
    .all(assignmentId, header.class_id) as Array<{
    assignment_item_id: string;
    position: number;
    points: number;
    question_label: string;
    prompt: string;
    correct_answer: string;
    exercise_label: string;
  }>;

  const diagnosisRows = database
    .prepare(
      [
        "SELECT diagnosis.id, answer.assignment_item_id,",
        "COALESCE(diagnosis.correction_verdict, diagnosis.outcome) AS outcome,",
        "diagnosis.transcription, diagnosis.evidence_quote",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE submission.assignment_id = ? AND submission.class_id = ? AND submission.membership_id = ?",
        "AND answer.assignment_item_id IS NOT NULL",
        "AND diagnosis.id = (SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "WHERE latest_version.submission_answer_id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1)",
        "ORDER BY diagnosis.created_at DESC, diagnosis.version DESC, diagnosis.id DESC",
      ].join(" "),
    )
    .all(assignmentId, header.class_id, membershipId) as Array<{
    id: string;
    assignment_item_id: string;
    outcome: NonNullable<GradingProposalQuestion["diagnosis"]>["outcome"];
    transcription: string;
    evidence_quote: string | null;
  }>;
  const diagnosisByItem = new Map<string, (typeof diagnosisRows)[number]>();
  for (const diagnosis of diagnosisRows) {
    if (!diagnosisByItem.has(diagnosis.assignment_item_id)) {
      diagnosisByItem.set(diagnosis.assignment_item_id, diagnosis);
    }
  }
  const diagnosisIds = diagnosisRows.map((diagnosis) => diagnosis.id);
  const stepRows = diagnosisIds.length
    ? (database
        .prepare(
          [
            "SELECT diagnosis_id, position, step_text, correctness, correct_note, error_note",
            `FROM diagnosis_steps WHERE diagnosis_id IN (${diagnosisIds.map(() => "?").join(",")})`,
            "ORDER BY diagnosis_id, position",
          ].join(" "),
        )
        .all(...diagnosisIds) as Array<{
        diagnosis_id: string;
        position: number;
        step_text: string;
        correctness: "CORRECT" | "INCORRECT" | "UNCLEAR";
        correct_note: string | null;
        error_note: string | null;
      }>)
    : [];
  const stepsByDiagnosis = new Map<string, typeof stepRows>();
  for (const step of stepRows) {
    const steps = stepsByDiagnosis.get(step.diagnosis_id) ?? [];
    steps.push(step);
    stepsByDiagnosis.set(step.diagnosis_id, steps);
  }

  return {
    classId: header.class_id,
    questions: itemRows.map((item) => {
      const diagnosis = diagnosisByItem.get(item.assignment_item_id) ?? null;
      return {
        assignmentItemId: item.assignment_item_id,
        diagnosisId: diagnosis?.id ?? null,
        position: item.position,
        questionReference: exerciseQuestionReference(
          item.exercise_label,
          item.question_label,
        ),
        problemPrompt: item.prompt,
        correctAnswer: item.correct_answer,
        maxPoints: item.points,
        diagnosis: diagnosis
          ? {
              id: diagnosis.id,
              outcome: diagnosis.outcome,
              transcription: diagnosis.transcription,
              evidenceQuote: diagnosis.evidence_quote,
              steps: (stepsByDiagnosis.get(diagnosis.id) ?? []).map((step) => ({
                position: step.position,
                step: step.step_text,
                correctness: step.correctness,
                correctNote: step.correct_note,
                errorNote: step.error_note,
              })),
            }
          : null,
      };
    }),
  };
}

export function saveGradeProposal(
  assignmentIdInput: string,
  membershipIdInput: string,
  classIdInput: string,
  run: GradingProposalRun,
): GradeProposal {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
  const membershipId = entityIdSchema.parse(membershipIdInput);
  const classId = entityIdSchema.parse(classIdInput);
  const existing = getGradeProposal(assignmentId, membershipId);
  if (existing) return existing;
  const database = getDatabase();
  const proposalId = randomUUID();
  const proposedTotal = run.result.items.reduce(
    (sum, item) => sum + (item.proposedScore ?? 0),
    0,
  );
  const maxScore = run.result.items.reduce(
    (sum, item) => sum + item.maxPoints,
    0,
  );
  const manualItemCount = run.result.items.filter(
    (item) => item.proposedScore === null,
  ).length;

  database.transaction(() => {
    const version = database
      .prepare(
        "SELECT COALESCE(max(version), 0) + 1 FROM exam_grade_proposals WHERE assignment_id = ? AND membership_id = ?",
      )
      .pluck()
      .get(assignmentId, membershipId) as number;
    database
      .prepare(
        [
          "INSERT INTO exam_grade_proposals",
          "(id, class_id, assignment_id, membership_id, version, status, model_name, prompt_version, schema_version,",
          "openai_response_id, input_hash, output_hash, proposed_total, max_score, incomplete, manual_item_count,",
          "input_tokens, output_tokens, latency_ms)",
          "VALUES (?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        proposalId,
        classId,
        assignmentId,
        membershipId,
        version,
        run.modelName,
        run.promptVersion,
        run.schemaVersion,
        run.responseId,
        run.inputHash,
        run.outputHash,
        proposedTotal,
        maxScore,
        manualItemCount > 0 ? 1 : 0,
        manualItemCount,
        run.inputTokens,
        run.outputTokens,
        run.latencyMs,
      );
    const insertItem = database.prepare(
      [
        "INSERT INTO exam_grade_proposal_items",
        "(id, proposal_id, assignment_item_id, diagnosis_id, position, question_reference, max_points,",
        "proposed_score, credit_basis, evidence_quote, justification, manual_reason)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    for (const item of run.result.items) {
      insertItem.run(
        randomUUID(),
        proposalId,
        item.assignmentItemId,
        item.diagnosisId,
        item.position,
        item.questionReference,
        item.maxPoints,
        item.proposedScore,
        item.creditBasis,
        item.evidenceQuote,
        item.justification,
        item.manualReason,
      );
    }
  })();

  const proposal = getGradeProposal(assignmentId, membershipId);
  if (!proposal) throw new Error("The grading proposal was not persisted.");
  return proposal;
}

export function validateGradeProposal(
  assignmentIdInput: string,
  membershipIdInput: string,
  input: ValidateGradeProposalInput,
): GradeProposal {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
  const membershipId = entityIdSchema.parse(membershipIdInput);
  const parsed = validateGradeProposalInputSchema.parse(input);
  const database = getDatabase();
  const proposal = getGradeProposal(assignmentId, membershipId);
  if (!proposal || proposal.id !== parsed.proposalId) {
    throw new GradingProposalRepositoryError(
      "PROPOSAL_NOT_FOUND",
      "That grade proposal is no longer available.",
      404,
    );
  }
  if (proposal.status !== "PROPOSED") {
    throw new GradingProposalRepositoryError(
      "PROPOSAL_ALREADY_VALIDATED",
      "This grade was already validated.",
      409,
    );
  }
  const finalScoreByItem = new Map(
    parsed.items.map((item) => [item.assignmentItemId, item.finalScore]),
  );
  if (
    finalScoreByItem.size !== proposal.items.length ||
    parsed.items.length !== proposal.items.length ||
    proposal.items.some((item) => !finalScoreByItem.has(item.assignmentItemId))
  ) {
    throw new GradingProposalRepositoryError(
      "INVALID_FINAL_SCORE",
      "Every question needs a teacher score before validation.",
      400,
    );
  }
  const finalItems = proposal.items.map((item) => {
    const rawScore = finalScoreByItem.get(item.assignmentItemId);
    const finalScore = Math.round((rawScore ?? Number.NaN) * 100) / 100;
    if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > item.maxPoints) {
      throw new GradingProposalRepositoryError(
        "INVALID_FINAL_SCORE",
        `Enter a score from 0 to ${item.maxPoints} for ${item.questionReference}.`,
        400,
      );
    }
    return { ...item, finalScore };
  });
  const finalTotal = finalItems.reduce((sum, item) => sum + item.finalScore, 0);
  const now = new Date().toISOString();

  database.transaction(() => {
    const updateItem = database.prepare(
      "UPDATE exam_grade_proposal_items SET final_score = ?, validated_at = ? WHERE proposal_id = ? AND assignment_item_id = ?",
    );
    const insertAudit = database.prepare(
      [
        "INSERT INTO exam_grade_validation_audit",
        "(id, proposal_id, assignment_item_id, ai_proposed_score, teacher_final_score, max_points, validated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    for (const item of finalItems) {
      updateItem.run(item.finalScore, now, proposal.id, item.assignmentItemId);
      insertAudit.run(
        randomUUID(),
        proposal.id,
        item.assignmentItemId,
        item.proposedScore,
        item.finalScore,
        item.maxPoints,
        now,
      );
    }
    database
      .prepare(
        "UPDATE exam_grade_proposals SET status = 'VALIDATED', validated_at = ? WHERE id = ? AND status = 'PROPOSED'",
      )
      .run(now, proposal.id);
    database
      .prepare(
        [
          "INSERT INTO exam_grades",
          "(id, class_id, assignment_id, membership_id, score, max_score, graded_at, created_at, updated_at, validated_proposal_id)",
          "SELECT ?, class_id, assignment_id, membership_id, ?, ?, ?, ?, ?, id",
          "FROM exam_grade_proposals WHERE id = ? AND status = 'VALIDATED'",
          "ON CONFLICT (assignment_id, membership_id) DO UPDATE SET",
          "score = excluded.score, max_score = excluded.max_score, graded_at = excluded.graded_at,",
          "updated_at = excluded.updated_at, validated_proposal_id = excluded.validated_proposal_id",
        ].join(" "),
      )
      .run(randomUUID(), finalTotal, proposal.maxScore, now, now, now, proposal.id);
  })();

  const validated = getGradeProposal(assignmentId, membershipId);
  if (!validated) throw new Error("The validated grade could not be loaded.");
  return validated;
}
