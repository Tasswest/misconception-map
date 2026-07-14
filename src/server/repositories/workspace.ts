import "server-only";

import { createHash, randomUUID } from "node:crypto";
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

const diagnosticDomainSchema = z.enum(["ALGEBRA", "FRACTIONS"]);

const answerFormatSchema = z.enum([
  "EXPRESSION",
  "NUMBER",
  "FRACTION",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
]);

type AssignmentStatus = "DRAFT" | "READY" | "ARCHIVED";

export const entityIdSchema = z.string().trim().min(1).max(200);

export const createClassInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    gradeBand: gradeBandSchema,
    schoolYear: z.string().trim().min(1).max(20).nullable().default(null),
    isDemo: z.boolean().default(false),
  })
  .strict();

export const createStudentMembershipInputSchema = z
  .object({
    classId: entityIdSchema,
    displayName: z.string().trim().min(1).max(120),
    externalRef: z.string().trim().min(1).max(120).nullable().default(null),
    rosterCode: z.string().trim().min(1).max(40).nullable().default(null),
    sortOrder: z.number().int().nonnegative().default(0),
    isDemo: z.boolean().default(false),
  })
  .strict();

export const createAssignmentInputSchema = z
  .object({
    classId: entityIdSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).nullable().default(null),
    domain: assignmentDomainSchema,
  })
  .strict();

export const createDiagnosticAssignmentInputSchema = z
  .object({
    classId: entityIdSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).nullable().default(null),
    domain: diagnosticDomainSchema,
    problemPrompt: z.string().trim().min(1).max(4_000),
    correctAnswer: z.string().trim().min(1).max(1_000),
    answerFormat: answerFormatSchema.optional(),
  })
  .strict();

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

export type WorkspaceMembershipRecord = {
  id: string;
  studentId: string;
  displayName: string;
  sortOrder: number;
};

export type DiagnosticAssignmentItemRecord = {
  id: string;
  position: number;
  problemId: string;
  prompt: string;
  correctAnswer: string;
  answerFormat: z.infer<typeof answerFormatSchema>;
};

export type WorkspaceAssignmentRecord = {
  id: string;
  title: string;
  description: string | null;
  domain: z.infer<typeof assignmentDomainSchema>;
  status: AssignmentStatus;
  item: DiagnosticAssignmentItemRecord | null;
  items: DiagnosticAssignmentItemRecord[];
};

export type WorkspaceClassRecord = {
  id: string;
  name: string;
  gradeBand: z.infer<typeof gradeBandSchema>;
  schoolYear: string | null;
  isDemo: boolean;
  memberships: WorkspaceMembershipRecord[];
  assignments: WorkspaceAssignmentRecord[];
};

export type DiagnosticAssignmentRecord = WorkspaceAssignmentRecord & {
  classId: string;
  className: string;
  item: DiagnosticAssignmentItemRecord;
  items: DiagnosticAssignmentItemRecord[];
  memberships: WorkspaceMembershipRecord[];
};

export type CreatedDiagnosticAssignmentRecord = Pick<
  DiagnosticAssignmentRecord,
  "id" | "classId" | "title" | "domain" | "item" | "items"
>;

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

type MembershipRow = {
  id: string;
  class_id: string;
  student_id: string;
  display_name: string;
  sort_order: number;
};

type AssignmentWithItemRow = {
  id: string;
  class_id: string;
  class_name: string;
  title: string;
  description: string | null;
  domain: z.infer<typeof assignmentDomainSchema>;
  status: AssignmentStatus;
  item_id: string | null;
  item_position: number | null;
  problem_id: string | null;
  prompt: string | null;
  correct_answer: string | null;
  answer_format: z.infer<typeof answerFormatSchema> | null;
};

export type WorkspaceRepositoryErrorCode = "CLASS_NOT_FOUND";

export class WorkspaceRepositoryError extends Error {
  readonly code: WorkspaceRepositoryErrorCode;
  readonly status: number;

  constructor(
    code: WorkspaceRepositoryErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "WorkspaceRepositoryError";
    this.code = code;
    this.status = status;
  }
}

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

function mapMembership(row: MembershipRow): WorkspaceMembershipRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    displayName: row.display_name,
    sortOrder: row.sort_order,
  };
}

function mapAssignmentItem(
  row: AssignmentWithItemRow,
): DiagnosticAssignmentItemRecord | null {
  if (
    row.item_id === null ||
    row.item_position === null ||
    row.problem_id === null ||
    row.prompt === null ||
    row.correct_answer === null ||
    row.answer_format === null
  ) {
    return null;
  }

  return {
    id: row.item_id,
    position: row.item_position,
    problemId: row.problem_id,
    prompt: row.prompt,
    correctAnswer: row.correct_answer,
    answerFormat: row.answer_format,
  };
}

function mapWorkspaceAssignment(
  row: AssignmentWithItemRow,
): WorkspaceAssignmentRecord {
  const item = mapAssignmentItem(row);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    domain: row.domain,
    status: row.status,
    item,
    items: item ? [item] : [],
  };
}

function listActiveMembershipRows(classId?: string): MembershipRow[] {
  const parameters: string[] = [];
  const classFilter = classId === undefined ? "" : "AND membership.class_id = ?";

  if (classId !== undefined) {
    parameters.push(classId);
  }

  return getDatabase()
    .prepare(
      [
        "SELECT membership.id, membership.class_id, membership.student_id,",
        "student.display_name, membership.sort_order",
        "FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id",
        "JOIN classes AS class ON class.id = membership.class_id",
        "WHERE class.archived_at IS NULL",
        "AND membership.archived_at IS NULL",
        "AND student.archived_at IS NULL",
        classFilter,
        "ORDER BY membership.sort_order, student.display_name COLLATE NOCASE, membership.id",
      ].join(" "),
    )
    .all(...parameters) as MembershipRow[];
}

function normalizeProblemContent(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function problemContentHash(
  domain: z.infer<typeof diagnosticDomainSchema>,
  prompt: string,
) {
  const canonicalContent = JSON.stringify({
    domain,
    prompt: normalizeProblemContent(prompt),
  });

  return createHash("sha256").update(canonicalContent, "utf8").digest("hex");
}

function defaultAnswerFormat(
  domain: z.infer<typeof diagnosticDomainSchema>,
): z.infer<typeof answerFormatSchema> {
  return domain === "ALGEBRA" ? "EXPRESSION" : "FRACTION";
}

function assertActiveClass(classId: string) {
  const activeClass = getDatabase()
    .prepare("SELECT 1 FROM classes WHERE id = ? AND archived_at IS NULL")
    .get(classId);

  if (activeClass === undefined) {
    throw new WorkspaceRepositoryError(
      "CLASS_NOT_FOUND",
      "The selected class is unavailable.",
      404,
    );
  }
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

export function listWorkspaceOverview(): WorkspaceClassRecord[] {
  const classes = listClasses();
  const memberships = listActiveMembershipRows();
  const assignments = getDatabase()
    .prepare(
      [
        "SELECT assignment.id, assignment.class_id, class.name AS class_name,",
        "assignment.title, assignment.description, assignment.domain, assignment.status,",
        "item.id AS item_id, item.position AS item_position, problem.id AS problem_id, problem.prompt,",
        "problem.correct_answer, problem.answer_format",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id",
        "LEFT JOIN assignment_items AS item",
        "ON item.assignment_id = assignment.id",
        "AND item.position = (",
        "SELECT MIN(first_item.position) FROM assignment_items AS first_item",
        "WHERE first_item.assignment_id = assignment.id",
        ")",
        "LEFT JOIN problems AS problem ON problem.id = item.problem_id",
        "WHERE class.archived_at IS NULL",
        "AND assignment.archived_at IS NULL",
        "AND assignment.status = 'READY'",
        "ORDER BY assignment.created_at DESC, assignment.title COLLATE NOCASE",
      ].join(" "),
    )
    .all() as AssignmentWithItemRow[];

  const overview = classes.map<WorkspaceClassRecord>((classRecord) => ({
    id: classRecord.id,
    name: classRecord.name,
    gradeBand: classRecord.gradeBand,
    schoolYear: classRecord.schoolYear,
    isDemo: classRecord.isDemo,
    memberships: [],
    assignments: [],
  }));
  const classesById = new Map(overview.map((entry) => [entry.id, entry]));

  for (const membership of memberships) {
    classesById.get(membership.class_id)?.memberships.push(
      mapMembership(membership),
    );
  }

  for (const assignment of assignments) {
    classesById.get(assignment.class_id)?.assignments.push(
      mapWorkspaceAssignment(assignment),
    );
  }

  return overview;
}

export function getDiagnosticAssignment(
  assignmentId: string,
): DiagnosticAssignmentRecord | null {
  const parsedAssignmentId = entityIdSchema.parse(assignmentId);
  const rows = getDatabase()
    .prepare(
      [
        "SELECT assignment.id, assignment.class_id, class.name AS class_name,",
        "assignment.title, assignment.description, assignment.domain, assignment.status,",
        "item.id AS item_id, item.position AS item_position, problem.id AS problem_id, problem.prompt,",
        "problem.correct_answer, problem.answer_format",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id",
        "JOIN assignment_items AS item",
        "ON item.assignment_id = assignment.id",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "WHERE assignment.id = ?",
        "AND class.archived_at IS NULL",
        "AND assignment.archived_at IS NULL",
        "AND assignment.status != 'ARCHIVED'",
        "ORDER BY item.position",
      ].join(" "),
    )
    .all(parsedAssignmentId) as AssignmentWithItemRow[];

  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  const items = rows.flatMap((candidate) => {
    const mapped = mapAssignmentItem(candidate);
    return mapped ? [mapped] : [];
  });
  const item = items[0];
  if (!item) {
    return null;
  }

  return {
    ...mapWorkspaceAssignment(row),
    classId: row.class_id,
    className: row.class_name,
    item,
    items,
    memberships: listActiveMembershipRows(row.class_id).map(mapMembership),
  };
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
    assertActiveClass(parsed.classId);
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
    id: membershipId,
    studentId,
    membershipId,
    classId: parsed.classId,
    displayName: parsed.displayName,
    sortOrder: parsed.sortOrder,
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

export function createDiagnosticAssignment(
  input: z.input<typeof createDiagnosticAssignmentInputSchema>,
): CreatedDiagnosticAssignmentRecord {
  const parsed = createDiagnosticAssignmentInputSchema.parse(input);
  const assignmentId = randomUUID();
  const problemId = randomUUID();
  const itemId = randomUUID();
  const answerFormat =
    parsed.answerFormat ?? defaultAnswerFormat(parsed.domain);
  const canonicalCorrectAnswer = normalizeProblemContent(parsed.correctAnswer);
  const contentHash = problemContentHash(parsed.domain, parsed.problemPrompt);
  const database = getDatabase();

  database.transaction(() => {
    assertActiveClass(parsed.classId);
    database
      .prepare(
        [
          "INSERT INTO assignments",
          "(id, class_id, title, description, domain, status)",
          "VALUES (?, ?, ?, ?, ?, 'READY')",
        ].join(" "),
      )
      .run(
        assignmentId,
        parsed.classId,
        parsed.title,
        parsed.description,
        parsed.domain,
      );
    database
      .prepare(
        [
          "INSERT INTO problems",
          "(id, class_id, domain, prompt, answer_format, correct_answer,",
          "canonical_correct_answer, origin, content_hash)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, 'ASSIGNMENT', ?)",
        ].join(" "),
      )
      .run(
        problemId,
        parsed.classId,
        parsed.domain,
        parsed.problemPrompt,
        answerFormat,
        parsed.correctAnswer,
        canonicalCorrectAnswer,
        contentHash,
      );
    database
      .prepare(
        [
          "INSERT INTO assignment_items",
          "(id, class_id, assignment_id, problem_id, position, points, is_required)",
          "VALUES (?, ?, ?, ?, 1, 1, 1)",
        ].join(" "),
      )
      .run(itemId, parsed.classId, assignmentId, problemId);
  })();

  const item = {
    id: itemId,
    position: 1,
    problemId,
    prompt: parsed.problemPrompt,
    correctAnswer: parsed.correctAnswer,
    answerFormat,
  };
  return {
    id: assignmentId,
    classId: parsed.classId,
    title: parsed.title,
    domain: parsed.domain,
    item,
    items: [item],
  };
}
