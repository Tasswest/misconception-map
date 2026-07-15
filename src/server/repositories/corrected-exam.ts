import "server-only";

import { z } from "zod";

import { MISCONCEPTION_BY_ID, misconceptionIdSchema } from "@/domain/misconception-taxonomy.mjs";
import { getDatabase } from "@/lib/db";

const idSchema = z.string().uuid();

type CorrectedDiagnosisRow = {
  diagnosis_id: string;
  assignment_item_id: string;
  outcome: "CORRECT" | "MISCONCEPTION" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE" | "MULTIPLE_PLAUSIBLE";
  misconception_id: string | null;
  confidence: number;
  transcription: string;
  evidence_quote: string | null;
  review_reasons_json: string;
  created_at: string;
};

export function getCorrectedExam(assignmentId: string, membershipId: string) {
  if (!idSchema.safeParse(assignmentId).success || !idSchema.safeParse(membershipId).success) {
    return null;
  }
  const database = getDatabase();
  const header = database
    .prepare(
      [
        "SELECT assignment.id AS assignment_id, assignment.title AS assignment_title,",
        "class.id AS class_id, class.name AS class_name, membership.id AS membership_id, student.display_name AS student_name",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "JOIN class_memberships AS membership ON membership.id = ? AND membership.class_id = class.id AND membership.archived_at IS NULL",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "WHERE assignment.id = ? AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
      ].join(" "),
    )
    .get(membershipId, assignmentId) as
    | {
        assignment_id: string;
        assignment_title: string;
        class_id: string;
        class_name: string;
        membership_id: string;
        student_name: string;
      }
    | undefined;
  if (!header) return null;

  const items = database
    .prepare(
      [
        "SELECT item.id AS assignment_item_id, item.position, problem.prompt, problem.correct_answer",
        "FROM assignment_items AS item",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "WHERE item.assignment_id = ? AND item.class_id = ? ORDER BY item.position",
      ].join(" "),
    )
    .all(assignmentId, header.class_id) as Array<{
    assignment_item_id: string;
    position: number;
    prompt: string;
    correct_answer: string;
  }>;

  const diagnosisRows = database
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, answer.assignment_item_id, diagnosis.outcome, diagnosis.misconception_id,",
        "diagnosis.confidence, diagnosis.transcription, diagnosis.evidence_quote, diagnosis.review_reasons_json, diagnosis.created_at",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE submission.assignment_id = ? AND submission.class_id = ? AND submission.membership_id = ?",
        "AND answer.assignment_item_id IS NOT NULL",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "WHERE latest_version.submission_answer_id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "ORDER BY diagnosis.created_at DESC, diagnosis.id DESC",
      ].join(" "),
    )
    .all(assignmentId, header.class_id, membershipId) as CorrectedDiagnosisRow[];
  const latestByItem = new Map<string, CorrectedDiagnosisRow>();
  for (const row of diagnosisRows) {
    if (!latestByItem.has(row.assignment_item_id)) {
      latestByItem.set(row.assignment_item_id, row);
    }
  }
  const diagnosisIds = [...latestByItem.values()].map((row) => row.diagnosis_id);
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
    assignmentId: header.assignment_id,
    assignmentTitle: header.assignment_title,
    className: header.class_name,
    membershipId: header.membership_id,
    studentName: header.student_name,
    generatedAt: new Date().toISOString(),
    diagnosedProblemCount: latestByItem.size,
    totalProblemCount: items.length,
    items: items.map((item) => {
      const diagnosis = latestByItem.get(item.assignment_item_id) ?? null;
      const misconceptionId = diagnosis
        ? misconceptionIdSchema.safeParse(diagnosis.misconception_id)
        : null;
      const misconception = misconceptionId?.success
        ? MISCONCEPTION_BY_ID.get(misconceptionId.data) ?? null
        : null;
      return {
        assignmentItemId: item.assignment_item_id,
        position: item.position,
        problemPrompt: item.prompt,
        correctAnswer: item.correct_answer,
        diagnosis: diagnosis
          ? {
              id: diagnosis.diagnosis_id,
              outcome: diagnosis.outcome,
              confidence: diagnosis.confidence,
              transcription: diagnosis.transcription,
              evidenceQuote: diagnosis.evidence_quote,
              reviewReasons: JSON.parse(diagnosis.review_reasons_json) as string[],
              misconceptionLabel: misconception?.label ?? null,
              steps: (stepsByDiagnosis.get(diagnosis.diagnosis_id) ?? []).map(
                (step) => ({
                  position: step.position,
                  step: step.step_text,
                  correctness: step.correctness,
                  correctNote: step.correct_note,
                  errorNote: step.error_note,
                }),
              ),
            }
          : null,
      };
    }),
  };
}

export type CorrectedExam = NonNullable<ReturnType<typeof getCorrectedExam>>;
