import "server-only";

import { z } from "zod";

import { getDatabase } from "@/lib/db";
import { entityIdSchema } from "@/server/repositories/workspace";

export const managedGradeBandSchema = z.enum([
  "GRADE_5",
  "GRADE_6",
  "GRADE_7",
  "GRADE_8",
  "MIXED_5_8",
]);

export const renameEntityInputSchema = z
  .object({ name: z.string().trim().min(1).max(160) })
  .strict();

export const archiveEntityInputSchema = z
  .object({ action: z.literal("ARCHIVE") })
  .strict();

export const updateClassDetailsInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    gradeBand: managedGradeBandSchema,
    schoolYear: z.string().trim().min(1).max(20).nullable(),
  })
  .strict();

export const updateClassMemberInputSchema = z
  .object({ displayName: z.string().trim().min(1).max(120) })
  .strict();

export const classMutationInputSchema = z.union([
  updateClassDetailsInputSchema,
  archiveEntityInputSchema,
]);

export const assignmentMutationInputSchema = z.union([
  renameEntityInputSchema,
  archiveEntityInputSchema,
]);

export class ManagementRepositoryError extends Error {
  readonly code:
    | "CLASS_NOT_FOUND"
    | "CLASS_MEMBER_NOT_FOUND"
    | "ASSIGNMENT_NOT_FOUND";
  readonly status = 404;

  constructor(code: ManagementRepositoryError["code"], message: string) {
    super(message);
    this.name = "ManagementRepositoryError";
    this.code = code;
  }
}

export type ManagedClass = {
  id: string;
  name: string;
  gradeBand: z.infer<typeof managedGradeBandSchema>;
  schoolYear: string | null;
  isDemo: boolean;
  studentCount: number;
  assignmentCount: number;
  diagnosedStudentCount: number;
  needsReviewCount: number;
  latestAssignment: {
    id: string;
    title: string;
    createdAt: string;
  } | null;
  students: Array<{ membershipId: string; displayName: string }>;
};

export type ManagedAssignment = {
  id: string;
  classId: string;
  className: string;
  title: string;
  description: string | null;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  status: "DRAFT" | "READY";
  itemCount: number;
  studentCount: number;
  diagnosedStudentCount: number;
  needsReviewCount: number;
  currentStep: 1 | 2 | 3 | 4;
  currentStepHref: string;
  createdAt: string;
};

type ManagedAssignmentRow = Omit<
  ManagedAssignment,
  "currentStep" | "currentStepHref"
> & {
  submissionCount: number;
  unfinishedSubmissionCount: number;
};

type ClassRow = Omit<ManagedClass, "isDemo" | "latestAssignment" | "students"> & {
  is_demo: 0 | 1;
  latest_assignment_id: string | null;
  latest_assignment_title: string | null;
  latest_assignment_created_at: string | null;
};

export function listManagedClasses(): ManagedClass[] {
  const database = getDatabase();
  const rows = database
    .prepare(
      `
        SELECT
          class.id,
          class.name,
          class.grade_band AS gradeBand,
          class.school_year AS schoolYear,
          class.is_demo,
          (
            SELECT count(*) FROM class_memberships AS membership
            JOIN students AS student ON student.id = membership.student_id
            WHERE membership.class_id = class.id
              AND membership.archived_at IS NULL
              AND student.archived_at IS NULL
          ) AS studentCount,
          (
            SELECT count(*) FROM assignments AS assignment
            WHERE assignment.class_id = class.id
              AND assignment.archived_at IS NULL
              AND assignment.status <> 'ARCHIVED'
          ) AS assignmentCount,
          (
            SELECT count(DISTINCT submission.membership_id)
            FROM submissions AS submission
            WHERE submission.class_id = class.id
              AND submission.status IN ('DIAGNOSED', 'NEEDS_REVIEW')
          ) AS diagnosedStudentCount,
          (
            SELECT count(*) FROM submissions AS submission
            WHERE submission.class_id = class.id
              AND submission.status = 'NEEDS_REVIEW'
          ) AS needsReviewCount,
          latest.id AS latest_assignment_id,
          latest.title AS latest_assignment_title,
          latest.created_at AS latest_assignment_created_at
        FROM classes AS class
        LEFT JOIN assignments AS latest
          ON latest.id = (
            SELECT candidate.id FROM assignments AS candidate
            WHERE candidate.class_id = class.id
              AND candidate.archived_at IS NULL
              AND candidate.status = 'READY'
            ORDER BY candidate.created_at DESC, candidate.id DESC
            LIMIT 1
          )
        WHERE class.archived_at IS NULL
        ORDER BY class.is_demo DESC, class.updated_at DESC, class.name COLLATE NOCASE
      `,
    )
    .all() as ClassRow[];
  const memberships = database
    .prepare(
      `
        SELECT membership.class_id, membership.id, student.display_name
        FROM class_memberships AS membership
        JOIN students AS student ON student.id = membership.student_id
        JOIN classes AS class ON class.id = membership.class_id
        WHERE class.archived_at IS NULL
          AND membership.archived_at IS NULL
          AND student.archived_at IS NULL
        ORDER BY membership.sort_order, student.display_name COLLATE NOCASE
      `,
    )
    .all() as Array<{
    class_id: string;
    id: string;
    display_name: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    gradeBand: row.gradeBand,
    schoolYear: row.schoolYear,
    isDemo: row.is_demo === 1,
    studentCount: row.studentCount,
    assignmentCount: row.assignmentCount,
    diagnosedStudentCount: row.diagnosedStudentCount,
    needsReviewCount: row.needsReviewCount,
    latestAssignment:
      row.latest_assignment_id &&
      row.latest_assignment_title &&
      row.latest_assignment_created_at
        ? {
            id: row.latest_assignment_id,
            title: row.latest_assignment_title,
            createdAt: row.latest_assignment_created_at,
          }
        : null,
    students: memberships
      .filter((membership) => membership.class_id === row.id)
      .map((membership) => ({
        membershipId: membership.id,
        displayName: membership.display_name,
      })),
  }));
}

export function listManagedAssignments(): ManagedAssignment[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT
          assignment.id,
          assignment.class_id AS classId,
          class.name AS className,
          assignment.title,
          assignment.description,
          assignment.domain,
          assignment.status,
          assignment.created_at AS createdAt,
          (SELECT count(*) FROM assignment_items AS item WHERE item.assignment_id = assignment.id) AS itemCount,
          (
            SELECT count(*) FROM class_memberships AS membership
            JOIN students AS student ON student.id = membership.student_id
            WHERE membership.class_id = class.id
              AND membership.archived_at IS NULL
              AND student.archived_at IS NULL
          ) AS studentCount,
          (
            SELECT count(DISTINCT submission.membership_id)
            FROM submissions AS submission
            WHERE submission.assignment_id = assignment.id
              AND submission.status IN ('DIAGNOSED', 'NEEDS_REVIEW')
          ) AS diagnosedStudentCount,
          (
            SELECT count(*) FROM submissions AS submission
            WHERE submission.assignment_id = assignment.id
              AND submission.status = 'NEEDS_REVIEW'
          ) AS needsReviewCount,
          (
            SELECT count(*) FROM submissions AS submission
            WHERE submission.assignment_id = assignment.id
          ) AS submissionCount,
          (
            SELECT count(*) FROM submissions AS submission
            WHERE submission.assignment_id = assignment.id
              AND submission.status IN ('UPLOADED', 'PROCESSING', 'FAILED')
          ) AS unfinishedSubmissionCount
        FROM assignments AS assignment
        JOIN classes AS class ON class.id = assignment.class_id
        WHERE class.archived_at IS NULL
          AND assignment.archived_at IS NULL
          AND assignment.status <> 'ARCHIVED'
        ORDER BY class.is_demo DESC, assignment.created_at DESC, assignment.title COLLATE NOCASE
      `,
    )
    .all() as ManagedAssignmentRow[];

  return rows.map((row) => {
    const currentStep = (
      row.status === "DRAFT"
        ? 1
        : row.submissionCount === 0
          ? 2
          : row.unfinishedSubmissionCount > 0
            ? 3
            : 4
    ) as ManagedAssignment["currentStep"];
    return {
      id: row.id,
      classId: row.classId,
      className: row.className,
      title: row.title,
      description: row.description,
      domain: row.domain,
      status: row.status,
      itemCount: row.itemCount,
      studentCount: row.studentCount,
      diagnosedStudentCount: row.diagnosedStudentCount,
      needsReviewCount: row.needsReviewCount,
      createdAt: row.createdAt,
      currentStep,
      currentStepHref:
        currentStep === 4
          ? `/assignments/${row.id}/results`
          : currentStep === 1
            ? `/assignments?assignmentId=${encodeURIComponent(row.id)}`
            : `/assignments/${row.id}/diagnose`,
    };
  });
}

export function updateClassDetails(
  classIdInput: string,
  input: z.input<typeof updateClassDetailsInputSchema>,
) {
  const classId = entityIdSchema.parse(classIdInput);
  const parsed = updateClassDetailsInputSchema.parse(input);
  const result = getDatabase()
    .prepare(
      [
        "UPDATE classes SET name = ?, grade_band = ?, school_year = ?,",
        "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        "WHERE id = ? AND archived_at IS NULL",
      ].join(" "),
    )
    .run(parsed.name, parsed.gradeBand, parsed.schoolYear, classId);
  if (!result.changes) {
    throw new ManagementRepositoryError(
      "CLASS_NOT_FOUND",
      "That class is no longer available.",
    );
  }
  return { id: classId, ...parsed };
}

export function archiveClass(classIdInput: string) {
  const classId = entityIdSchema.parse(classIdInput);
  const database = getDatabase();
  const now = new Date().toISOString();
  const result = database.transaction(() => {
    const updated = database
      .prepare(
        "UPDATE classes SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
      )
      .run(now, now, classId);
    if (!updated.changes) return updated;
    database
      .prepare(
        "UPDATE assignments SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE class_id = ? AND archived_at IS NULL",
      )
      .run(now, now, classId);
    return updated;
  })();
  if (!result.changes) {
    throw new ManagementRepositoryError(
      "CLASS_NOT_FOUND",
      "That class is no longer available.",
    );
  }
  return { id: classId, archivedAt: now };
}

export function updateClassMember(
  classIdInput: string,
  membershipIdInput: string,
  input: z.input<typeof updateClassMemberInputSchema>,
) {
  const classId = entityIdSchema.parse(classIdInput);
  const membershipId = entityIdSchema.parse(membershipIdInput);
  const parsed = updateClassMemberInputSchema.parse(input);
  const result = getDatabase()
    .prepare(
      [
        "UPDATE students SET display_name = ?,",
        "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        "WHERE id = (",
        "SELECT membership.student_id FROM class_memberships AS membership",
        "JOIN classes AS class ON class.id = membership.class_id",
        "JOIN students AS student ON student.id = membership.student_id",
        "WHERE membership.id = ? AND membership.class_id = ?",
        "AND membership.archived_at IS NULL AND class.archived_at IS NULL",
        "AND student.archived_at IS NULL",
        ")",
      ].join(" "),
    )
    .run(parsed.displayName, membershipId, classId);
  if (!result.changes) {
    throw new ManagementRepositoryError(
      "CLASS_MEMBER_NOT_FOUND",
      "That class member is no longer available.",
    );
  }
  return { classId, membershipId, displayName: parsed.displayName };
}

type ClassMemberRemovalContext = {
  studentId: string;
  storageKeys: string[];
  submissionIds: string[];
  uploadBatchIds: string[];
  aiRunIds: string[];
  problemIds: string[];
  teachingBriefIds: string[];
};

function getClassMemberRemovalContext(
  classId: string,
  membershipId: string,
): ClassMemberRemovalContext {
  const database = getDatabase();
  const membership = database
    .prepare(
      [
        "SELECT membership.student_id FROM class_memberships AS membership",
        "JOIN classes AS class ON class.id = membership.class_id",
        "JOIN students AS student ON student.id = membership.student_id",
        "WHERE membership.id = ? AND membership.class_id = ?",
        "AND membership.archived_at IS NULL AND class.archived_at IS NULL",
        "AND student.archived_at IS NULL",
      ].join(" "),
    )
    .get(membershipId, classId) as { student_id: string } | undefined;
  if (!membership) {
    throw new ManagementRepositoryError(
      "CLASS_MEMBER_NOT_FOUND",
      "That class member is no longer available.",
    );
  }

  const submissionRows = database
    .prepare(
      "SELECT id, upload_batch_id FROM submissions WHERE class_id = ? AND membership_id = ?",
    )
    .all(classId, membershipId) as Array<{
    id: string;
    upload_batch_id: string | null;
  }>;
  const assetRows = database
    .prepare(
      [
        "SELECT asset.storage_key, asset.fallback_storage_key",
        "FROM submission_assets AS asset",
        "JOIN submissions AS submission ON submission.id = asset.submission_id",
        "WHERE submission.class_id = ? AND submission.membership_id = ?",
      ].join(" "),
    )
    .all(classId, membershipId) as Array<{
    storage_key: string | null;
    fallback_storage_key: string | null;
  }>;
  const teachingBriefRows = database
    .prepare(
      [
        "SELECT DISTINCT brief.id, brief.ai_run_id, brief.worked_example_problem_id",
        "FROM teaching_briefs AS brief",
        "JOIN teaching_brief_evidence AS evidence ON evidence.teaching_brief_id = brief.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id",
        "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
        "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
        "JOIN submissions AS submission ON submission.id = answer.submission_id",
        "WHERE brief.class_id = ? AND submission.membership_id = ?",
      ].join(" "),
    )
    .all(classId, membershipId) as Array<{
    id: string;
    ai_run_id: string | null;
    worked_example_problem_id: string | null;
  }>;

  const aiRunIds = new Set<string>();
  const collectAiRunIds = (rows: Array<{ ai_run_id: string | null }>) => {
    for (const row of rows) {
      if (row.ai_run_id) aiRunIds.add(row.ai_run_id);
    }
  };
  collectAiRunIds(
    database
      .prepare(
        [
          "SELECT DISTINCT diagnosis.ai_run_id",
          "FROM diagnoses AS diagnosis",
          "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
          "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
          "JOIN submissions AS submission ON submission.id = answer.submission_id",
          "WHERE submission.class_id = ? AND submission.membership_id = ?",
        ].join(" "),
      )
      .all(classId, membershipId) as Array<{ ai_run_id: string | null }>,
  );
  collectAiRunIds(
    database
      .prepare(
        [
          "SELECT DISTINCT version.ai_run_id",
          "FROM student_model_versions AS version",
          "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = version.hypothesis_id",
          "WHERE hypothesis.class_id = ? AND hypothesis.membership_id = ?",
        ].join(" "),
      )
      .all(classId, membershipId) as Array<{ ai_run_id: string | null }>,
  );
  collectAiRunIds(
    database
      .prepare(
        "SELECT DISTINCT ai_run_id FROM predictions WHERE class_id = ? AND membership_id = ?",
      )
      .all(classId, membershipId) as Array<{ ai_run_id: string | null }>,
  );
  collectAiRunIds(
    database
      .prepare(
        "SELECT DISTINCT ai_run_id FROM worksheets WHERE class_id = ? AND membership_id = ?",
      )
      .all(classId, membershipId) as Array<{ ai_run_id: string | null }>,
  );
  collectAiRunIds(teachingBriefRows);

  const problemIds = new Set<string>();
  const collectProblemIds = (rows: Array<{ problem_id: string | null }>) => {
    for (const row of rows) {
      if (row.problem_id) problemIds.add(row.problem_id);
    }
  };
  collectProblemIds(
    database
      .prepare(
        "SELECT DISTINCT problem_id FROM predictions WHERE class_id = ? AND membership_id = ?",
      )
      .all(classId, membershipId) as Array<{ problem_id: string | null }>,
  );
  collectProblemIds(
    database
      .prepare(
        [
          "SELECT DISTINCT item.problem_id",
          "FROM worksheet_items AS item",
          "JOIN worksheets AS worksheet ON worksheet.id = item.worksheet_id",
          "WHERE worksheet.class_id = ? AND worksheet.membership_id = ?",
        ].join(" "),
      )
      .all(classId, membershipId) as Array<{ problem_id: string | null }>,
  );
  collectProblemIds(
    teachingBriefRows.map((row) => ({
      problem_id: row.worked_example_problem_id,
    })),
  );

  return {
    studentId: membership.student_id,
    storageKeys: [
      ...new Set(
        assetRows.flatMap((row) =>
          [row.storage_key, row.fallback_storage_key].filter(
            (key): key is string => key !== null,
          ),
        ),
      ),
    ],
    submissionIds: submissionRows.map((row) => row.id),
    uploadBatchIds: [
      ...new Set(
        submissionRows.flatMap((row) =>
          row.upload_batch_id ? [row.upload_batch_id] : [],
        ),
      ),
    ],
    aiRunIds: [...aiRunIds],
    problemIds: [...problemIds],
    teachingBriefIds: teachingBriefRows.map((row) => row.id),
  };
}

export function removeClassMember(
  classIdInput: string,
  membershipIdInput: string,
) {
  const classId = entityIdSchema.parse(classIdInput);
  const membershipId = entityIdSchema.parse(membershipIdInput);
  const database = getDatabase();
  const context = getClassMemberRemovalContext(classId, membershipId);
  let studentDeleted = false;

  database.transaction(() => {
    const deleteBrief = database.prepare(
      "DELETE FROM teaching_briefs WHERE id = ? AND class_id = ?",
    );
    for (const briefId of context.teachingBriefIds) {
      deleteBrief.run(briefId, classId);
    }

    const removed = database
      .prepare(
        "DELETE FROM class_memberships WHERE id = ? AND class_id = ?",
      )
      .run(membershipId, classId);
    if (!removed.changes) {
      throw new ManagementRepositoryError(
        "CLASS_MEMBER_NOT_FOUND",
        "That class member is no longer available.",
      );
    }

    studentDeleted = Boolean(
      database
        .prepare(
          [
            "DELETE FROM students WHERE id = ?",
            "AND NOT EXISTS (SELECT 1 FROM class_memberships WHERE student_id = ?)",
          ].join(" "),
        )
        .run(context.studentId, context.studentId).changes,
    );

    const deleteEmptyBatch = database.prepare(
      [
        "DELETE FROM upload_batches WHERE id = ?",
        "AND NOT EXISTS (SELECT 1 FROM submissions WHERE upload_batch_id = ?)",
      ].join(" "),
    );
    for (const batchId of context.uploadBatchIds) {
      deleteEmptyBatch.run(batchId, batchId);
    }

    const deleteUnreferencedRun = database.prepare(
      [
        "DELETE FROM ai_runs WHERE id = ?",
        "AND NOT EXISTS (SELECT 1 FROM diagnosis_run_targets WHERE ai_run_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM diagnoses WHERE ai_run_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM student_model_versions WHERE ai_run_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM predictions WHERE ai_run_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM worksheets WHERE ai_run_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM teaching_briefs WHERE ai_run_id = ?)",
      ].join(" "),
    );
    for (const runId of context.aiRunIds) {
      deleteUnreferencedRun.run(
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
      );
    }

    const deleteUnreferencedProblem = database.prepare(
      [
        "DELETE FROM problems WHERE id = ? AND origin = 'PREDICTION'",
        "AND NOT EXISTS (SELECT 1 FROM assignment_items WHERE problem_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM predictions WHERE problem_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM worksheet_items WHERE problem_id = ?)",
        "AND NOT EXISTS (SELECT 1 FROM teaching_briefs WHERE worked_example_problem_id = ?)",
      ].join(" "),
    );
    for (const problemId of context.problemIds) {
      deleteUnreferencedProblem.run(
        problemId,
        problemId,
        problemId,
        problemId,
        problemId,
      );
    }

    const deleteAuditEvent = database.prepare(
      "DELETE FROM audit_events WHERE class_id = ? AND entity_id = ?",
    );
    for (const entityId of [
      membershipId,
      context.studentId,
      ...context.submissionIds,
    ]) {
      deleteAuditEvent.run(classId, entityId);
    }
  })();

  return {
    classId,
    membershipId,
    studentDeleted,
    storageKeys: context.storageKeys,
  };
}

export function renameAssignment(assignmentIdInput: string, name: string) {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
  const parsed = renameEntityInputSchema.parse({ name });
  const result = getDatabase()
    .prepare(
      "UPDATE assignments SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND archived_at IS NULL AND status <> 'ARCHIVED'",
    )
    .run(parsed.name, assignmentId);
  if (!result.changes) {
    throw new ManagementRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That assignment is no longer available.",
    );
  }
  return { id: assignmentId, name: parsed.name };
}

export function archiveAssignment(assignmentIdInput: string) {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      "UPDATE assignments SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL AND status <> 'ARCHIVED'",
    )
    .run(now, now, assignmentId);
  if (!result.changes) {
    throw new ManagementRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That assignment is no longer available.",
    );
  }
  return { id: assignmentId, archivedAt: now };
}
