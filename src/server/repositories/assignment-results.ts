import "server-only";

import { z } from "zod";

import { getDatabase } from "@/lib/db";

const idSchema = z.string().trim().min(1).max(200);
const SETTLED_OUTCOMES = new Set(["CORRECT", "INCORRECT", "MISCONCEPTION"]);
const OUTSIDE_ANALYSIS_REASONS = new Set(["DOMAIN_MISMATCH", "NO_TAXONOMY_MATCH"]);

type ResultRow = {
  membership_id: string;
  student_name: string;
  outcome: string | null;
  review_reasons_json: string | null;
  unmatched_reason: string | null;
};

function parseReasons(value: string | null) {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((reason): reason is string => typeof reason === "string")
    : [];
}

export function getAssignmentResults(assignmentId: string) {
  const id = idSchema.parse(assignmentId);
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
    .get(id) as
    | { id: string; title: string; class_id: string; class_name: string }
    | undefined;
  if (!assignment) return null;

  const rows = database
    .prepare(
      [
        "SELECT submission.membership_id, student.display_name AS student_name,",
        "COALESCE(diagnosis.correction_verdict, diagnosis.outcome) AS outcome,",
        "diagnosis.review_reasons_json, NULL AS unmatched_reason",
        "FROM submissions AS submission",
        "JOIN class_memberships AS membership ON membership.id = submission.membership_id AND membership.archived_at IS NULL",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE submission.assignment_id = ? AND submission.class_id = ?",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "WHERE latest_version.submission_answer_id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "UNION ALL",
        "SELECT submission.membership_id, student.display_name AS student_name, NULL AS outcome,",
        "NULL AS review_reasons_json, submission.sanitized_error_message AS unmatched_reason",
        "FROM submissions AS submission",
        "JOIN class_memberships AS membership ON membership.id = submission.membership_id AND membership.archived_at IS NULL",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "WHERE submission.assignment_id = ? AND submission.class_id = ?",
        "AND submission.status = 'NEEDS_REVIEW'",
        "AND COALESCE(TRIM(submission.sanitized_error_message), '') <> ''",
        "AND NOT EXISTS (SELECT 1 FROM submission_answers AS answer WHERE answer.submission_id = submission.id)",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id, assignment.id, assignment.class_id) as ResultRow[];

  const byMembership = new Map<
    string,
    {
      membershipId: string;
      studentName: string;
      diagnosedCount: number;
      flaggedCount: number;
      outsideAnalysisCount: number;
    }
  >();
  for (const row of rows) {
    const copy = byMembership.get(row.membership_id) ?? {
      membershipId: row.membership_id,
      studentName: row.student_name,
      diagnosedCount: 0,
      flaggedCount: 0,
      outsideAnalysisCount: 0,
    };
    const reasons = parseReasons(row.review_reasons_json);
    if (row.outcome && SETTLED_OUTCOMES.has(row.outcome)) {
      copy.diagnosedCount += 1;
    } else if (reasons.some((reason) => OUTSIDE_ANALYSIS_REASONS.has(reason))) {
      copy.outsideAnalysisCount += 1;
    } else {
      copy.flaggedCount += 1;
    }
    byMembership.set(row.membership_id, copy);
  }

  const correctedCopies = [...byMembership.values()]
    .map((copy) => ({
      ...copy,
      correctedCopyUrl: `/analytics/${assignment.id}/corrected-copies/${copy.membershipId}`,
    }))
    .sort((left, right) => left.studentName.localeCompare(right.studentName));

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      className: assignment.class_name,
    },
    summary: {
      submittedCopyCount: correctedCopies.length,
      diagnosedItemCount: correctedCopies.reduce(
        (total, copy) => total + copy.diagnosedCount,
        0,
      ),
      flaggedItemCount: correctedCopies.reduce(
        (total, copy) => total + copy.flaggedCount,
        0,
      ),
      outsideAnalysisCount: correctedCopies.reduce(
        (total, copy) => total + copy.outsideAnalysisCount,
        0,
      ),
    },
    correctedCopies,
  };
}

export type AssignmentResults = NonNullable<ReturnType<typeof getAssignmentResults>>;
