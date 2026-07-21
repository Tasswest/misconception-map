import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import {
  gradeProposalNeedsAI,
  GradingProposalServiceError,
  proposeGrade,
} from "@/server/openai/propose-grade";
import { beginAiRequest } from "@/server/openai/spend-protection";
import {
  getGradeProposal,
  getGradingProposalContext,
  GradingProposalRepositoryError,
  saveGradeProposal,
  validateGradeProposal,
} from "@/server/repositories/grading-proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const proposeRequestSchema = z.object({}).strict();

function errorResponse(error: unknown) {
  if (error instanceof LocalRequestBodyError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_GRADING_REQUEST",
          message: error.issues[0]?.message ?? "Check every question score.",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof GradingProposalRepositoryError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof GradingProposalServiceError) {
    if (error.code === "OPENAI_OUTPUT_INVALID") {
      console.error(
        "Rejected an ungrounded grading proposal:",
        error.cause instanceof Error ? error.cause.message : "unknown guard failure",
      );
    }
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status:
          error.code === "OPENAI_NOT_CONFIGURED" ||
          error.code === "OPENAI_AUTH_FAILED"
            ? 503
            : error.code === "OPENAI_RATE_LIMITED"
              ? 429
              : 502,
      },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "GRADING_PROPOSAL_FAILED",
        message: "The grade proposal could not be completed. Try again.",
      },
    },
    { status: 500 },
  );
}

function revalidateGradeViews(assignmentId: string, membershipId: string) {
  revalidatePath(`/analytics/${assignmentId}`);
  revalidatePath(`/assignments/${assignmentId}/dashboard`);
  revalidatePath(`/analytics/${assignmentId}/corrected-copies/${membershipId}`);
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ assignmentId: string; membershipId: string }>;
  },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    requireDeclaredBodyWithinLimit(request, 1_000);
    proposeRequestSchema.parse(await request.json());
    const { assignmentId, membershipId } = await context.params;
    const existing = getGradeProposal(assignmentId, membershipId);
    if (existing) return NextResponse.json({ data: existing });

    const proposalContext = getGradingProposalContext(
      assignmentId,
      membershipId,
    );
    const needsAI = gradeProposalNeedsAI(proposalContext.questions);
    const protectedRequest = needsAI ? await beginAiRequest(request) : null;
    if (protectedRequest && !protectedRequest.allowed) {
      return protectedRequest.response;
    }
    const run = await (async () => {
      try {
        return await proposeGrade({ questions: proposalContext.questions });
      } finally {
        if (protectedRequest?.allowed) protectedRequest.release();
      }
    })();
    const proposal = saveGradeProposal(
      assignmentId,
      membershipId,
      proposalContext.classId,
      run,
    );
    revalidateGradeViews(assignmentId, membershipId);
    return NextResponse.json({ data: proposal }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: {
    params: Promise<{ assignmentId: string; membershipId: string }>;
  },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    requireDeclaredBodyWithinLimit(request, 20_000);
    const { assignmentId, membershipId } = await context.params;
    const proposal = validateGradeProposal(
      assignmentId,
      membershipId,
      await request.json(),
    );
    revalidateGradeViews(assignmentId, membershipId);
    return NextResponse.json({ data: proposal });
  } catch (error) {
    return errorResponse(error);
  }
}
