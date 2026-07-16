import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AssignmentStepper } from "@/components/assignment-stepper";
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
      <div className="mx-auto max-w-[1380px] px-5 pt-7 md:px-8 lg:px-10 lg:pt-9">
        <AssignmentStepper assignmentId={assignmentId} currentStep={4} />
      </div>
      <AssignmentTriageScreen initialTriage={triage} />
    </AppShell>
  );
}
