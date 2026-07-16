import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import {
  worksheetExtractionAIOutputSchema,
  worksheetExerciseSchema,
  type WorksheetExtraction,
} from "@/domain/worksheet-extraction";
import { getDatabase } from "@/lib/db";

const idSchema = z.string().trim().min(1).max(200);

export const confirmWorksheetInputSchema = z
  .object({
    exercises: z.array(worksheetExerciseSchema).min(1).max(30),
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
          exercises: z.array(worksheetExerciseSchema).parse(
            JSON.parse(extraction.exercises_json),
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
};

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
          "input_hash, output_hash, overall_confidence, exercises_json, input_tokens, output_tokens, latency_ms)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        if (
          assignment.domain !== "MIXED" &&
          question.domain !== assignment.domain
        ) {
          throw new WorksheetRepositoryError(
            "DOMAIN_MISMATCH",
            "An extracted question falls outside the assignment domain.",
          );
        }
        const problemId = randomUUID();
        const itemId = randomUUID();
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
            question.domain,
            question.problemStatement,
            question.answerKind,
            question.expectedAnswer,
            question.expectedAnswer.normalize("NFKC").trim(),
            contentHash(question.domain, question.problemStatement),
          );
        database
          .prepare(
            [
              "INSERT INTO assignment_items",
              "(id, class_id, assignment_id, problem_id, position, points, is_required, exercise_id, question_label)",
              "VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)",
            ].join(" "),
          )
          .run(
            itemId,
            assignment.classId,
            assignment.id,
            problemId,
            itemPosition,
            exerciseId,
            question.questionLabel,
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
