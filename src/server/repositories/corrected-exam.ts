import "server-only";

import { z } from "zod";

import { MISCONCEPTION_BY_ID, misconceptionIdSchema } from "@/domain/misconception-taxonomy.mjs";
import { exerciseQuestionReference, shortExerciseLabel } from "@/domain/exam-labels";
import { normalizeProblemRegion } from "@/domain/problem-region.mjs";
import { getDatabase } from "@/lib/db";

const idSchema = z.string().uuid();

type CorrectedDiagnosisRow = {
  diagnosis_id: string;
  submission_id: string;
  assignment_item_id: string;
  outcome: "CORRECT" | "MISCONCEPTION" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE" | "MULTIPLE_PLAUSIBLE";
  misconception_id: string | null;
  confidence: number;
  transcription: string;
  evidence_quote: string | null;
  review_reasons_json: string;
  region_x: number | null;
  region_y: number | null;
  region_width: number | null;
  region_height: number | null;
  created_at: string;
};

type CorrectedSourcePageRow = {
  submission_id: string;
  assignment_item_id: string | null;
  scope_kind: "SINGLE_PROBLEM" | "FULL_PAGE";
  status: "UPLOADED" | "PROCESSING" | "DIAGNOSED" | "NEEDS_REVIEW" | "FAILED";
  review_note: string | null;
  media_type: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  width: number | null;
  height: number | null;
  submitted_at: string;
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
        "SELECT item.id AS assignment_item_id, item.position, item.question_label, problem.prompt, problem.correct_answer,",
        "exercise.id AS exercise_id, exercise.position AS exercise_position, exercise.exercise_label, exercise.shared_context",
        "FROM assignment_items AS item",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id AND exercise.assignment_id = item.assignment_id",
        "WHERE item.assignment_id = ? AND item.class_id = ? ORDER BY exercise.position, item.position",
      ].join(" "),
    )
    .all(assignmentId, header.class_id) as Array<{
    assignment_item_id: string;
    position: number;
    question_label: string;
    prompt: string;
    correct_answer: string;
    exercise_id: string;
    exercise_position: number;
    exercise_label: string;
    shared_context: string | null;
  }>;

  const diagnosisRows = database
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, submission.id AS submission_id, answer.assignment_item_id, diagnosis.outcome, diagnosis.misconception_id,",
        "diagnosis.confidence, diagnosis.transcription, diagnosis.evidence_quote, diagnosis.review_reasons_json,",
        "answer.region_x, answer.region_y, answer.region_width, answer.region_height, diagnosis.created_at",
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

  const sourcePageRows = database
    .prepare(
      [
        "SELECT submission.id AS submission_id, submission.assignment_item_id, submission.scope_kind, submission.status,",
        "submission.sanitized_error_message AS review_note, asset.media_type, asset.width, asset.height, submission.submitted_at",
        "FROM submissions AS submission",
        "JOIN submission_assets AS asset ON asset.submission_id = submission.id AND asset.page_position = 1 AND asset.purged_at IS NULL",
        "WHERE submission.assignment_id = ? AND submission.class_id = ? AND submission.membership_id = ?",
        "AND submission.input_kind = 'IMAGE'",
        "ORDER BY submission.submitted_at DESC, submission.id DESC",
      ].join(" "),
    )
    .all(assignmentId, header.class_id, membershipId) as CorrectedSourcePageRow[];
  const latestFullPage = sourcePageRows.find(
    (source) => source.scope_kind === "FULL_PAGE",
  );
  const selectedSourcePages = latestFullPage
    ? [latestFullPage]
    : [
        ...sourcePageRows
          .reduce((latestByItem, source) => {
            if (
              source.assignment_item_id &&
              !latestByItem.has(source.assignment_item_id)
            ) {
              latestByItem.set(source.assignment_item_id, source);
            }
            return latestByItem;
          }, new Map<string, CorrectedSourcePageRow>())
          .values(),
      ].sort((left, right) => left.submitted_at.localeCompare(right.submitted_at));
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

  const correctedItems = items.map((item) => {
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
      exerciseId: item.exercise_id,
      exercisePosition: item.exercise_position,
      exerciseLabel: item.exercise_label,
      questionLabel: item.question_label,
      questionReference: exerciseQuestionReference(
        item.exercise_label,
        item.question_label,
      ),
      sharedContext: item.shared_context,
      problemPrompt: item.prompt,
      correctAnswer: item.correct_answer,
      diagnosis: diagnosis
        ? {
            id: diagnosis.diagnosis_id,
            sourceSubmissionId: diagnosis.submission_id,
            region: normalizeProblemRegion({
              x: diagnosis.region_x,
              y: diagnosis.region_y,
              width: diagnosis.region_width,
              height: diagnosis.region_height,
            }),
            outcome: diagnosis.outcome,
            confidence: diagnosis.confidence,
            transcription: diagnosis.transcription,
            evidenceQuote: diagnosis.evidence_quote,
            reviewReasons: JSON.parse(
              diagnosis.review_reasons_json,
            ) as string[],
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
  });

  const exercises = [...new Set(correctedItems.map((item) => item.exerciseId))].map(
    (exerciseId) => {
      const exerciseItems = correctedItems.filter(
        (item) => item.exerciseId === exerciseId,
      );
      const first = exerciseItems[0];
      const counts = exerciseItems.reduce(
        (summary, item) => {
          if (item.diagnosis?.outcome === "CORRECT") summary.correct += 1;
          else if (item.diagnosis?.outcome === "MISCONCEPTION") summary.incorrect += 1;
          else summary.flagged += 1;
          return summary;
        },
        { correct: 0, incorrect: 0, flagged: 0 },
      );
      return {
        id: exerciseId,
        position: first.exercisePosition,
        label: first.exerciseLabel,
        shortLabel: shortExerciseLabel(first.exerciseLabel),
        sharedContext: first.sharedContext,
        counts,
        items: exerciseItems,
      };
    },
  );

  return {
    assignmentId: header.assignment_id,
    assignmentTitle: header.assignment_title,
    className: header.class_name,
    membershipId: header.membership_id,
    studentName: header.student_name,
    generatedAt: new Date().toISOString(),
    diagnosedProblemCount: latestByItem.size,
    totalProblemCount: items.length,
    sourcePages: selectedSourcePages.map((source, index) => ({
      submissionId: source.submission_id,
      assignmentItemId: source.assignment_item_id,
      scopeKind: source.scope_kind,
      status: source.status,
      reviewNote: source.review_note,
      mediaType: source.media_type,
      width: source.width,
      height: source.height,
      label:
        source.media_type === "application/pdf"
          ? selectedSourcePages.length === 1
            ? "Student's submitted PDF"
            : `Student work PDF ${index + 1}`
          : selectedSourcePages.length === 1
          ? "Student's submitted page"
          : `Student work image ${index + 1}`,
      src: `/api/submissions/${source.submission_id}/asset`,
      markers:
        source.media_type === "application/pdf"
          ? []
          : correctedItems.flatMap((item) =>
              item.diagnosis?.sourceSubmissionId === source.submission_id &&
              item.diagnosis.region
                ? [
                    {
                      position: item.position,
                      questionReference: item.questionReference,
                      region: item.diagnosis.region,
                    },
                  ]
                : [],
            ),
    })),
    exercises,
    items: correctedItems,
  };
}

export function getCorrectedExamSourceAsset(submissionId: string) {
  if (!idSchema.safeParse(submissionId).success) return null;

  return (getDatabase()
    .prepare(
      [
        "SELECT asset.storage_key, asset.media_type, asset.byte_size, asset.sha256",
        "FROM submission_assets AS asset",
        "JOIN submissions AS submission ON submission.id = asset.submission_id",
        "WHERE submission.id = ? AND submission.input_kind = 'IMAGE'",
        "AND asset.page_position = 1 AND asset.purged_at IS NULL",
      ].join(" "),
    )
    .get(submissionId) ?? null) as
    | {
        storage_key: string;
        media_type:
          | "image/jpeg"
          | "image/png"
          | "image/webp"
          | "application/pdf";
        byte_size: number;
        sha256: string;
      }
    | null;
}

export type CorrectedExam = NonNullable<ReturnType<typeof getCorrectedExam>>;
