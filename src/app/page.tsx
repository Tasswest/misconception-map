import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EvidenceLegend } from "@/components/evidence-legend";
import { FreshDatabaseState } from "@/components/readiness-states";
import { isOpenAIConfigured } from "@/lib/config";
import {
  getOverviewSummary,
  type OverviewSummary,
} from "@/server/repositories/overview";

export const dynamic = "force-dynamic";

export default function Home() {
  const liveAiReady = isOpenAIConfigured();
  const overview = getOverviewSummary();

  if (overview.hasWorkspace) {
    return (
      <ReturningTeacherHome liveAiReady={liveAiReady} overview={overview} />
    );
  }

  return (
    <AppShell activeNav="Overview" liveAiReady={liveAiReady}>
      <div className="px-5 py-8 md:px-8 lg:px-10 lg:py-10">
        <FreshDatabaseState />
      </div>
    </AppShell>
  );
}

function ReturningTeacherHome({
  liveAiReady,
  overview,
}: {
  liveAiReady: boolean;
  overview: OverviewSummary;
}) {
  const latest = overview.latestAssignment;
  return (
    <AppShell activeNav="Overview" liveAiReady={liveAiReady}>
      <div className="mx-auto max-w-[1380px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Classroom at a glance
            </p>
            <h1 className="mt-2 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
              Here&apos;s what needs attention next.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Live evidence from {countLabel(overview.classCount, "active class", "active classes")} and {countLabel(overview.studentCount, "student", "students")}—with model claims kept separate from observed outcomes.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Link
              className="inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
              href="/diagnose"
            >
              Add diagnostic work
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <OverviewMetric
            detail={overview.dominantCluster ? `${overview.dominantCluster.shortLabel} is the largest shared signal` : "No definitive cluster yet"}
            label="Largest cluster"
            tone="coral"
            value={overview.dominantCluster ? `${overview.dominantCluster.affectedCount} ${overview.dominantCluster.affectedCount === 1 ? "student" : "students"}` : "—"}
          />
          <OverviewMetric
            detail={overview.prediction.scorable ? `${Math.round((overview.prediction.coverage ?? 0) * 100)}% prediction coverage` : "Locked claims appear here after held-out work"}
            label="Prediction accuracy"
            tone="mint"
            value={overview.prediction.scorable ? `${overview.prediction.matched} of ${overview.prediction.scorable} matched` : "No outcomes yet"}
          />
          <OverviewMetric
            detail={overview.needsReviewCount === 1 ? "One transcription needs teacher judgment" : `${overview.needsReviewCount} transcriptions need teacher judgment`}
            label="Needs review"
            tone="amber"
            value={String(overview.needsReviewCount)}
          />
          <OverviewMetric
            detail={`${countLabel(overview.assignmentCount, "active assignment", "active assignments")} across the workspace`}
            label="Evidence coverage"
            tone="mint"
            value={`${overview.studentCount} ${overview.studentCount === 1 ? "student" : "students"}`}
          />
        </section>

        <EvidenceLegend className="mt-4 rounded-2xl border border-black/[0.06] bg-white/70 px-4 py-3" />

        {latest ? (
          <section className="mt-5 grid overflow-hidden rounded-[26px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_20px_55px_rgba(35,51,46,0.06)] lg:grid-cols-[1.15fr_0.85fr]">
            <div className="p-6 md:p-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
                Most recent assignment
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {latest.title}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {latest.className} · {latest.diagnosedStudentCount} of {latest.studentCount} {latest.studentCount === 1 ? "student" : "students"} diagnosed
              </p>
              {overview.dominantCluster ? (
                <div className="mt-5 rounded-2xl bg-[var(--soft-coral)] p-4">
                  <p className="text-xs font-semibold text-[#9c4937]">Teach this tomorrow</p>
                  <p className="mt-1 text-sm font-semibold leading-6">
                    {overview.dominantCluster.affectedCount} {overview.dominantCluster.affectedCount === 1 ? "student" : "students"} out of {latest.studentCount} {overview.dominantCluster.affectedCount === 1 ? "shows" : "show"} {overview.dominantCluster.shortLabel.toLowerCase()}.
                  </p>
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link className="rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-xs font-semibold text-white" href={latest.currentStepHref}>
                  Continue · step {latest.currentStep} of 4
                </Link>
                {latest.currentStep === 4 ? (
                  <Link className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs font-semibold" href={`/assignments/${latest.id}/dashboard`}>
                    Class by exercise
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="bg-[var(--preview)] p-6 md:p-8">
              <div className="rounded-2xl border border-white/70 bg-white/85 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                      Prediction Lab
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {overview.prediction.matched} of {overview.prediction.scorable} matched
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--soft-mint)] px-3 py-1.5 text-xs font-bold text-[var(--sage)]">
                    {overview.prediction.coverage === null ? "—" : `${Math.round(overview.prediction.coverage * 100)}%`} coverage
                  </span>
                </div>
                <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                  Timestamped claims are scored only after held-out work arrives. Abstentions remain visible and do not count as guesses.
                </p>
                <Link className="mt-4 inline-flex text-xs font-semibold text-[var(--sage)]" href="/prediction-lab">
                  Inspect locked history →
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {overview.recentAssignments.length > 1 ? (
          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Recent assignments</h2>
              <Link className="text-xs font-semibold text-[var(--sage)]" href="/assignments">View all</Link>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {overview.recentAssignments.slice(1).map((assignment) => (
                <Link className="rounded-2xl border border-black/[0.06] bg-white/70 p-4" href={`/assignments/${assignment.id}/dashboard`} key={assignment.id}>
                  <p className="text-sm font-semibold">{assignment.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{assignment.className} · {assignment.diagnosedStudentCount} diagnosed</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function OverviewMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "mint" | "amber" | "coral";
}) {
  const dot = tone === "mint" ? "bg-[var(--sage)]" : tone === "amber" ? "bg-[var(--amber)]" : "bg-[var(--coral)]";
  return (
    <article className="rounded-2xl border border-black/[0.06] bg-white/78 p-5">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        <span className={`size-2 rounded-full ${dot}`} /> {label}
      </p>
      <p className="mt-3 text-xl font-semibold tracking-[-0.025em]">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{detail}</p>
    </article>
  );
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
