import "server-only";

import type { MisconceptionId } from "@/domain/contracts";
import { exerciseQuestionReference } from "@/domain/exam-labels";
import {
  MISCONCEPTION_BY_ID,
  misconceptionIdSchema,
} from "@/domain/misconception-taxonomy.mjs";
import { getDatabase } from "@/lib/db";

type DiagnosisRow = {
  diagnosis_id: string;
  assignment_id: string;
  assignment_title: string;
  class_id: string;
  class_name: string;
  membership_id: string;
  student_name: string;
  exercise_label: string;
  exercise_position: number;
  question_label: string;
  outcome:
    | "CORRECT"
    | "MISCONCEPTION"
    | "NEEDS_REVIEW"
    | "INSUFFICIENT_EVIDENCE"
    | "MULTIPLE_PLAUSIBLE";
  misconception_id: string | null;
  evidence_quote: string | null;
  transcription: string;
  review_reasons_json: string;
  reviewed_at: string | null;
};

type IncorrectStepRow = {
  diagnosis_id: string;
  position: number;
  step_text: string;
  error_note: string | null;
  evidence_quote: string | null;
};

export type ErrorInventoryClassification =
  | "TAXONOMY_MISCONCEPTION"
  | "CALCULATION_SLIP"
  | "AWAITING_REVIEW"
  | "OUT_OF_SCOPE";

export type ErrorInventoryItem = {
  id: string;
  classification: ErrorInventoryClassification;
  assignmentId: string;
  assignmentTitle: string;
  classId: string;
  className: string;
  membershipId: string;
  studentName: string;
  exerciseLabel: string;
  exercisePosition: number;
  questionLabel: string;
  questionReference: string;
  evidenceQuote: string;
  explanation: string | null;
  misconceptionId: MisconceptionId | null;
  teacherLabel: string | null;
  correctedCopyUrl: string;
};

export type AssignmentErrorInventory = {
  assignment: {
    id: string;
    title: string;
    classId: string;
    className: string;
  };
  misconceptions: Array<{
    misconceptionId: MisconceptionId;
    teacherLabel: string;
    distinctStudentCount: number;
    occurrenceCount: number;
    items: ErrorInventoryItem[];
  }>;
  slipsByExercise: Array<{
    exerciseLabel: string;
    exercisePosition: number;
    distinctStudentCount: number;
    occurrenceCount: number;
    items: ErrorInventoryItem[];
  }>;
  awaitingReview: ErrorInventoryItem[];
  outOfScope: ErrorInventoryItem[];
  totals: {
    misconceptionTypeCount: number;
    misconceptionStudentCount: number;
    misconceptionOccurrenceCount: number;
    slipCount: number;
    awaitingReviewCount: number;
    outOfScopeCount: number;
  };
};

export function getAssignmentErrorInventory(
  assignmentId: string,
): AssignmentErrorInventory | null {
  const rows = listLatestDiagnosisRows("assignment.id = ?", [assignmentId]);
  if (rows.length === 0) {
    const assignment = getDatabase()
      .prepare(
        "SELECT assignment.id, assignment.title, assignment.class_id, class.name AS class_name FROM assignments AS assignment JOIN classes AS class ON class.id = assignment.class_id WHERE assignment.id = ? AND assignment.archived_at IS NULL",
      )
      .get(assignmentId) as
      | { id: string; title: string; class_id: string; class_name: string }
      | undefined;
    if (!assignment) return null;
    return buildInventory(
      {
        id: assignment.id,
        title: assignment.title,
        classId: assignment.class_id,
        className: assignment.class_name,
      },
      [],
    );
  }
  const first = rows[0];
  return buildInventory(
    {
      id: first.assignment_id,
      title: first.assignment_title,
      classId: first.class_id,
      className: first.class_name,
    },
    rows,
  );
}

export function listClassErrorInventoryRollups() {
  const rows = listLatestDiagnosisRows("assignment.archived_at IS NULL", []);
  const byClass = new Map<string, DiagnosisRow[]>();
  for (const row of rows) {
    const list = byClass.get(row.class_id) ?? [];
    list.push(row);
    byClass.set(row.class_id, list);
  }
  return [...byClass.values()].map((classRows) => {
    const assignmentIds = [...new Set(classRows.map((row) => row.assignment_id))];
    const inventories = assignmentIds.flatMap((id) => {
      const inventory = getAssignmentErrorInventory(id);
      return inventory ? [inventory] : [];
    });
    const misconceptionItems = inventories.flatMap((inventory) =>
      inventory.misconceptions.flatMap((group) => group.items),
    );
    const misconceptionGroups = groupMisconceptions(misconceptionItems);
    return {
      classId: classRows[0].class_id,
      className: classRows[0].class_name,
      assignmentCount: assignmentIds.length,
      misconceptionTypeCount: misconceptionGroups.length,
      misconceptionOccurrenceCount: misconceptionItems.length,
      misconceptionStudentCount: new Set(
        misconceptionItems.map((item) => item.membershipId),
      ).size,
      slipsByAssignment: inventories
        .map((inventory) => ({
          assignmentId: inventory.assignment.id,
          assignmentTitle: inventory.assignment.title,
          count: inventory.totals.slipCount,
        }))
        .filter((assignment) => assignment.count > 0),
      awaitingReviewCount: inventories.reduce(
        (sum, inventory) => sum + inventory.totals.awaitingReviewCount,
        0,
      ),
      leadingMisconceptions: misconceptionGroups.slice(0, 3),
    };
  });
}

function listLatestDiagnosisRows(
  whereClause: string,
  parameters: unknown[],
) {
  return getDatabase()
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, assignment.id AS assignment_id, assignment.title AS assignment_title,",
        "assignment.class_id, class.name AS class_name, submission.membership_id, student.display_name AS student_name,",
        "exercise.exercise_label, exercise.position AS exercise_position, item.question_label, diagnosis.outcome,",
        "diagnosis.misconception_id, diagnosis.evidence_quote, diagnosis.transcription, diagnosis.review_reasons_json,",
        "review.created_at AS reviewed_at",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "JOIN submissions AS submission ON submission.assignment_id = assignment.id AND submission.class_id = assignment.class_id",
        "JOIN class_memberships AS membership ON membership.id = submission.membership_id AND membership.archived_at IS NULL",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "LEFT JOIN teacher_item_reviews AS review ON review.diagnosis_id = diagnosis.id",
        `WHERE ${whereClause}`,
        "AND assignment.status = 'READY'",
        "AND diagnosis.id = (SELECT latest.id FROM diagnoses AS latest JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id WHERE latest_version.submission_answer_id = answer.id ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1)",
        "ORDER BY assignment.created_at DESC, exercise.position, item.position, student.display_name COLLATE NOCASE",
      ].join(" "),
    )
    .all(...parameters) as DiagnosisRow[];
}

function buildInventory(
  assignment: AssignmentErrorInventory["assignment"],
  rows: DiagnosisRow[],
): AssignmentErrorInventory {
  const diagnosisIds = rows.map((row) => row.diagnosis_id);
  const stepRows = diagnosisIds.length
    ? (getDatabase()
        .prepare(
          `SELECT diagnosis_id, position, step_text, error_note, evidence_quote FROM diagnosis_steps WHERE correctness = 'INCORRECT' AND diagnosis_id IN (${diagnosisIds.map(() => "?").join(",")}) ORDER BY diagnosis_id, position`,
        )
        .all(...diagnosisIds) as IncorrectStepRow[])
    : [];
  const stepsByDiagnosis = new Map<string, IncorrectStepRow[]>();
  for (const step of stepRows) {
    const list = stepsByDiagnosis.get(step.diagnosis_id) ?? [];
    list.push(step);
    stepsByDiagnosis.set(step.diagnosis_id, list);
  }

  const items: ErrorInventoryItem[] = [];
  for (const row of rows) {
    if (row.outcome === "CORRECT") continue;
    const reasons = parseReasons(row.review_reasons_json);
    const parsedMisconception = misconceptionIdSchema.safeParse(
      row.misconception_id,
    );
    const term = parsedMisconception.success
      ? MISCONCEPTION_BY_ID.get(parsedMisconception.data) ?? null
      : null;
    const steps = stepsByDiagnosis.get(row.diagnosis_id) ?? [];
    if (
      row.reviewed_at !== null &&
      steps.length === 0 &&
      !reasons.includes("DOMAIN_MISMATCH") &&
      row.outcome !== "MISCONCEPTION"
    ) {
      continue;
    }
    const classification: ErrorInventoryClassification =
      row.outcome === "MISCONCEPTION" && term
        ? "TAXONOMY_MISCONCEPTION"
        : reasons.includes("DOMAIN_MISMATCH")
          ? "OUT_OF_SCOPE"
          : row.reviewed_at !== null && steps.length > 0
            ? "CALCULATION_SLIP"
            : "AWAITING_REVIEW";
    const itemSteps =
      classification === "TAXONOMY_MISCONCEPTION" ||
      classification === "CALCULATION_SLIP"
        ? steps.length
          ? steps
          : [null]
        : [null];
    for (const [index, step] of itemSteps.entries()) {
      items.push({
        id: `${row.diagnosis_id}:${step?.position ?? index}`,
        classification,
        assignmentId: row.assignment_id,
        assignmentTitle: row.assignment_title,
        classId: row.class_id,
        className: row.class_name,
        membershipId: row.membership_id,
        studentName: row.student_name,
        exerciseLabel: row.exercise_label,
        exercisePosition: row.exercise_position,
        questionLabel: row.question_label,
        questionReference: exerciseQuestionReference(
          row.exercise_label,
          row.question_label,
        ),
        evidenceQuote:
          step?.evidence_quote ??
          step?.step_text ??
          row.evidence_quote ??
          firstNonEmptyLine(row.transcription) ??
          "No reliable excerpt is available yet.",
        explanation: step?.error_note ?? null,
        misconceptionId: term?.id ?? null,
        teacherLabel: term?.teacherLabel ?? null,
        correctedCopyUrl: `/analytics/${row.assignment_id}/corrected-copies/${row.membership_id}`,
      });
    }
  }

  const misconceptions = groupMisconceptions(
    items.filter((item) => item.classification === "TAXONOMY_MISCONCEPTION"),
  );
  const slipItems = items.filter(
    (item) => item.classification === "CALCULATION_SLIP",
  );
  const slipGroups = new Map<string, ErrorInventoryItem[]>();
  for (const item of slipItems) {
    const key = `${item.exercisePosition}:${item.exerciseLabel}`;
    const list = slipGroups.get(key) ?? [];
    list.push(item);
    slipGroups.set(key, list);
  }
  const slipsByExercise = [...slipGroups.values()]
    .map((groupItems) => ({
      exerciseLabel: groupItems[0].exerciseLabel,
      exercisePosition: groupItems[0].exercisePosition,
      distinctStudentCount: new Set(
        groupItems.map((item) => item.membershipId),
      ).size,
      occurrenceCount: groupItems.length,
      items: groupItems,
    }))
    .sort(
      (left, right) =>
        right.occurrenceCount - left.occurrenceCount ||
        left.exercisePosition - right.exercisePosition,
    );
  const awaitingReview = items.filter(
    (item) => item.classification === "AWAITING_REVIEW",
  );
  const outOfScope = items.filter(
    (item) => item.classification === "OUT_OF_SCOPE",
  );
  const misconceptionStudentCount = new Set(
    misconceptions.flatMap((group) =>
      group.items.map((item) => item.membershipId),
    ),
  ).size;
  return {
    assignment,
    misconceptions,
    slipsByExercise,
    awaitingReview,
    outOfScope,
    totals: {
      misconceptionTypeCount: misconceptions.length,
      misconceptionStudentCount,
      misconceptionOccurrenceCount: misconceptions.reduce(
        (sum, group) => sum + group.occurrenceCount,
        0,
      ),
      slipCount: slipItems.length,
      awaitingReviewCount: awaitingReview.length,
      outOfScopeCount: outOfScope.length,
    },
  };
}

function groupMisconceptions(items: ErrorInventoryItem[]) {
  const groups = new Map<
    MisconceptionId,
    { teacherLabel: string; items: ErrorInventoryItem[] }
  >();
  for (const item of items) {
    if (!item.misconceptionId || !item.teacherLabel) continue;
    const group = groups.get(item.misconceptionId) ?? {
      teacherLabel: item.teacherLabel,
      items: [],
    };
    group.items.push(item);
    groups.set(item.misconceptionId, group);
  }
  return [...groups.entries()]
    .map(([misconceptionId, group]) => ({
      misconceptionId,
      teacherLabel: group.teacherLabel,
      distinctStudentCount: new Set(
        group.items.map((item) => item.membershipId),
      ).size,
      occurrenceCount: group.items.length,
      items: group.items,
    }))
    .sort(
      (left, right) =>
        right.distinctStudentCount - left.distinctStudentCount ||
        right.occurrenceCount - left.occurrenceCount ||
        left.teacherLabel.localeCompare(right.teacherLabel),
    );
}

function parseReasons(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((reason): reason is string => typeof reason === "string")
    : [];
}

function firstNonEmptyLine(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}
