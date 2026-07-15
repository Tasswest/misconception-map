import { z } from "zod";

import { WorkspaceRepositoryError } from "@/server/repositories/workspace";
import { ManagementRepositoryError } from "@/server/repositories/management";
import {
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";

const MAX_WORKSPACE_JSON_BYTES = 64 * 1024;

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    requireDeclaredBodyWithinLimit(request, MAX_WORKSPACE_JSON_BYTES);
    return await request.json();
  } catch (error) {
    if (error instanceof LocalRequestBodyError) throw error;
    throw new ApiRequestError(
      "INVALID_JSON",
      "The request body must be valid JSON.",
      400,
    );
  }
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof LocalRequestBodyError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the highlighted fields and try again.",
          issues: error.issues.map((issue) => ({
            field: issue.path.map(String).join(".") || "request",
            code: issue.code,
          })),
        },
      },
      { status: 400 },
    );
  }

  if (
    error instanceof ApiRequestError ||
    error instanceof ManagementRepositoryError ||
    error instanceof WorkspaceRepositoryError
  ) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  ) {
    return Response.json(
      {
        error: {
          code: "CONFLICT",
          message: "That workspace record conflicts with existing data.",
        },
      },
      { status: 409 },
    );
  }

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The workspace could not be updated. Please try again.",
      },
    },
    { status: 500 },
  );
}
