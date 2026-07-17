import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MisconceptionHeatmap } from "@/components/dashboard/misconception-heatmap";
import { isOpenAIConfigured } from "@/lib/config";
import { getHeatmapDashboard } from "@/server/repositories/dashboard";

export const dynamic = "force-dynamic";

export default async function AssignmentDashboardPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const dashboard = getHeatmapDashboard(assignmentId);
  if (!dashboard) notFound();
  const liveAiReady = isOpenAIConfigured();

  return (
    <AppShell activeNav="Analytics" liveAiReady={liveAiReady}>
      <MisconceptionHeatmap dashboard={dashboard} liveAiReady={liveAiReady} />
    </AppShell>
  );
}
