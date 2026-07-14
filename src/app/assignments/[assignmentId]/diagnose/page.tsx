import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DiagnosisWorkbench } from "@/components/diagnosis/diagnosis-workbench";
import { isOpenAIConfigured } from "@/lib/config";
import { listAssignmentDiagnosisQueue } from "@/server/repositories/diagnosis";
import { getDiagnosticAssignment } from "@/server/repositories/workspace";

export const dynamic = "force-dynamic";

export default async function AssignmentDiagnosePage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const assignment = getDiagnosticAssignment(assignmentId);
  if (!assignment) notFound();

  const liveAiReady = isOpenAIConfigured();
  const initialItems = listAssignmentDiagnosisQueue(assignment.id);

  return (
    <AppShell activeNav="Assignments" liveAiReady={liveAiReady}>
      <DiagnosisWorkbench
        assignment={{
          id: assignment.id,
          classId: assignment.classId,
          className: assignment.className,
          title: assignment.title,
          description: assignment.description,
          domain: assignment.domain,
          problemPrompt: assignment.item.prompt,
          correctAnswer: assignment.item.correctAnswer,
        }}
        initialItems={initialItems}
        liveAiReady={liveAiReady}
        students={assignment.memberships.map((membership) => ({
          membershipId: membership.id,
          displayName: membership.displayName,
        }))}
      />
    </AppShell>
  );
}
