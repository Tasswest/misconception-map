import "server-only";

import type { MisconceptionId } from "@/domain/contracts";
import { MISCONCEPTION_BY_ID, misconceptionIdSchema } from "@/domain/misconception-taxonomy.mjs";
import { getDatabase } from "@/lib/db";
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
  created_at: string;
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
  studentCount: number;
  diagnosedStudentCount: number;
  largestCluster: {
    misconceptionId: MisconceptionId;
    label: string;
    shortLabel: string;
    affectedCount: number;
  } | null;
  teachingBrief: TeachingBriefRecord | null;
  columns: Array<{
    misconceptionId: MisconceptionId;
    label: string;
    shortLabel: string;
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
        "item.position AS problem_position, problem.prompt AS problem_prompt",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "AND item.assignment_id = answer.assignment_id AND item.class_id = answer.class_id",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
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
        relevantDiagnoses.some((diagnosis) =>
          ["CORRECT", "MISCONCEPTION"].includes(diagnosis.outcome),
        )
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
  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      classId: assignment.class_id,
      className: assignment.class_name,
    },
    studentCount: memberships.length,
    diagnosedStudentCount: diagnosesByMembership.size,
    largestCluster: largest
      ? {
          misconceptionId: largest.misconceptionId,
          label: largest.label,
          shortLabel: largest.shortLabel,
          affectedCount: largest.affectedCount,
        }
      : null,
    teachingBrief: getLatestTeachingBrief(assignment.id),
    columns,
    rows,
  };
}
