import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import {
  worksheetExtractionAIOutputSchema,
  worksheetProblemSchema,
  type WorksheetExtraction,
} from "@/domain/worksheet-extraction";
import { getDatabase } from "@/lib/db";

const idSchema = z.string().trim().min(1).max(200);

export const confirmWorksheetInputSchema = z
  .object({
    problems: z.array(worksheetProblemSchema).min(1).max(30),
  })
  .strict()
  .superRefine((input, context) => {
    input.problems.forEach((problem, index) => {
      if (problem.position !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Worksheet problem positions must be consecutive.",
          path: ["problems", index, "position"],
        });
      }
    });
  });

type AssignmentRow = {
  id: string;
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
        "SELECT assignment.id, assignment.class_id, assignment.domain, assignment.status",
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
    extraction.problems.some(
      (problem) =>
        problem.extractionConfidence < 0.72 ||
        problem.answerConfidence < 0.72 ||
        problem.reviewNote !== null,
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
          "input_hash, output_hash, overall_confidence, problems_json, input_tokens, output_tokens, latency_ms)",
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
        JSON.stringify(extraction.problems),
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

    for (const problem of input.problems) {
      if (
        assignment.domain !== "MIXED" &&
        problem.domain !== assignment.domain
      ) {
        throw new WorksheetRepositoryError(
          "DOMAIN_MISMATCH",
          "An extracted problem falls outside the assignment domain.",
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
          problem.domain,
          problem.prompt,
          problem.answerFormat,
          problem.correctAnswer,
          problem.correctAnswer.normalize("NFKC").trim(),
          contentHash(problem.domain, problem.prompt),
        );
      database
        .prepare(
          [
            "INSERT INTO assignment_items",
            "(id, class_id, assignment_id, problem_id, position, points, is_required)",
            "VALUES (?, ?, ?, ?, ?, 1, 1)",
          ].join(" "),
        )
        .run(
          itemId,
          assignment.classId,
          assignment.id,
          problemId,
          problem.position,
        );
      createdItems.push({
        id: itemId,
        position: problem.position,
        prompt: problem.prompt,
        correctAnswer: problem.correctAnswer,
        answerFormat: problem.answerFormat,
      });
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
