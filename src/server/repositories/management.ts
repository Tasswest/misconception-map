import "server-only";

import { z } from "zod";

import { getDatabase } from "@/lib/db";
import { entityIdSchema } from "@/server/repositories/workspace";

export const renameEntityInputSchema = z
  .object({ name: z.string().trim().min(1).max(160) })
  .strict();

export const archiveEntityInputSchema = z
  .object({ action: z.literal("ARCHIVE") })
  .strict();

export const classMutationInputSchema = z.union([
  renameEntityInputSchema,
  archiveEntityInputSchema,
]);

export const assignmentMutationInputSchema = z.union([
  renameEntityInputSchema,
  archiveEntityInputSchema,
]);

export class ManagementRepositoryError extends Error {
  readonly code: "CLASS_NOT_FOUND" | "ASSIGNMENT_NOT_FOUND";
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
  gradeBand: string;
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
  createdAt: string;
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
  return getDatabase()
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
          ) AS needsReviewCount
        FROM assignments AS assignment
        JOIN classes AS class ON class.id = assignment.class_id
        WHERE class.archived_at IS NULL
          AND assignment.archived_at IS NULL
          AND assignment.status <> 'ARCHIVED'
        ORDER BY class.is_demo DESC, assignment.created_at DESC, assignment.title COLLATE NOCASE
      `,
    )
    .all() as ManagedAssignment[];
}

export function renameClass(classIdInput: string, name: string) {
  const classId = entityIdSchema.parse(classIdInput);
  const parsed = renameEntityInputSchema.parse({ name });
  const result = getDatabase()
    .prepare(
      "UPDATE classes SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND archived_at IS NULL",
    )
    .run(parsed.name, classId);
  if (!result.changes) {
    throw new ManagementRepositoryError(
      "CLASS_NOT_FOUND",
      "That class is no longer available.",
    );
  }
  return { id: classId, name: parsed.name };
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
