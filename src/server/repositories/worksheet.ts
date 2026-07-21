import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import {
  confirmedWorksheetExerciseSchema,
  worksheetExtractionAIOutputSchema,
  worksheetExerciseSchema,
  type WorksheetExtraction,
} from "@/domain/worksheet-extraction";
import { getDatabase } from "@/lib/db";

const idSchema = z.string().trim().min(1).max(200);

function parseStoredExercises(rawJson: string) {
  const raw = JSON.parse(rawJson) as unknown;
  if (!Array.isArray(raw)) return z.array(worksheetExerciseSchema).parse(raw);
  const upgraded = raw.map((exercise) => {
    if (!exercise || typeof exercise !== "object") return exercise;
    const record = exercise as Record<string, unknown>;
    const questions = Array.isArray(record.questions)
      ? record.questions.map((question) => {
          if (!question || typeof question !== "object") return question;
          const questionRecord = question as Record<string, unknown>;
          return {
            ...questionRecord,
            printedPoints:
              typeof questionRecord.printedPoints === "number"
                ? questionRecord.printedPoints
                : null,
            inTaxonomyScope:
              typeof questionRecord.inTaxonomyScope === "boolean"
                ? questionRecord.inTaxonomyScope
                : questionRecord.domain === "ALGEBRA" ||
                    questionRecord.domain === "FRACTIONS",
          };
        })
      : record.questions;
    return { ...record, questions };
  });
  return z.array(worksheetExerciseSchema).parse(upgraded);
}

export const confirmWorksheetInputSchema = z
  .object({
    exercises: z.array(confirmedWorksheetExerciseSchema).min(1).max(30),
  })
  .strict()
  .superRefine((input, context) => {
    const questionCount = input.exercises.reduce(
      (count, exercise) => count + exercise.questions.length,
      0,
    );
    if (questionCount > 60) {
      context.addIssue({
        code: "custom",
        message: "A worksheet can contain at most 60 questions.",
        path: ["exercises"],
      });
    }
  });

type AssignmentRow = {
  id: string;
  title: string;
  class_id: string;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  status: "DRAFT" | "READY" | "ARCHIVED";
};

export class WorksheetRepositoryError extends Error {
  readonly code:
    | "ASSIGNMENT_NOT_FOUND"
    | "ASSIGNMENT_NOT_DRAFT"
    | "ASSIGNMENT_SOURCE_EXISTS"
    | "ASSIGNMENT_SOURCE_MISSING"
    | "DOMAIN_MISMATCH";

  constructor(code: WorksheetRepositoryError["code"], message: string) {
    super(message);
    this.name = "WorksheetRepositoryError";
    this.code = code;
  }
}

function getAssignmentRow(assignmentId: string) {
  const id = idSchema.parse(assignmentId);
  const row = getDatabase()
    .prepare(
      [
        "SELECT assignment.id, assignment.title, assignment.class_id, assignment.domain, assignment.status",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "WHERE assignment.id = ? AND assignment.archived_at IS NULL",
      ].join(" "),
    )
    .get(id) as AssignmentRow | undefined;
  if (!row) {
    throw new WorksheetRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That assignment is no longer available.",
    );
  }
  return row;
}

export function getDraftWorksheetSetup(assignmentId: string) {
  const assignment = getAssignmentRow(assignmentId);
  if (assignment.status !== "DRAFT") return null;
  const extraction = getDatabase()
    .prepare(
      [
        "SELECT source.status, extraction.overall_confidence, extraction.exercises_json",
        "FROM assignment_sources AS source",
        "JOIN assignment_source_extractions AS extraction ON extraction.source_id = source.id",
        "WHERE source.assignment_id = ? AND source.class_id = ?",
      ].join(" "),
    )
    .get(assignment.id, assignment.class_id) as
    | {
        status: "EXTRACTED" | "NEEDS_REVIEW";
        overall_confidence: number;
        exercises_json: string;
      }
    | undefined;
  return {
    id: assignment.id,
    classId: assignment.class_id,
    title: assignment.title,
    domain: assignment.domain,
    review: extraction
      ? {
          assignmentId: assignment.id,
          overallConfidence: extraction.overall_confidence,
          needsReview: extraction.status === "NEEDS_REVIEW",
          exercises: parseStoredExercises(extraction.exercises_json).map(
            (exercise) => ({
              ...exercise,
              questions: exercise.questions.map((question) => ({
                ...question,
                points: question.printedPoints ?? 1,
              })),
            }),
          ),
        }
      : null,
  };
}

export type DraftWorksheetSetup = NonNullable<
  ReturnType<typeof getDraftWorksheetSetup>
>;

export function getDraftWorksheetAssignment(assignmentId: string) {
  const row = getAssignmentRow(assignmentId);
  if (row.status !== "DRAFT") {
    throw new WorksheetRepositoryError(
      "ASSIGNMENT_NOT_DRAFT",
      "This assignment worksheet has already been confirmed.",
    );
  }
  return {
    id: row.id,
    classId: row.class_id,
    domain: row.domain,
  };
}

type ExtractionRun = {
  result: WorksheetExtraction;
  inputHash: string;
  outputHash: string;
  responseId: string;
  modelName: string;
  promptVersion: string;
  schemaVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  cacheHit: boolean;
};

export function startWorksheetExtractionAttempt(input: {
  assignmentId: string;
  sourceKind: "TYPED" | "IMAGE" | "PDF";
  originalFilename: string | null;
  pageCount: number | null;
  inputHash: string;
  modelName: string;
  promptVersion: string;
  schemaVersion: string;
}) {
  const assignment = getDraftWorksheetAssignment(input.assignmentId);
  const attemptId = randomUUID();
  getDatabase()
    .prepare(
      [
        "INSERT INTO worksheet_extraction_attempts",
        "(id, assignment_id, source_kind, original_filename, page_count, input_hash,",
        "model_name, prompt_version, schema_version, status)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING')",
      ].join(" "),
    )
    .run(
      attemptId,
      assignment.id,
      input.sourceKind,
      input.originalFilename,
      input.pageCount,
      z.string().regex(/^[a-f0-9]{64}$/).parse(input.inputHash),
      input.modelName,
      input.promptVersion,
      input.schemaVersion,
    );
  return attemptId;
}

export function completeWorksheetExtractionAttempt(input: {
  attemptId: string;
  status: "SUCCEEDED" | "FAILED";
  cacheHit: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}) {
  const result = getDatabase()
    .prepare(
      [
        "UPDATE worksheet_extraction_attempts SET status = ?, cache_hit = ?,",
        "error_code = ?, error_message = ?, input_tokens = ?, output_tokens = ?,",
        "latency_ms = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        "WHERE id = ? AND status = 'RUNNING'",
      ].join(" "),
    )
    .run(
      input.status,
      input.cacheHit ? 1 : 0,
      input.errorCode,
      input.errorMessage?.slice(0, 500) ?? null,
      input.inputTokens,
      input.outputTokens,
      Math.max(0, Math.round(input.latencyMs)),
      idSchema.parse(input.attemptId),
    );
  if (result.changes !== 1) {
    throw new Error("Worksheet extraction attempt is already complete or missing.");
  }
}

export function getCachedWorksheetExtractionRun(inputHash: string) {
  const parsedHash = z.string().regex(/^[a-f0-9]{64}$/).parse(inputHash);
  const row = getDatabase()
    .prepare(
      [
        "SELECT model_name, prompt_version, schema_version, openai_response_id, output_hash,",
        "overall_confidence, exercises_json, source_summary, input_tokens, output_tokens",
        "FROM assignment_source_extractions WHERE input_hash = ?",
        "ORDER BY created_at DESC, id DESC LIMIT 1",
      ].join(" "),
    )
    .get(parsedHash) as
    | {
        model_name: string;
        prompt_version: string;
        schema_version: string;
        openai_response_id: string;
        output_hash: string;
        overall_confidence: number;
        exercises_json: string;
        source_summary: string;
        input_tokens: number | null;
        output_tokens: number | null;
      }
    | undefined;
  if (!row) return null;
  const result = worksheetExtractionAIOutputSchema.parse({
    sourceSummary: row.source_summary,
    overallConfidence: row.overall_confidence,
    exercises: parseStoredExercises(row.exercises_json),
  });
  return {
    result,
    inputHash: parsedHash,
    outputHash: row.output_hash,
    responseId: row.openai_response_id,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    cacheHit: true,
  } satisfies ExtractionRun;
}

type WorksheetSource =
  | { sourceKind: "TYPED"; sourceText: string }
  | {
      sourceKind: "IMAGE";
      bytes: Buffer;
      originalFilename: string;
      mediaType: "image/webp";
      sha256: string;
      width: number;
      height: number;
      preprocessingVersion: string;
    }
  | {
      sourceKind: "PDF";
      bytes: Buffer;
      originalFilename: string;
      mediaType: "application/pdf";
      sha256: string;
      preprocessingVersion: string;
    };

export function saveWorksheetExtraction(input: {
  assignmentId: string;
  source: WorksheetSource;
  run: ExtractionRun;
}) {
  const assignment = getDraftWorksheetAssignment(input.assignmentId);
  const extraction = worksheetExtractionAIOutputSchema.parse(input.run.result);
  const sourceId = randomUUID();
  const extractionId = randomUUID();
  const needsReview =
    extraction.overallConfidence < 0.72 ||
    extraction.exercises.some((exercise) =>
      exercise.questions.some(
        (question) =>
          question.extractionConfidence < 0.72 ||
          question.answerConfidence < 0.72 ||
          question.reviewNote !== null,
      ),
    );
  const database = getDatabase();

  database.transaction(() => {
    getDraftWorksheetAssignment(input.assignmentId);
    const existing = database
      .prepare("SELECT 1 FROM assignment_sources WHERE assignment_id = ?")
      .get(input.assignmentId);
    if (existing) {
      throw new WorksheetRepositoryError(
        "ASSIGNMENT_SOURCE_EXISTS",
        "This draft already has an extracted worksheet.",
      );
    }

    database
      .prepare(
        [
          "INSERT INTO assignment_sources",
          "(id, class_id, assignment_id, source_kind, source_text, source_bytes, original_filename,",
          "media_type, sha256, width, height, preprocessing_version, status)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        sourceId,
        assignment.classId,
        assignment.id,
        input.source.sourceKind,
        input.source.sourceKind === "TYPED" ? input.source.sourceText : null,
        input.source.sourceKind !== "TYPED" ? input.source.bytes : null,
        input.source.sourceKind !== "TYPED"
          ? input.source.originalFilename
          : null,
        input.source.sourceKind !== "TYPED" ? input.source.mediaType : null,
        input.source.sourceKind !== "TYPED" ? input.source.sha256 : null,
        input.source.sourceKind === "IMAGE" ? input.source.width : null,
        input.source.sourceKind === "IMAGE" ? input.source.height : null,
        input.source.sourceKind !== "TYPED"
          ? input.source.preprocessingVersion
          : null,
        needsReview ? "NEEDS_REVIEW" : "EXTRACTED",
      );
    database
      .prepare(
        [
          "INSERT INTO assignment_source_extractions",
          "(id, source_id, model_name, prompt_version, schema_version, openai_response_id,",
          "input_hash, output_hash, overall_confidence, exercises_json, input_tokens, output_tokens, latency_ms, source_summary, cache_hit)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        extractionId,
        sourceId,
        input.run.modelName,
        input.run.promptVersion,
        input.run.schemaVersion,
        input.run.responseId,
        input.run.inputHash,
        input.run.outputHash,
        extraction.overallConfidence,
        JSON.stringify(extraction.exercises),
        input.run.inputTokens,
        input.run.outputTokens,
        input.run.latencyMs,
        extraction.sourceSummary,
        input.run.cacheHit ? 1 : 0,
      );
  })();

  return {
    assignmentId: assignment.id,
    sourceId,
    sourceKind: input.source.sourceKind,
    needsReview,
    ...extraction,
  };
}

function contentHash(domain: string, prompt: string) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        domain,
        prompt: prompt.normalize("NFKC").trim().replace(/\s+/g, " "),
      }),
    )
    .digest("hex");
}

export function confirmWorksheetExtraction(
  assignmentId: string,
  rawInput: z.input<typeof confirmWorksheetInputSchema>,
) {
  const input = confirmWorksheetInputSchema.parse(rawInput);
  const database = getDatabase();
  const createdItems: Array<{
    id: string;
    position: number;
    exerciseId: string;
    exerciseLabel: string;
    questionLabel: string;
    sharedContext: string | null;
    prompt: string;
    correctAnswer: string;
    answerFormat: string;
    points: number;
    inTaxonomyScope: boolean;
  }> = [];

  database.transaction(() => {
    const assignment = getDraftWorksheetAssignment(assignmentId);
    const source = database
      .prepare(
        "SELECT id FROM assignment_sources WHERE assignment_id = ? AND class_id = ?",
      )
      .get(assignment.id, assignment.classId) as { id: string } | undefined;
    if (!source) {
      throw new WorksheetRepositoryError(
        "ASSIGNMENT_SOURCE_MISSING",
        "Extract a worksheet before confirming its problems.",
      );
    }

    let itemPosition = 0;
    for (const [exerciseIndex, exercise] of input.exercises.entries()) {
      const exerciseId = randomUUID();
      database
        .prepare(
          [
            "INSERT INTO exercises",
            "(id, class_id, assignment_id, position, exercise_label, shared_context)",
            "VALUES (?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          exerciseId,
          assignment.classId,
          assignment.id,
          exerciseIndex + 1,
          exercise.exerciseLabel,
          exercise.sharedContext,
        );

      for (const question of exercise.questions) {
        itemPosition += 1;
        const problemId = randomUUID();
        const itemId = randomUUID();
        const storageDomain =
          question.domain ??
          (assignment.domain === "FRACTIONS" ? "FRACTIONS" : "ALGEBRA");
        const inTaxonomyScope =
          question.inTaxonomyScope &&
          question.domain !== null &&
          (assignment.domain === "MIXED" ||
            question.domain === assignment.domain);
        database
          .prepare(
            [
              "INSERT INTO problems",
              "(id, class_id, domain, prompt, answer_format, correct_answer, canonical_correct_answer, origin, content_hash)",
              "VALUES (?, ?, ?, ?, ?, ?, ?, 'WORKSHEET', ?)",
            ].join(" "),
          )
          .run(
            problemId,
            assignment.classId,
            storageDomain,
            question.problemStatement,
            question.answerKind,
            question.expectedAnswer,
            question.expectedAnswer.normalize("NFKC").trim(),
            contentHash(storageDomain, question.problemStatement),
          );
        database
          .prepare(
            [
              "INSERT INTO assignment_items",
              "(id, class_id, assignment_id, problem_id, position, points, is_required, exercise_id, question_label, in_taxonomy_scope)",
              "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
            ].join(" "),
          )
          .run(
            itemId,
            assignment.classId,
            assignment.id,
            problemId,
            itemPosition,
            question.points,
            exerciseId,
            question.questionLabel,
            inTaxonomyScope ? 1 : 0,
          );
        createdItems.push({
          id: itemId,
          position: itemPosition,
          exerciseId,
          exerciseLabel: exercise.exerciseLabel,
          questionLabel: question.questionLabel,
          sharedContext: exercise.sharedContext,
          prompt: question.problemStatement,
          correctAnswer: question.expectedAnswer,
          answerFormat: question.answerKind,
          points: question.points,
          inTaxonomyScope,
        });
      }
    }

    database
      .prepare(
        "UPDATE assignment_sources SET status = 'CONFIRMED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      )
      .run(source.id);
    database
      .prepare(
        "UPDATE assignments SET status = 'READY', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'DRAFT'",
      )
      .run(assignment.id);
  })();

  return { assignmentId, items: createdItems };
}
