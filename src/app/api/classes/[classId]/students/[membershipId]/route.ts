import {
  removeClassMember,
  updateClassMember,
  updateClassMemberInputSchema,
} from "@/server/repositories/management";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import { removeStoredStudentWorkAsset } from "@/server/storage/submission-assets";

import { apiErrorResponse, readJsonBody } from "@/app/api/classes/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ classId: string; membershipId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const { classId, membershipId } = await context.params;
    const input = updateClassMemberInputSchema.parse(
      await readJsonBody(request),
    );
    return Response.json({
      data: updateClassMember(classId, membershipId, input),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const { classId, membershipId } = await context.params;
    const result = removeClassMember(classId, membershipId);
    const cleanupResults = await Promise.allSettled(
      result.storageKeys.map((storageKey) =>
        removeStoredStudentWorkAsset(storageKey),
      ),
    );
    const failedAssetCount = cleanupResults.filter(
      (cleanup) => cleanup.status === "rejected",
    ).length;
    if (failedAssetCount > 0) {
      console.error("Class-member asset cleanup was incomplete.", {
        classId,
        membershipId,
        failedAssetCount,
      });
    }

    return Response.json({
      data: {
        classId: result.classId,
        membershipId: result.membershipId,
        studentDeleted: result.studentDeleted,
        assetCleanupComplete: failedAssetCount === 0,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
