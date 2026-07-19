import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getDatabase } from "@/lib/db";
import { entityIdSchema } from "@/server/repositories/workspace";

/**
 * The gradebook is deliberately separate from the diagnosis engine. A grade is
 * a teacher-owned fact recorded alongside — never derived from — the AI
 * misconception analysis. Storing it here keeps the "no automatic grading"
 * guarantee intact while still letting a teacher who marks the paper keep the
 * two side by side.
 */

export const setExamGradeInputSchema = z
  .object({
    membershipId: entityIdSchema,
    score: z.number().finite().min(0).max(100_000),
    maxScore: z.number().finite().gt(0).max(100_000),
  })
  .strict()
  .refine((value) => value.score <= value.maxScore, {
    message: "A score cannot be higher than the paper's maximum.",
    path: ["score"],
  });

export class GradebookRepositoryError extends Error {
  readonly code: "ASSIGNMENT_NOT_FOUND" | "CLASS_MEMBER_NOT_FOUND";
  readonly status = 404;

  constructor(code: GradebookRepositoryError["code"], message: string) {
    super(message);
    this.name = "GradebookRepositoryError";
    this.code = code;
  }
}

export type ExamGrade = {
  score: number;
  maxScore: number;
  percent: number;
  gradedAt: string;
};

export type AssignmentGradeStudent = {
  membershipId: string;
  studentName: string;
  grade: ExamGrade | null;
};

export type AssignmentGrades = {
  assignment: {
    id: string;
    title: string;
    classId: string;
    className: string;
  };
  studentCount: number;
  gradedCount: number;
  stats: {
    meanPercent: number;
    highestPercent: number;
    lowestPercent: number;
  } | null;
  students: AssignmentGradeStudent[];
};

type AssignmentRow = {
  id: string;
  title: string;
  class_id: string;
  class_name: string;
};

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function loadReadyAssignment(assignmentId: string): AssignmentRow {
  const assignment = getDatabase()
    .prepare(
      [
        "SELECT assignment.id, assignment.title, assignment.class_id, class.name AS class_name",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "WHERE assignment.id = ? AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
      ].join(" "),
    )
    .get(assignmentId) as AssignmentRow | undefined;
  if (!assignment) {
    throw new GradebookRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That exam is no longer available.",
    );
  }
  return assignment;
}

export function getAssignmentGrades(
  assignmentIdInput: string,
): AssignmentGrades | null {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
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

  const rows = database
    .prepare(
      [
        "SELECT membership.id AS membership_id, student.display_name,",
        "grade.score, grade.max_score, grade.graded_at",
        "FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "LEFT JOIN exam_grades AS grade",
        "ON grade.membership_id = membership.id AND grade.assignment_id = ?",
        "WHERE membership.class_id = ? AND membership.archived_at IS NULL",
        "ORDER BY membership.sort_order, student.display_name COLLATE NOCASE",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as Array<{
    membership_id: string;
    display_name: string;
    score: number | null;
    max_score: number | null;
    graded_at: string | null;
  }>;

  const students: AssignmentGradeStudent[] = rows.map((row) => ({
    membershipId: row.membership_id,
    studentName: row.display_name,
    grade:
      row.score !== null && row.max_score !== null && row.graded_at !== null
        ? {
            score: row.score,
            maxScore: row.max_score,
            percent: roundPercent((row.score / row.max_score) * 100),
            gradedAt: row.graded_at,
          }
        : null,
  }));

  const graded = students.flatMap((student) =>
    student.grade ? [student.grade.percent] : [],
  );
  const stats =
    graded.length > 0
      ? {
          meanPercent: roundPercent(
            graded.reduce((sum, percent) => sum + percent, 0) / graded.length,
          ),
          highestPercent: Math.max(...graded),
          lowestPercent: Math.min(...graded),
        }
      : null;

  // Students ranked highest score first; ungraded papers sink to the bottom so
  // the teacher sees who still needs marking without losing the ranking.
  students.sort((left, right) => {
    if (left.grade && right.grade) {
      return (
        right.grade.percent - left.grade.percent ||
        left.studentName.localeCompare(right.studentName)
      );
    }
    if (left.grade) return -1;
    if (right.grade) return 1;
    return left.studentName.localeCompare(right.studentName);
  });

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      classId: assignment.class_id,
      className: assignment.class_name,
    },
    studentCount: students.length,
    gradedCount: graded.length,
    stats,
    students,
  };
}

export type ClassGradebook = {
  class: {
    id: string;
    name: string;
    schoolName: string | null;
    schoolYear: string | null;
    gradeBand: string;
  };
  stats: {
    meanPercent: number;
    highestPercent: number;
    lowestPercent: number;
  } | null;
  gradedCount: number;
  students: Array<{
    membershipId: string;
    studentName: string;
    examsGraded: number;
    overallPercent: number | null;
  }>;
  assignments: Array<{
    id: string;
    title: string;
    createdAt: string;
    studentCount: number;
    gradedCount: number;
    meanPercent: number | null;
  }>;
};

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getClassGradebook(
  classIdInput: string,
): ClassGradebook | null {
  const classId = entityIdSchema.parse(classIdInput);
  const database = getDatabase();
  const classRow = database
    .prepare(
      [
        "SELECT id, name, school_name AS schoolName, school_year AS schoolYear, grade_band AS gradeBand",
        "FROM classes WHERE id = ? AND archived_at IS NULL",
      ].join(" "),
    )
    .get(classId) as
    | {
        id: string;
        name: string;
        schoolName: string | null;
        schoolYear: string | null;
        gradeBand: string;
      }
    | undefined;
  if (!classRow) return null;

  const memberships = database
    .prepare(
      [
        "SELECT membership.id, student.display_name",
        "FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "WHERE membership.class_id = ? AND membership.archived_at IS NULL",
        "ORDER BY membership.sort_order, student.display_name COLLATE NOCASE",
      ].join(" "),
    )
    .all(classId) as Array<{ id: string; display_name: string }>;

  const assignmentRows = database
    .prepare(
      [
        "SELECT id, title, created_at AS createdAt FROM assignments",
        "WHERE class_id = ? AND status = 'READY' AND archived_at IS NULL",
        "ORDER BY created_at DESC, title COLLATE NOCASE",
      ].join(" "),
    )
    .all(classId) as Array<{ id: string; title: string; createdAt: string }>;

  const gradeRows = database
    .prepare(
      [
        "SELECT assignment_id, membership_id, score, max_score",
        "FROM exam_grades WHERE class_id = ?",
      ].join(" "),
    )
    .all(classId) as Array<{
    assignment_id: string;
    membership_id: string;
    score: number;
    max_score: number;
  }>;

  const percentsByMembership = new Map<string, number[]>();
  const percentsByAssignment = new Map<string, number[]>();
  const allPercents: number[] = [];
  for (const row of gradeRows) {
    const percent = (row.score / row.max_score) * 100;
    allPercents.push(percent);
    const byMember = percentsByMembership.get(row.membership_id) ?? [];
    byMember.push(percent);
    percentsByMembership.set(row.membership_id, byMember);
    const byAssignment = percentsByAssignment.get(row.assignment_id) ?? [];
    byAssignment.push(percent);
    percentsByAssignment.set(row.assignment_id, byAssignment);
  }

  const students = memberships
    .map((membership) => {
      const percents = percentsByMembership.get(membership.id) ?? [];
      return {
        membershipId: membership.id,
        studentName: membership.display_name,
        examsGraded: percents.length,
        overallPercent:
          percents.length > 0 ? roundPercent(mean(percents)) : null,
      };
    })
    .sort((left, right) => {
      if (left.overallPercent !== null && right.overallPercent !== null) {
        return (
          right.overallPercent - left.overallPercent ||
          left.studentName.localeCompare(right.studentName)
        );
      }
      if (left.overallPercent !== null) return -1;
      if (right.overallPercent !== null) return 1;
      return left.studentName.localeCompare(right.studentName);
    });

  const assignments = assignmentRows.map((assignment) => {
    const percents = percentsByAssignment.get(assignment.id) ?? [];
    return {
      id: assignment.id,
      title: assignment.title,
      createdAt: assignment.createdAt,
      studentCount: memberships.length,
      gradedCount: percents.length,
      meanPercent: percents.length > 0 ? roundPercent(mean(percents)) : null,
    };
  });

  return {
    class: {
      id: classRow.id,
      name: classRow.name,
      schoolName: classRow.schoolName,
      schoolYear: classRow.schoolYear,
      gradeBand: classRow.gradeBand,
    },
    stats:
      allPercents.length > 0
        ? {
            meanPercent: roundPercent(mean(allPercents)),
            highestPercent: roundPercent(Math.max(...allPercents)),
            lowestPercent: roundPercent(Math.min(...allPercents)),
          }
        : null,
    gradedCount: allPercents.length,
    students,
    assignments,
  };
}

export type StudentGradebook = {
  class: { id: string; name: string };
  student: { membershipId: string; studentName: string };
  overallPercent: number | null;
  exams: Array<{
    assignmentId: string;
    title: string;
    createdAt: string;
    grade: ExamGrade | null;
    classAveragePercent: number | null;
  }>;
};

export function getStudentGradebook(
  classIdInput: string,
  membershipIdInput: string,
): StudentGradebook | null {
  const classId = entityIdSchema.parse(classIdInput);
  const membershipId = entityIdSchema.parse(membershipIdInput);
  const database = getDatabase();

  const membership = database
    .prepare(
      [
        "SELECT membership.id, student.display_name, class.id AS class_id, class.name AS class_name",
        "FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "JOIN classes AS class ON class.id = membership.class_id AND class.archived_at IS NULL",
        "WHERE membership.id = ? AND membership.class_id = ? AND membership.archived_at IS NULL",
      ].join(" "),
    )
    .get(membershipId, classId) as
    | {
        id: string;
        display_name: string;
        class_id: string;
        class_name: string;
      }
    | undefined;
  if (!membership) return null;

  const assignmentRows = database
    .prepare(
      [
        "SELECT id, title, created_at AS createdAt FROM assignments",
        "WHERE class_id = ? AND status = 'READY' AND archived_at IS NULL",
        "ORDER BY created_at DESC, title COLLATE NOCASE",
      ].join(" "),
    )
    .all(classId) as Array<{ id: string; title: string; createdAt: string }>;

  const gradeRows = database
    .prepare(
      "SELECT assignment_id, membership_id, score, max_score FROM exam_grades WHERE class_id = ?",
    )
    .all(classId) as Array<{
    assignment_id: string;
    membership_id: string;
    score: number;
    max_score: number;
  }>;

  const classPercentsByAssignment = new Map<string, number[]>();
  const studentGradeByAssignment = new Map<
    string,
    { score: number; max_score: number }
  >();
  for (const row of gradeRows) {
    const percent = (row.score / row.max_score) * 100;
    const list = classPercentsByAssignment.get(row.assignment_id) ?? [];
    list.push(percent);
    classPercentsByAssignment.set(row.assignment_id, list);
    if (row.membership_id === membershipId) {
      studentGradeByAssignment.set(row.assignment_id, {
        score: row.score,
        max_score: row.max_score,
      });
    }
  }

  const exams = assignmentRows.map((assignment) => {
    const own = studentGradeByAssignment.get(assignment.id);
    const classPercents = classPercentsByAssignment.get(assignment.id) ?? [];
    return {
      assignmentId: assignment.id,
      title: assignment.title,
      createdAt: assignment.createdAt,
      grade: own
        ? {
            score: own.score,
            maxScore: own.max_score,
            percent: roundPercent((own.score / own.max_score) * 100),
            gradedAt: "",
          }
        : null,
      classAveragePercent:
        classPercents.length > 0 ? roundPercent(mean(classPercents)) : null,
    };
  });

  const ownPercents = exams.flatMap((exam) =>
    exam.grade ? [exam.grade.percent] : [],
  );

  return {
    class: { id: membership.class_id, name: membership.class_name },
    student: {
      membershipId: membership.id,
      studentName: membership.display_name,
    },
    overallPercent:
      ownPercents.length > 0 ? roundPercent(mean(ownPercents)) : null,
    exams,
  };
}

export function setExamGrade(
  assignmentIdInput: string,
  input: z.input<typeof setExamGradeInputSchema>,
): ExamGrade {
  const assignmentId = entityIdSchema.parse(assignmentIdInput);
  const parsed = setExamGradeInputSchema.parse(input);
  const database = getDatabase();
  const assignment = loadReadyAssignment(assignmentId);

  const membership = database
    .prepare(
      [
        "SELECT membership.id FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "WHERE membership.id = ? AND membership.class_id = ? AND membership.archived_at IS NULL",
      ].join(" "),
    )
    .get(parsed.membershipId, assignment.class_id) as
    | { id: string }
    | undefined;
  if (!membership) {
    throw new GradebookRepositoryError(
      "CLASS_MEMBER_NOT_FOUND",
      "That student is no longer in this class.",
    );
  }

  const now = new Date().toISOString();
  database
    .prepare(
      [
        "INSERT INTO exam_grades",
        "(id, class_id, assignment_id, membership_id, score, max_score, graded_at, created_at, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "ON CONFLICT (assignment_id, membership_id) DO UPDATE SET",
        "score = excluded.score, max_score = excluded.max_score,",
        "graded_at = excluded.graded_at, updated_at = excluded.updated_at",
      ].join(" "),
    )
    .run(
      randomUUID(),
      assignment.class_id,
      assignment.id,
      parsed.membershipId,
      parsed.score,
      parsed.maxScore,
      now,
      now,
      now,
    );

  return {
    score: parsed.score,
    maxScore: parsed.maxScore,
    percent: roundPercent((parsed.score / parsed.maxScore) * 100),
    gradedAt: now,
  };
}
