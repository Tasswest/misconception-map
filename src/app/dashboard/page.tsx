import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import {
  FreshDatabaseState,
  SingleActionEmptyState,
} from "@/components/readiness-states";
import { isOpenAIConfigured } from "@/lib/config";
import {
  listManagedAssignments,
  listManagedClasses,
} from "@/server/repositories/management";

export const dynamic = "force-dynamic";

export default function DashboardIndexPage() {
  const assignments = listManagedAssignments().filter(
    (assignment) => assignment.status === "READY",
  );
  const latest = assignments[0] ?? null;
  const hasClasses = listManagedClasses().length > 0;
  return (
    <AppShell activeNav="Dashboard" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1120px] px-5 py-8 md:px-8 lg:px-10 lg:py-10">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
          Class evidence
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
          Dashboards
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Choose an assignment. The most recent diagnostic is kept at the top.
        </p>

        {latest ? (
          <Link
            className="mt-6 block rounded-[26px] border border-[var(--sage)]/15 bg-[var(--soft-mint)]/55 p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] transition hover:-translate-y-0.5"
            href={`/assignments/${latest.id}/dashboard`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              Latest assignment
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              {latest.title}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {latest.className} · {latest.diagnosedStudentCount} of {latest.studentCount} {latest.studentCount === 1 ? "student" : "students"} diagnosed · {reviewLabel(latest.needsReviewCount)}
            </p>
            <span className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-xs font-semibold text-white">
              Open latest heatmap →
            </span>
          </Link>
        ) : (
          hasClasses ? (
            <SingleActionEmptyState
              actionHref="/diagnose"
              actionLabel="Create a diagnostic"
              description="A dashboard appears after an exam source is confirmed."
              title="No dashboards yet"
            />
          ) : (
            <FreshDatabaseState title="No dashboards yet" />
          )
        )}

        {assignments.length > 1 ? (
          <section className="mt-7">
            <h2 className="text-sm font-semibold">All active dashboards</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {assignments.slice(1).map((assignment) => (
                <Link
                  className="rounded-2xl border border-black/[0.06] bg-white/75 p-4 transition hover:border-[var(--sage)]/20 hover:bg-white"
                  href={`/assignments/${assignment.id}/dashboard`}
                  key={assignment.id}
                >
                  <p className="font-semibold">{assignment.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {assignment.className} · {assignment.diagnosedStudentCount} of {assignment.studentCount} {assignment.studentCount === 1 ? "student" : "students"} diagnosed
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function reviewLabel(count: number) {
  return `${count} ${count === 1 ? "item needs" : "items need"} review`;
}
