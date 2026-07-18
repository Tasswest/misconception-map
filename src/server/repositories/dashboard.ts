import "server-only";

import type { MisconceptionId } from "@/domain/contracts";
import { exerciseQuestionReference, shortExerciseLabel } from "@/domain/exam-labels";
import { MISCONCEPTION_BY_ID, misconceptionIdSchema } from "@/domain/misconception-taxonomy.mjs";
import { getDatabase } from "@/lib/db";
import {
  getAssignmentErrorInventory,
  type AssignmentErrorInventory,
} from "@/server/repositories/error-inventory";
import {
  getLatestTeachingBrief,
  listLatestPracticeByMembership,
  type PracticeSummary,
  type TeachingBriefRecord,
} from "@/server/repositories/instructional-support";

type AssignmentRow = {
  id: string;
  title: string;
  class_id: string;
  class_name: string;
};

type MembershipRow = {
  id: string;
  display_name: string;
  sort_order: number;
};

type DiagnosisRow = {
  diagnosis_id: string;
  submission_id: string;
  membership_id: string;
  outcome: "CORRECT" | "MISCONCEPTION" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE" | "MULTIPLE_PLAUSIBLE";
  misconception_id: string | null;
  confidence: number;
  severity: 0 | 1 | 2 | 3;
  transcription: string;
  evidence_quote: string | null;
  review_reasons_json: string;
  problem_position: number;
  problem_prompt: string;
  exercise_id: string;
  exercise_position: number;
  exercise_label: string;
  question_label: string;
  created_at: string;
};

type ExerciseRow = {
  id: string;
  position: number;
  exercise_label: string;
  question_count: number;
};

type StepRow = {
  diagnosis_id: string;
  position: number;
  step_text: string;
  correctness: "CORRECT" | "INCORRECT" | "UNCLEAR";
  correct_note: string | null;
  error_note: string | null;
  evidence_quote: string | null;
};

export type HeatmapDiagnosisDetail = {
  diagnosisId: string;
  submissionId: string;
  outcome: DiagnosisRow["outcome"];
  confidence: number;
  severity: 0 | 1 | 2 | 3;
  problemPosition: number;
  exerciseLabel: string;
  questionLabel: string;
  questionReference: string;
  problemPrompt: string;
  transcription: string;
  evidenceQuote: string | null;
  reviewReasons: string[];
  createdAt: string;
  steps: Array<{
    position: number;
    step: string;
    correctness: StepRow["correctness"];
    correctNote: string | null;
    errorNote: string | null;
    evidenceQuote: string | null;
  }>;
};

export type HeatmapDashboard = {
  assignment: {
    id: string;
    title: string;
    classId: string;
    className: string;
  };
  errorInventory: AssignmentErrorInventory;
  studentCount: number;
  diagnosedStudentCount: number;
  summary: {
    diagnosedCount: number;
    correctCount: number;
    awaitingReviewCount: number;
    notYetDiagnosedExerciseCount: number;
  };
  largestCluster: {
    misconceptionId: MisconceptionId;
    label: string;
    shortLabel: string;
    teacherLabel: string;
    citationNote: string;
    affectedCount: number;
  } | null;
  teachingBrief: TeachingBriefRecord | null;
  exercises: Array<{
    id: string;
    position: number;
    label: string;
    shortLabel: string;
    questionCount: number;
    successRate: number | null;
    assessedCount: number;
    correctCount: number;
    flaggedCount: number;
    dominantMisconception: {
      misconceptionId: MisconceptionId;
      label: string;
      shortLabel: string;
      teacherLabel: string;
      count: number;
    } | null;
  }>;
  columns: Array<{
    misconceptionId: MisconceptionId;
    label: string;
    shortLabel: string;
    teacherLabel: string;
    citationNote: string;
    affectedCount: number;
    frequency: number;
    maxSeverity: 1 | 2 | 3;
  }>;
  rows: Array<{
    membershipId: string;
    studentName: string;
    diagnosedCount: number;
    reviewCount: number;
    practiceTarget: {
      misconceptionId: MisconceptionId;
      misconceptionLabel: string;
      shortLabel: string;
      sourceReference: string;
    } | null;
    practice: PracticeSummary | null;
    cells: Array<{
      misconceptionId: MisconceptionId;
      state: "MISCONCEPTION" | "CLEAR" | "REVIEW" | "NO_DATA";
      severity: 0 | 1 | 2 | 3;
      frequency: number;
      evidenceQuote: string | null;
      detail: HeatmapDiagnosisDetail | null;
    }>;
  }>;
};

export function getHeatmapDashboard(assignmentId: string): HeatmapDashboard | null {
  const database = getDatabase();
  const assignment = database
    .prepare(
      [
        "SELECT assignment.id, assignment.title, assignment.class_id, class.name AS class_name",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "WHERE assignment.id = ? AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
      ].join(" "),
    )
    .get(assignmentId) as AssignmentRow | undefined;
  if (!assignment) return null;

  const exerciseRows = database
    .prepare(
      [
        "SELECT exercise.id, exercise.position, exercise.exercise_label, count(item.id) AS question_count",
        "FROM exercises AS exercise",
        "LEFT JOIN assignment_items AS item ON item.exercise_id = exercise.id",
        "WHERE exercise.assignment_id = ? AND exercise.class_id = ?",
        "GROUP BY exercise.id ORDER BY exercise.position",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as ExerciseRow[];

  const memberships = database
    .prepare(
      [
        "SELECT membership.id, student.display_name, membership.sort_order",
        "FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "WHERE membership.class_id = ? AND membership.archived_at IS NULL",
        "ORDER BY membership.sort_order, student.display_name COLLATE NOCASE",
      ].join(" "),
    )
    .all(assignment.class_id) as MembershipRow[];

  const diagnoses = database
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, submission.id AS submission_id, submission.membership_id,",
        "diagnosis.outcome, diagnosis.misconception_id, diagnosis.confidence, diagnosis.severity,",
        "diagnosis.transcription, diagnosis.evidence_quote, diagnosis.review_reasons_json, diagnosis.created_at,",
        "item.position AS problem_position, problem.prompt AS problem_prompt,",
        "exercise.id AS exercise_id, exercise.position AS exercise_position, exercise.exercise_label, item.question_label",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "AND item.assignment_id = answer.assignment_id AND item.class_id = answer.class_id",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id AND exercise.assignment_id = item.assignment_id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE submission.assignment_id = ? AND submission.class_id = ?",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "JOIN submission_answers AS latest_answer ON latest_answer.id = latest_version.submission_answer_id",
        "WHERE latest_answer.id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "ORDER BY diagnosis.created_at DESC",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as DiagnosisRow[];

  const unmatchedReviewCount = (
    database
      .prepare(
        [
          "SELECT count(*) AS count FROM submissions AS submission",
          "WHERE submission.assignment_id = ? AND submission.class_id = ?",
          "AND submission.status = 'NEEDS_REVIEW'",
          "AND COALESCE(TRIM(submission.sanitized_error_message), '') <> ''",
          "AND NOT EXISTS (SELECT 1 FROM submission_answers AS answer JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id WHERE answer.submission_id = submission.id)",
        ].join(" "),
      )
      .get(assignment.id, assignment.class_id) as { count: number }
  ).count;

  const diagnosisIds = diagnoses.map((diagnosis) => diagnosis.diagnosis_id);
  const steps = diagnosisIds.length
    ? (database
        .prepare(
          [
            "SELECT diagnosis_id, position, step_text, correctness, correct_note, error_note, evidence_quote",
            `FROM diagnosis_steps WHERE diagnosis_id IN (${diagnosisIds.map(() => "?").join(",")})`,
            "ORDER BY diagnosis_id, position",
          ].join(" "),
        )
        .all(...diagnosisIds) as StepRow[])
    : [];
  const stepsByDiagnosis = new Map<string, HeatmapDiagnosisDetail["steps"]>();
  for (const step of steps) {
    const list = stepsByDiagnosis.get(step.diagnosis_id) ?? [];
    list.push({
      position: step.position,
      step: step.step_text,
      correctness: step.correctness,
      correctNote: step.correct_note,
      errorNote: step.error_note,
      evidenceQuote: step.evidence_quote,
    });
    stepsByDiagnosis.set(step.diagnosis_id, list);
  }

  const diagnosesByMembership = new Map<string, DiagnosisRow[]>();
  for (const diagnosis of diagnoses) {
    const list = diagnosesByMembership.get(diagnosis.membership_id) ?? [];
    list.push(diagnosis);
    diagnosesByMembership.set(diagnosis.membership_id, list);
  }
  const diagnosedItemPositions = new Set(
    diagnoses
      .filter((diagnosis) =>
        ["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
      )
      .map((diagnosis) => diagnosis.problem_position),
  );
  const itemsWithMisconceptions = new Set(
    diagnoses
      .filter((diagnosis) => diagnosis.outcome === "MISCONCEPTION")
      .map((diagnosis) => diagnosis.problem_position),
  );

  const aggregateByMisconception = new Map<
    MisconceptionId,
    {
      memberships: Set<string>;
      problemPositions: Set<number>;
      frequency: number;
      maxSeverity: 1 | 2 | 3;
    }
  >();
  for (const diagnosis of diagnoses) {
    const parsedId = misconceptionIdSchema.safeParse(diagnosis.misconception_id);
    if (diagnosis.outcome !== "MISCONCEPTION" || !parsedId.success) continue;
    const aggregate = aggregateByMisconception.get(parsedId.data) ?? {
      memberships: new Set<string>(),
      problemPositions: new Set<number>(),
      frequency: 0,
      maxSeverity: 1 as const,
    };
    aggregate.memberships.add(diagnosis.membership_id);
    aggregate.problemPositions.add(diagnosis.problem_position);
    aggregate.frequency += 1;
    aggregate.maxSeverity = Math.max(
      aggregate.maxSeverity,
      diagnosis.severity,
    ) as 1 | 2 | 3;
    aggregateByMisconception.set(parsedId.data, aggregate);
  }

  const columns = [...aggregateByMisconception.entries()]
    .flatMap(([misconceptionId, aggregate]) => {
      const term = MISCONCEPTION_BY_ID.get(misconceptionId);
      return term
        ? [
            {
              misconceptionId,
              label: term.label,
              shortLabel: term.shortLabel,
              teacherLabel: term.teacherLabel,
              citationNote: term.citationNote,
              affectedCount: aggregate.memberships.size,
              frequency: aggregate.frequency,
              maxSeverity: aggregate.maxSeverity,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        right.affectedCount - left.affectedCount ||
        right.frequency - left.frequency ||
        right.maxSeverity - left.maxSeverity ||
        left.shortLabel.localeCompare(right.shortLabel),
    );

  const detailFor = (diagnosis: DiagnosisRow): HeatmapDiagnosisDetail => ({
    diagnosisId: diagnosis.diagnosis_id,
    submissionId: diagnosis.submission_id,
    outcome: diagnosis.outcome,
    confidence: diagnosis.confidence,
    severity: diagnosis.severity,
    problemPosition: diagnosis.problem_position,
    exerciseLabel: diagnosis.exercise_label,
    questionLabel: diagnosis.question_label,
    questionReference: exerciseQuestionReference(
      diagnosis.exercise_label,
      diagnosis.question_label,
    ),
    problemPrompt: diagnosis.problem_prompt,
    transcription: diagnosis.transcription,
    evidenceQuote: diagnosis.evidence_quote,
    reviewReasons: JSON.parse(diagnosis.review_reasons_json) as string[],
    createdAt: diagnosis.created_at,
    steps: stepsByDiagnosis.get(diagnosis.diagnosis_id) ?? [],
  });

  const rows: HeatmapDashboard["rows"] = memberships.map((membership) => {
    const studentDiagnoses = diagnosesByMembership.get(membership.id) ?? [];
    const definitive = studentDiagnoses.filter((diagnosis) =>
      ["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
    );
    const review = studentDiagnoses.filter(
      (diagnosis) => !["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
    );
    const cells = columns.map((column) => {
      const relevantProblemPositions =
        aggregateByMisconception.get(column.misconceptionId)?.problemPositions ??
        new Set<number>();
      const relevantDiagnoses = studentDiagnoses.filter((diagnosis) =>
        relevantProblemPositions.has(diagnosis.problem_position),
      );
      const matches = relevantDiagnoses.filter(
        (diagnosis) =>
          diagnosis.outcome === "MISCONCEPTION" &&
          diagnosis.misconception_id === column.misconceptionId,
      );
      const strongest = [...matches].sort(
        (left, right) =>
          right.severity - left.severity ||
          right.confidence - left.confidence ||
          right.created_at.localeCompare(left.created_at),
      )[0];
      if (strongest) {
        return {
          misconceptionId: column.misconceptionId,
          state: "MISCONCEPTION" as const,
          severity: strongest.severity,
          frequency: matches.length,
          evidenceQuote: strongest.evidence_quote,
          detail: detailFor(strongest),
        };
      }
      if (
        relevantDiagnoses.some((diagnosis) => diagnosis.outcome === "CORRECT")
      ) {
        return {
          misconceptionId: column.misconceptionId,
          state: "CLEAR" as const,
          severity: 0 as const,
          frequency: 0,
          evidenceQuote: null,
          detail: null,
        };
      }
      const reviewDiagnosis = relevantDiagnoses.find(
        (diagnosis) =>
          !["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
      );
      return {
        misconceptionId: column.misconceptionId,
        state: reviewDiagnosis ? ("REVIEW" as const) : ("NO_DATA" as const),
        severity: 0 as const,
        frequency: 0,
        evidenceQuote: null,
        detail: reviewDiagnosis ? detailFor(reviewDiagnosis) : null,
      };
    });
    const targetCell = cells.find((cell) => cell.state === "MISCONCEPTION");
    const targetColumn = targetCell
      ? columns.find(
          (column) => column.misconceptionId === targetCell.misconceptionId,
        )
      : null;
    return {
      membershipId: membership.id,
      studentName: membership.display_name,
      diagnosedCount: definitive.length,
      reviewCount: review.length,
      practiceTarget:
        targetCell && targetColumn
          ? {
              misconceptionId: targetCell.misconceptionId,
              misconceptionLabel: targetColumn.label,
              shortLabel: targetColumn.shortLabel,
              sourceReference:
                targetCell.detail?.questionReference ??
                shortExerciseLabel("Exercise"),
            }
          : null,
      practice: null,
      cells,
    };
  });

  const practices = listLatestPracticeByMembership(assignment.id);
  for (const row of rows) {
    row.practice =
      practices.find(
        (practice) =>
          practice.membershipId === row.membershipId &&
          practice.misconceptionId === row.practiceTarget?.misconceptionId,
      ) ?? null;
  }

  rows.sort((left, right) => {
    const firstLeft = left.cells[0];
    const firstRight = right.cells[0];
    const firstDifference =
      (firstRight?.frequency ?? 0) - (firstLeft?.frequency ?? 0) ||
      (firstRight?.severity ?? 0) - (firstLeft?.severity ?? 0);
    if (firstDifference !== 0) return firstDifference;
    const total = (row: (typeof rows)[number]) =>
      row.cells.reduce(
        (sum, cell) => sum + cell.severity * 10 + cell.frequency,
        0,
      );
    return total(right) - total(left) || left.studentName.localeCompare(right.studentName);
  });

  const largest = columns[0];
  const exercises: HeatmapDashboard["exercises"] = exerciseRows.map((exercise) => {
    const exerciseDiagnoses = diagnoses.filter(
      (diagnosis) => diagnosis.exercise_id === exercise.id,
    );
    const assessed = exerciseDiagnoses.filter((diagnosis) =>
      ["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
    );
    const correctCount = assessed.filter(
      (diagnosis) => diagnosis.outcome === "CORRECT",
    ).length;
    const misconceptionCounts = new Map<MisconceptionId, number>();
    for (const diagnosis of exerciseDiagnoses) {
      const parsed = misconceptionIdSchema.safeParse(diagnosis.misconception_id);
      if (diagnosis.outcome === "MISCONCEPTION" && parsed.success) {
        misconceptionCounts.set(
          parsed.data,
          (misconceptionCounts.get(parsed.data) ?? 0) + 1,
        );
      }
    }
    const dominant = [...misconceptionCounts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0];
    const dominantTerm = dominant
      ? MISCONCEPTION_BY_ID.get(dominant[0]) ?? null
      : null;
    return {
      id: exercise.id,
      position: exercise.position,
      label: exercise.exercise_label,
      shortLabel: shortExerciseLabel(exercise.exercise_label),
      questionCount: exercise.question_count,
      successRate:
        assessed.length > 0
          ? Math.round((correctCount / assessed.length) * 100)
          : null,
      assessedCount: assessed.length,
      correctCount,
      flaggedCount: exerciseDiagnoses.filter(
        (diagnosis) =>
          !["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
      ).length,
      dominantMisconception:
        dominant && dominantTerm
          ? {
              misconceptionId: dominant[0],
              label: dominantTerm.label,
              shortLabel: dominantTerm.shortLabel,
              teacherLabel: dominantTerm.teacherLabel,
              count: dominant[1],
            }
          : null,
    };
  });
  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      classId: assignment.class_id,
      className: assignment.class_name,
    },
    errorInventory: getAssignmentErrorInventory(assignment.id)!,
    studentCount: memberships.length,
    diagnosedStudentCount: diagnosesByMembership.size,
    summary: {
      diagnosedCount: diagnosedItemPositions.size,
      correctCount: [...diagnosedItemPositions].filter(
        (position) => !itemsWithMisconceptions.has(position),
      ).length,
      awaitingReviewCount: diagnoses.filter(
        (diagnosis) =>
          !["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
      ).length + unmatchedReviewCount,
      notYetDiagnosedExerciseCount: exerciseRows.filter(
        (exercise) => exercise.question_count === 0,
      ).length,
    },
    largestCluster: largest
      ? {
          misconceptionId: largest.misconceptionId,
          label: largest.label,
          shortLabel: largest.shortLabel,
          teacherLabel: largest.teacherLabel,
          citationNote: largest.citationNote,
          affectedCount: largest.affectedCount,
        }
      : null,
    teachingBrief: getLatestTeachingBrief(assignment.id),
    exercises,
    columns,
    rows,
  };
}
