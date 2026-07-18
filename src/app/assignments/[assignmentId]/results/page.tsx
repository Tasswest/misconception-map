import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AssignmentStepper } from "@/components/assignment-stepper";
import { AssignmentResultsSummary } from "@/components/results/assignment-results-summary";
import { isOpenAIConfigured } from "@/lib/config";
import { getAssignmentResults } from "@/server/repositories/assignment-results";

export const dynamic = "force-dynamic";

export default async function AssignmentResultsPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const results = getAssignmentResults(assignmentId);
  if (!results) notFound();

  return (
    <AppShell activeNav="Assignments" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1380px] px-5 pt-7 md:px-8 lg:px-10 lg:pt-9">
        <AssignmentStepper assignmentId={assignmentId} currentStep={4} />
      </div>
      <AssignmentResultsSummary results={results} />
    </AppShell>
  );
}
