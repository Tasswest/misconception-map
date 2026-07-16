import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AssignmentTriageScreen } from "@/components/triage/assignment-triage-screen";
import { isOpenAIConfigured } from "@/lib/config";
import { getAssignmentTriage } from "@/server/repositories/triage";

export const dynamic = "force-dynamic";

export default async function AssignmentResultsPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const triage = getAssignmentTriage(assignmentId);
  if (!triage) notFound();

  return (
    <AppShell activeNav="Assignments" liveAiReady={isOpenAIConfigured()}>
      <AssignmentTriageScreen initialTriage={triage} />
    </AppShell>
  );
}
