import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { assignmentDomainSchema } from "@/domain/contracts";
import { getDatabase } from "@/lib/db";

const gradeBandSchema = z.enum([
  "GRADE_5",
  "GRADE_6",
  "GRADE_7",
  "GRADE_8",
  "MIXED_5_8",
]);

export const createClassInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  gradeBand: gradeBandSchema,
  schoolYear: z.string().trim().min(1).max(20).nullable().default(null),
  isDemo: z.boolean().default(false),
});

export const createStudentMembershipInputSchema = z.object({
  classId: z.string().min(1),
  displayName: z.string().trim().min(1).max(120),
  externalRef: z.string().trim().min(1).max(120).nullable().default(null),
  rosterCode: z.string().trim().min(1).max(40).nullable().default(null),
  sortOrder: z.number().int().nonnegative().default(0),
  isDemo: z.boolean().default(false),
});

export const createAssignmentInputSchema = z.object({
  classId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable().default(null),
  domain: assignmentDomainSchema,
});

export type ClassRecord = {
  id: string;
  name: string;
  gradeBand: z.infer<typeof gradeBandSchema>;
  schoolYear: string | null;
  isDemo: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ClassRow = {
  id: string;
  name: string;
  grade_band: z.infer<typeof gradeBandSchema>;
  school_year: string | null;
  is_demo: 0 | 1;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapClass(row: ClassRow): ClassRecord {
  return {
    id: row.id,
    name: row.name,
    gradeBand: row.grade_band,
    schoolYear: row.school_year,
    isDemo: row.is_demo === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listClasses(): ClassRecord[] {
  const rows = getDatabase()
    .prepare(
      [
        "SELECT id, name, grade_band, school_year, is_demo, archived_at, created_at, updated_at",
        "FROM classes",
        "WHERE archived_at IS NULL",
        "ORDER BY is_demo DESC, name COLLATE NOCASE",
      ].join(" "),
    )
    .all() as ClassRow[];

  return rows.map(mapClass);
}

export function createClass(input: z.input<typeof createClassInputSchema>) {
  const parsed = createClassInputSchema.parse(input);
  const id = randomUUID();
  const database = getDatabase();

  database
    .prepare(
      "INSERT INTO classes (id, name, grade_band, school_year, is_demo) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      id,
      parsed.name,
      parsed.gradeBand,
      parsed.schoolYear,
      parsed.isDemo ? 1 : 0,
    );

  const row = database
    .prepare(
      "SELECT id, name, grade_band, school_year, is_demo, archived_at, created_at, updated_at FROM classes WHERE id = ?",
    )
    .get(id) as ClassRow;

  return mapClass(row);
}

export function createStudentMembership(
  input: z.input<typeof createStudentMembershipInputSchema>,
) {
  const parsed = createStudentMembershipInputSchema.parse(input);
  const studentId = randomUUID();
  const membershipId = randomUUID();
  const database = getDatabase();

  database.transaction(() => {
    database
      .prepare(
        "INSERT INTO students (id, display_name, external_ref, is_demo) VALUES (?, ?, ?, ?)",
      )
      .run(
        studentId,
        parsed.displayName,
        parsed.externalRef,
        parsed.isDemo ? 1 : 0,
      );
    database
      .prepare(
        "INSERT INTO class_memberships (id, class_id, student_id, roster_code, sort_order) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        membershipId,
        parsed.classId,
        studentId,
        parsed.rosterCode,
        parsed.sortOrder,
      );
  })();

  return {
    studentId,
    membershipId,
    classId: parsed.classId,
    displayName: parsed.displayName,
  };
}

export function createAssignment(
  input: z.input<typeof createAssignmentInputSchema>,
) {
  const parsed = createAssignmentInputSchema.parse(input);
  const id = randomUUID();

  getDatabase()
    .prepare(
      "INSERT INTO assignments (id, class_id, title, description, domain) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      id,
      parsed.classId,
      parsed.title,
      parsed.description,
      parsed.domain,
    );

  return { id, ...parsed, status: "DRAFT" as const };
}
