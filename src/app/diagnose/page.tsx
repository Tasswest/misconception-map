import { AppShell } from "@/components/app-shell";
import { SetupWorkspace } from "@/components/diagnosis/setup-workspace";
import { FreshDatabaseState } from "@/components/readiness-states";
import type { ClassWorkspaceOption } from "@/components/diagnosis/types";
import { isOpenAIConfigured } from "@/lib/config";
import { getDraftWorksheetSetup } from "@/server/repositories/worksheet";
import { listWorkspaceOverview } from "@/server/repositories/workspace";

export const dynamic = "force-dynamic";

export default async function DiagnoseSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ assignmentId?: string | string[] }>;
}) {
  const requestedAssignmentId = (await searchParams).assignmentId;
  const assignmentId = Array.isArray(requestedAssignmentId)
    ? requestedAssignmentId[0]
    : requestedAssignmentId;
  let initialDraft = null;
  if (assignmentId) {
    try {
      initialDraft = getDraftWorksheetSetup(assignmentId);
    } catch {
      initialDraft = null;
    }
  }
  const overview = listWorkspaceOverview();
  const liveAiReady = isOpenAIConfigured();
  const initialClasses: ClassWorkspaceOption[] = overview.map((classroom) => ({
    id: classroom.id,
    name: classroom.name,
    gradeBand: classroom.gradeBand,
    schoolYear: classroom.schoolYear,
    students: classroom.memberships.map((membership) => ({
      membershipId: membership.id,
      displayName: membership.displayName,
    })),
    assignments: classroom.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      domain: assignment.domain,
      problemPrompt: assignment.item?.prompt ?? null,
      correctAnswer: assignment.item?.correctAnswer ?? null,
    })),
  }));

  return (
    <AppShell activeNav="Assignments" liveAiReady={liveAiReady}>
      {initialClasses.length === 0 ? (
        <div className="px-5 py-8 md:px-8 lg:px-10">
          <FreshDatabaseState title="No classroom is available for a diagnostic" />
        </div>
      ) : (
        <SetupWorkspace
          initialClasses={initialClasses}
          initialDraft={initialDraft}
          liveAiReady={liveAiReady}
        />
      )}
    </AppShell>
  );
}
