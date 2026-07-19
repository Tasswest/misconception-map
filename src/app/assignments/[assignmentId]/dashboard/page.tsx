import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MisconceptionHeatmap } from "@/components/dashboard/misconception-heatmap";
import { AssignmentGrades } from "@/components/gradebook/assignment-grades";
import { isOpenAIConfigured } from "@/lib/config";
import { getHeatmapDashboard } from "@/server/repositories/dashboard";
import { getAssignmentGrades } from "@/server/repositories/gradebook";

export const dynamic = "force-dynamic";

export default async function AssignmentDashboardPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const dashboard = getHeatmapDashboard(assignmentId);
  if (!dashboard) notFound();
  const grades = getAssignmentGrades(assignmentId);
  const liveAiReady = isOpenAIConfigured();

  return (
    <AppShell activeNav="Analytics" liveAiReady={liveAiReady}>
      <MisconceptionHeatmap dashboard={dashboard} liveAiReady={liveAiReady} />
      {grades ? (
        <div className="mx-auto max-w-[1500px] px-5 pb-9 md:px-8 lg:px-10">
          <AssignmentGrades grades={grades} />
        </div>
      ) : null}
    </AppShell>
  );
}
