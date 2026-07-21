import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalyticsHeader } from "@/components/analytics/analytics-navigation";
import { AppShell } from "@/components/app-shell";
import { GenerateFollowUpEvaluationButton } from "@/components/follow-up/generate-follow-up-evaluation-button";
import { SparkIcon } from "@/components/icons";
import { GeneratePracticeButton } from "@/components/practice/generate-practice-button";
import { isOpenAIConfigured } from "@/lib/config";
import { getHeatmapDashboard } from "@/server/repositories/dashboard";
import { getLatestFollowUpEvaluationSummary } from "@/server/repositories/follow-up-evaluation";
import { formatUtcTimestamp } from "@/lib/date-format";

export const dynamic = "force-dynamic";

export default async function PracticeAndBriefPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const dashboard = getHeatmapDashboard(assignmentId);
  if (!dashboard) notFound();
  const liveAiReady = isOpenAIConfigured();
  const supportRows = dashboard.rows.filter(
    (row) => row.practice !== null || row.practiceTarget !== null,
  );
  const followUp = getLatestFollowUpEvaluationSummary(assignmentId);
  const hasMistakes =
    dashboard.errorInventory.totals.misconceptionOccurrenceCount > 0 ||
    dashboard.errorInventory.totals.slipCount > 0 ||
    dashboard.errorInventory.totals.uncertainCount > 0;

  return (
    <AppShell activeNav="Analytics" liveAiReady={liveAiReady}>
      <div className="mx-auto max-w-[1180px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <AnalyticsHeader
          activeTab="practice"
          assignment={dashboard.assignment}
          description="Find the class teaching brief and every targeted practice sheet in one place."
        />

        {dashboard.teachingBrief ? (
          <section className="mt-6 grid gap-5 rounded-[24px] border border-[var(--sage)]/15 bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] md:grid-cols-[minmax(0,1fr)_320px] md:p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
                Teach This Tomorrow
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                {dashboard.teachingBrief.misconceptionLabel}
              </h2>
              <p className="mt-3 text-sm leading-7">
                {dashboard.teachingBrief.paragraph}
              </p>
              <p className="mt-3 text-[10px] text-[var(--muted)]">
                Evidence: {dashboard.teachingBrief.clusterStudentCount} of {dashboard.teachingBrief.diagnosedStudentCount} diagnosed students · {formatDate(dashboard.teachingBrief.evidenceCutoffAt)}
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--soft-mint)]/70 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                Put this on the board
              </p>
              <p className="mt-3 whitespace-pre-wrap font-mono text-sm leading-6">
                {dashboard.teachingBrief.workedExample.problemPrompt}
              </p>
              <p className="mt-3 border-t border-[var(--sage)]/15 pt-3 font-mono text-sm font-semibold">
                {dashboard.teachingBrief.workedExample.correctAnswer}
              </p>
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-[24px] border border-dashed border-black/10 bg-white/60 px-6 py-10 text-center">
            <SparkIcon className="mx-auto size-5 text-[var(--sage)]" />
            <h2 className="mt-3 text-lg font-semibold">No teaching brief yet</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Generate it from the strongest class signal on Class by exercise.
            </p>
            <Link className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white" href={`/analytics/${assignmentId}`}>
              Open Class by exercise
            </Link>
          </section>
        )}

        <section className="mt-5 flex flex-col gap-4 rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              Follow-up evaluation
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              A new evaluation that retests every mistake
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Drafted in the same structure and language as the source exam. Every question is
              pinned to an observed mistake — repeated patterns, one-off slips, and items the AI
              could not settle — with a teacher answer key explaining what each question retests.
            </p>
            {followUp ? (
              <p className="mt-2 text-xs font-medium text-[var(--muted)]">
                Latest: v{followUp.version} · {followUp.questionCount} questions ·{" "}
                {followUp.totalPoints} points · {formatUtcTimestamp(followUp.createdAt)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            {followUp ? (
              <Link
                className="inline-flex rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--canvas)]"
                href={`/analytics/${assignmentId}/follow-up/${followUp.id}`}
              >
                Open follow-up evaluation
              </Link>
            ) : null}
            <GenerateFollowUpEvaluationButton
              assignmentId={assignmentId}
              hasMistakes={hasMistakes}
              liveAiReady={liveAiReady}
            />
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
          <div className="border-b border-black/[0.06] px-5 py-4 md:px-6">
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              Targeted practice
            </p>
            <h2 className="mt-1 text-xl font-semibold">Practice by student</h2>
          </div>
          {supportRows.length ? (
            <div className="divide-y divide-black/[0.06]">
              {supportRows.map((row) => (
                <article className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6" key={row.membershipId}>
                  <div>
                    <h3 className="text-sm font-semibold">{row.studentName}</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {row.practice
                        ? `${row.practice.title} · ${row.practice.modelStatus.toLowerCase()} model`
                        : row.practiceTarget
                          ? `Target: ${row.practiceTarget.shortLabel} · ${row.practiceTarget.sourceReference}`
                          : "No supported practice target"}
                    </p>
                  </div>
                  {row.practice ? (
                    <Link
                      className="inline-flex self-start rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold transition hover:bg-[var(--canvas)] sm:self-auto"
                      href={`/analytics/${assignmentId}/practice/${row.practice.worksheetId}`}
                    >
                      Open worksheet & answer key
                    </Link>
                  ) : row.practiceTarget ? (
                    <GeneratePracticeButton
                      assignmentId={assignmentId}
                      liveAiReady={liveAiReady}
                      membershipId={row.membershipId}
                      misconceptionId={row.practiceTarget.misconceptionId}
                      studentName={row.studentName}
                    />
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-[var(--muted)]">No supported practice target is available yet.</p>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
