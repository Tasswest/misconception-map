import { AppShell } from "@/components/app-shell";
import { SetupWorkspace } from "@/components/diagnosis/setup-workspace";
import type { ClassWorkspaceOption } from "@/components/diagnosis/types";
import { isOpenAIConfigured } from "@/lib/config";
import { listWorkspaceOverview } from "@/server/repositories/workspace";

export const dynamic = "force-dynamic";

export default function DiagnoseSetupPage() {
  const overview = listWorkspaceOverview();
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
    <AppShell activeNav="Assignments" liveAiReady={isOpenAIConfigured()}>
      <SetupWorkspace initialClasses={initialClasses} />
    </AppShell>
  );
}
