import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { normalizeProblemRegion } from "@/domain/problem-region.mjs";
import { exerciseQuestionReference } from "@/domain/exam-labels";
import { getDatabase } from "@/lib/db";

const entityIdSchema = z.string().trim().min(1).max(200);
const targetKeySchema = z
  .string()
  .regex(/^(diagnosis|submission):[0-9a-z-]{1,200}$/i);

export const markTriageItemReviewedInputSchema = z
  .object({
    targetKey: targetKeySchema,
    note: z.string().trim().max(2_000).nullable(),
  })
  .strict();

const OUT_OF_SCOPE_REASONS = new Set([
  "DOMAIN_MISMATCH",
  "NO_TAXONOMY_MATCH",
]);

type AssignmentRow = {
  id: string;
  title: string;
  class_id: string;
  class_name: string;
};

type LatestDiagnosisRow = {
  diagnosis_id: string;
  submission_id: string;
  membership_id: string;
  student_name: string;
  input_kind: "IMAGE" | "TYPED" | "DEMO";
  submission_status: "DIAGNOSED" | "NEEDS_REVIEW";
  assignment_item_id: string;
  item_position: number;
  exercise_label: string;
  question_label: string;
  problem_prompt: string;
  correct_answer: string;
  outcome:
    | "CORRECT"
    | "MISCONCEPTION"
    | "NEEDS_REVIEW"
    | "INSUFFICIENT_EVIDENCE"
    | "MULTIPLE_PLAUSIBLE";
  transcription: string;
  evidence_quote: string | null;
  review_reasons_json: string;
  segmentation_note: string | null;
  flagged_step_text: string | null;
  flagged_step_note: string | null;
  region_x: number | null;
  region_y: number | null;
  region_width: number | null;
  region_height: number | null;
  media_type: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null;
  reviewed_at: string | null;
  teacher_note: string | null;
};

type UnmatchedSubmissionRow = {
  submission_id: string;
  membership_id: string;
  student_name: string;
  input_kind: "IMAGE" | "TYPED" | "DEMO";
  sanitized_error_message: string | null;
  media_type: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null;
  reviewed_at: string | null;
  teacher_note: string | null;
};

type TriageItemRecord = {
  targetKey: string;
  diagnosisId: string | null;
  submissionId: string;
  membershipId: string;
  studentName: string;
  inputKind: "IMAGE" | "TYPED" | "DEMO";
  assignmentItemId: string | null;
  itemPosition: number | null;
  questionReference: string | null;
  problemPrompt: string | null;
  correctAnswer: string | null;
  transcription: string;
  flaggedEvidence: string | null;
  flaggedEvidenceNote: string | null;
  confirmedMistake: boolean;
  reasonCodes: string[];
  reasons: string[];
  outOfScope: boolean;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null;
  assetUrl: string | null;
  suggestedPage: number | null;
  region: { x: number; y: number; width: number; height: number } | null;
  reviewedAt: string | null;
  teacherNote: string | null;
};

export class TriageRepositoryError extends Error {
  readonly code: "ASSIGNMENT_NOT_FOUND" | "TRIAGE_ITEM_NOT_FOUND" | "ALREADY_REVIEWED";

  constructor(code: TriageRepositoryError["code"], message: string) {
    super(message);
    this.name = "TriageRepositoryError";
    this.code = code;
  }
}

function getAssignment(assignmentId: string) {
  const id = entityIdSchema.parse(assignmentId);
  return getDatabase()
    .prepare(
      [
        "SELECT assignment.id, assignment.title, assignment.class_id, class.name AS class_name",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "WHERE assignment.id = ? AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
      ].join(" "),
    )
    .get(id) as AssignmentRow | undefined;
}

function parseReasons(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((reason): reason is string => typeof reason === "string")
    : [];
}

function reviewReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    DOMAIN_MISMATCH: "The work is outside this assignment's math domain.",
    NO_TAXONOMY_MATCH: "The work is outside the supported diagnostic scope.",
    LOW_CONFIDENCE: "The diagnosis confidence is below the safe automatic threshold.",
    LOW_REASONING_CONFIDENCE: "The mathematical interpretation is uncertain.",
    LOW_TRANSCRIPTION_CONFIDENCE: "The handwriting transcription is uncertain.",
    POOR_IMAGE_QUALITY: "The page image is too unclear for a safe automatic decision.",
    UNREADABLE_TRANSCRIPTION: "The student work could not be read reliably.",
    IMPLAUSIBLE_TRANSCRIPTION_STEP: "A transcribed line does not form a plausible mathematical step.",
    INSUFFICIENT_WORK_SHOWN: "There is not enough visible work to support a diagnosis.",
    MULTIPLE_PLAUSIBLE_RULES: "More than one interpretation remains plausible.",
    MISSING_EVIDENCE: "The visible evidence does not support a safe decision.",
    UNGROUNDED_EVIDENCE: "The proposed diagnosis is not grounded in the visible work.",
    INCONSISTENT_OUTPUT: "The extracted evidence and diagnosis do not agree.",
    MODEL_REQUESTED_REVIEW: "The AI explicitly asked for teacher review.",
    IMAGE_QUALITY_NOT_ASSESSED: "Image quality could not be assessed.",
  };
  return labels[reason] ?? reason.replaceAll("_", " ").toLowerCase();
}

function inferFirstReferencedPage(...values: Array<string | null>) {
  for (const value of values) {
    if (!value) continue;
    const match = value.match(/\bpages?\s+(\d{1,3})\b/iu);
    if (!match) continue;
    const page = Number.parseInt(match[1], 10);
    if (page > 0 && page <= 500) return page;
  }
  return null;
}

export function getAssignmentTriage(assignmentId: string) {
  const assignment = getAssignment(assignmentId);
  if (!assignment) return null;
  const database = getDatabase();
  const diagnosisRows = database
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, submission.id AS submission_id, submission.membership_id,",
        "student.display_name AS student_name, submission.input_kind, submission.status AS submission_status,",
        "answer.assignment_item_id, item.position AS item_position, item.question_label, exercise.exercise_label, problem.prompt AS problem_prompt, problem.correct_answer,",
        "diagnosis.outcome, diagnosis.transcription, diagnosis.evidence_quote, diagnosis.review_reasons_json,",
        "submission.sanitized_error_message AS segmentation_note,",
        "(SELECT step.step_text FROM diagnosis_steps AS step WHERE step.diagnosis_id = diagnosis.id AND step.correctness = 'INCORRECT' ORDER BY step.position LIMIT 1) AS flagged_step_text,",
        "(SELECT step.error_note FROM diagnosis_steps AS step WHERE step.diagnosis_id = diagnosis.id AND step.correctness = 'INCORRECT' ORDER BY step.position LIMIT 1) AS flagged_step_note,",
        "answer.region_x, answer.region_y, answer.region_width, answer.region_height, asset.media_type,",
        "review.created_at AS reviewed_at, review.note AS teacher_note",
        "FROM submissions AS submission",
        "JOIN class_memberships AS membership ON membership.id = submission.membership_id AND membership.archived_at IS NULL",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "AND item.assignment_id = answer.assignment_id AND item.class_id = answer.class_id",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id AND exercise.assignment_id = item.assignment_id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "LEFT JOIN submission_assets AS asset ON asset.submission_id = submission.id",
        "AND asset.page_position = 1 AND asset.purged_at IS NULL",
        "LEFT JOIN teacher_item_reviews AS review ON review.diagnosis_id = diagnosis.id",
        "WHERE submission.assignment_id = ? AND submission.class_id = ?",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "WHERE latest_version.submission_answer_id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "ORDER BY student.display_name COLLATE NOCASE, item.position, diagnosis.id",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as LatestDiagnosisRow[];

  const unmatchedRows = database
    .prepare(
      [
        "SELECT submission.id AS submission_id, submission.membership_id, student.display_name AS student_name,",
        "submission.input_kind, submission.sanitized_error_message, asset.media_type,",
        "review.created_at AS reviewed_at, review.note AS teacher_note",
        "FROM submissions AS submission",
        "JOIN class_memberships AS membership ON membership.id = submission.membership_id AND membership.archived_at IS NULL",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "LEFT JOIN submission_assets AS asset ON asset.submission_id = submission.id",
        "AND asset.page_position = 1 AND asset.purged_at IS NULL",
        "LEFT JOIN teacher_item_reviews AS review ON review.submission_id = submission.id AND review.diagnosis_id IS NULL",
        "WHERE submission.assignment_id = ? AND submission.class_id = ?",
        "AND submission.status = 'NEEDS_REVIEW'",
        "AND submission.sanitized_error_message IS NOT NULL",
        "ORDER BY student.display_name COLLATE NOCASE, submission.id",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as UnmatchedSubmissionRow[];

  const reviewItems: TriageItemRecord[] = diagnosisRows
    .filter((row) => !["CORRECT", "MISCONCEPTION"].includes(row.outcome))
    .map((row) => {
      const reasonCodes = parseReasons(row.review_reasons_json);
      const outOfScope = reasonCodes.some((reason) => OUT_OF_SCOPE_REASONS.has(reason));
      return {
        targetKey: `diagnosis:${row.diagnosis_id}`,
        diagnosisId: row.diagnosis_id,
        submissionId: row.submission_id,
        membershipId: row.membership_id,
        studentName: row.student_name,
        inputKind: row.input_kind,
        assignmentItemId: row.assignment_item_id,
        itemPosition: row.item_position,
        questionReference: exerciseQuestionReference(
          row.exercise_label,
          row.question_label,
        ),
        problemPrompt: row.problem_prompt,
        correctAnswer: row.correct_answer,
        transcription: row.transcription,
        flaggedEvidence: row.flagged_step_text ?? row.evidence_quote,
        flaggedEvidenceNote: row.flagged_step_note,
        confirmedMistake: row.flagged_step_text !== null,
        reasonCodes,
        reasons: reasonCodes.map(reviewReasonLabel),
        outOfScope,
        mediaType: row.media_type,
        assetUrl: row.media_type ? `/api/submissions/${row.submission_id}/asset` : null,
        suggestedPage: inferFirstReferencedPage(row.segmentation_note),
        region: normalizeProblemRegion({
          x: row.region_x,
          y: row.region_y,
          width: row.region_width,
          height: row.region_height,
        }),
        reviewedAt: row.reviewed_at,
        teacherNote: row.teacher_note,
      };
    });

  for (const row of unmatchedRows) {
    reviewItems.push({
      targetKey: `submission:${row.submission_id}`,
      diagnosisId: null,
      submissionId: row.submission_id,
      membershipId: row.membership_id,
      studentName: row.student_name,
      inputKind: row.input_kind,
      assignmentItemId: null,
      itemPosition: null,
      questionReference: null,
      problemPrompt: null,
      correctAnswer: null,
      transcription: "[No problem block was matched safely]",
      flaggedEvidence: null,
      flaggedEvidenceNote: null,
      confirmedMistake: false,
      reasonCodes: ["UNMATCHED_WORK"],
      reasons: [
        row.sanitized_error_message ??
          "The visible work could not be matched safely to an assignment item.",
      ],
      outOfScope: false,
      mediaType: row.media_type,
      assetUrl: row.media_type ? `/api/submissions/${row.submission_id}/asset` : null,
      suggestedPage: inferFirstReferencedPage(row.sanitized_error_message),
      region: null,
      reviewedAt: row.reviewed_at,
      teacherNote: row.teacher_note,
    });
  }

  const flaggedMemberships = new Set(
    reviewItems.map((item) => item.membershipId),
  );
  const definitiveMemberships = new Set(
    diagnosisRows
      .filter((row) => ["CORRECT", "MISCONCEPTION"].includes(row.outcome))
      .map((row) => row.membership_id),
  );
  const automaticallyCorrectedMembershipIds = [...definitiveMemberships].filter(
    (membershipId) => !flaggedMemberships.has(membershipId),
  );
  const studentsById = new Map(
    diagnosisRows.map((row) => [row.membership_id, row.student_name]),
  );
  const automaticallyCorrected = automaticallyCorrectedMembershipIds
    .map((membershipId) => ({
      membershipId,
      studentName: studentsById.get(membershipId) ?? "Student",
      correctedCopyUrl: `/assignments/${assignment.id}/students/${membershipId}/corrected`,
    }))
    .sort((left, right) => left.studentName.localeCompare(right.studentName));

  const needsReview = reviewItems.filter(
    (item) => !item.outOfScope && item.reviewedAt === null,
  );
  const reviewed = reviewItems.filter(
    (item) => !item.outOfScope && item.reviewedAt !== null,
  );
  const outOfScope = reviewItems.filter((item) => item.outOfScope);

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      className: assignment.class_name,
    },
    summary: {
      automaticallyCorrectedCount: automaticallyCorrected.length,
      needsReviewCount: needsReview.length,
      outOfScopeCount: outOfScope.length,
    },
    automaticallyCorrected,
    needsReview,
    reviewed,
    outOfScope,
  };
}

export function markTriageItemReviewed(
  assignmentId: string,
  rawInput: z.input<typeof markTriageItemReviewedInputSchema>,
) {
  const assignment = getAssignment(assignmentId);
  if (!assignment) {
    throw new TriageRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That assignment is no longer available.",
    );
  }
  const input = markTriageItemReviewedInputSchema.parse(rawInput);
  const [targetKind, targetId] = input.targetKey.split(":", 2);
  const database = getDatabase();
  const target = database
    .prepare(
      targetKind === "diagnosis"
        ? [
            "SELECT submission.id AS submission_id, diagnosis.id AS diagnosis_id",
            "FROM diagnoses AS diagnosis",
            "JOIN answer_versions AS version ON version.id = diagnosis.answer_version_id",
            "JOIN submission_answers AS answer ON answer.id = version.submission_answer_id",
            "JOIN submissions AS submission ON submission.id = answer.submission_id",
            "WHERE diagnosis.id = ? AND submission.assignment_id = ? AND submission.class_id = ?",
          ].join(" ")
        : [
            "SELECT submission.id AS submission_id, NULL AS diagnosis_id",
            "FROM submissions AS submission",
            "WHERE submission.id = ? AND submission.assignment_id = ? AND submission.class_id = ?",
            "AND submission.status = 'NEEDS_REVIEW'",
            "AND submission.sanitized_error_message IS NOT NULL",
          ].join(" "),
    )
    .get(targetId, assignment.id, assignment.class_id) as
    | { submission_id: string; diagnosis_id: string | null }
    | undefined;
  if (!target) {
    throw new TriageRepositoryError(
      "TRIAGE_ITEM_NOT_FOUND",
      "That review item is no longer in this assignment.",
    );
  }

  try {
    database
      .prepare(
        "INSERT INTO teacher_item_reviews (id, submission_id, diagnosis_id, note) VALUES (?, ?, ?, ?)",
      )
      .run(randomUUID(), target.submission_id, target.diagnosis_id, input.note);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new TriageRepositoryError(
        "ALREADY_REVIEWED",
        "This item has already been marked as reviewed.",
      );
    }
    throw error;
  }

  return { targetKey: input.targetKey, note: input.note };
}

export type AssignmentTriage = NonNullable<ReturnType<typeof getAssignmentTriage>>;
export type TriageReviewItem = AssignmentTriage["needsReview"][number];
