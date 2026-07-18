import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalyticsHeader } from "@/components/analytics/analytics-navigation";
import { AppShell } from "@/components/app-shell";
import { AlertIcon, CheckIcon } from "@/components/icons";
import { isOpenAIConfigured } from "@/lib/config";
import { getHeatmapDashboard } from "@/server/repositories/dashboard";

export const dynamic = "force-dynamic";

export default async function CorrectedCopiesPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const dashboard = getHeatmapDashboard(assignmentId);
  if (!dashboard) notFound();

  return (
    <AppShell activeNav="Analytics" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1180px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <AnalyticsHeader
          activeTab="copies"
          assignment={dashboard.assignment}
          description="Open one returnable, exercise-grouped copy for each student."
        />

        <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
          <div className="border-b border-black/[0.06] px-5 py-4 md:px-6">
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              Corrected copies
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
              {dashboard.rows.length} {dashboard.rows.length === 1 ? "student" : "students"}
            </h2>
          </div>
          {dashboard.rows.length ? (
            <div className="divide-y divide-black/[0.06]">
              {dashboard.rows.map((row) => {
                const hasUncertainty = row.reviewCount > 0;
                return (
                  <article
                    className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6"
                    key={row.membershipId}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                          hasUncertainty
                            ? "bg-[var(--amber)]/16 text-[#765725]"
                            : "bg-[var(--soft-mint)] text-[var(--sage)]"
                        }`}
                      >
                        {hasUncertainty ? (
                          <AlertIcon className="size-4" />
                        ) : (
                          <CheckIcon className="size-4" />
                        )}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold">{row.studentName}</h3>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {row.diagnosedCount} {row.diagnosedCount === 1 ? "problem" : "problems"} diagnosed
                          {hasUncertainty
                            ? ` · ${row.reviewCount} ${row.reviewCount === 1 ? "item" : "items"} flagged as uncertain`
                            : " · ready to return"}
                        </p>
                      </div>
                    </div>
                    <Link
                      className="inline-flex self-start rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold transition hover:bg-[var(--canvas)] sm:self-auto"
                      href={`/analytics/${assignmentId}/corrected-copies/${row.membershipId}`}
                    >
                      Open corrected copy
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <h2 className="text-lg font-semibold">No students in this assignment</h2>
              <Link
                className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
                href={`/assignments/${assignmentId}/diagnose`}
              >
                Add student copies
              </Link>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
