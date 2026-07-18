import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import {
  FreshDatabaseState,
  SingleActionEmptyState,
} from "@/components/readiness-states";
import { isOpenAIConfigured } from "@/lib/config";
import { listClassErrorInventoryRollups } from "@/server/repositories/error-inventory";
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
  const classRollups = listClassErrorInventoryRollups();
  return (
    <AppShell activeNav="Analytics" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1120px] px-5 py-8 md:px-8 lg:px-10 lg:py-10">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
          Class evidence
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
          Analytics
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Choose an assignment to open its exercise results, corrected copies, and instructional support.
        </p>

        {classRollups.length ? (
          <section className="mt-6 overflow-hidden rounded-[26px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
            <div className="border-b border-black/[0.06] px-5 py-5 md:px-6">
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">Class profile over time</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Which error patterns persist across assignments?</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Misconceptions roll up across assignments; isolated slips stay attached to the assignment where they occurred. Select evidence to open that assignment.
              </p>
            </div>
            <div className="divide-y divide-black/[0.06]">
              {classRollups.map((rollup) => (
                <div className="px-5 py-5 md:px-6" key={rollup.classId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{rollup.className}</h3>
                    <p className="text-xs text-[var(--muted)]">{rollup.assignmentCount} {rollup.assignmentCount === 1 ? "assignment" : "assignments"}</p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {rollup.misconceptionOccurrenceCount > 0 ? (
                    <div className="rounded-xl bg-[var(--soft-coral)] px-3 py-3">
                      <p className="text-xs font-semibold">Misconception evidence</p>
                      <p className="mt-1 text-sm">{rollup.misconceptionTypeCount} {rollup.misconceptionTypeCount === 1 ? "type" : "types"} · {rollup.misconceptionStudentCount} {rollup.misconceptionStudentCount === 1 ? "student" : "students"} · {rollup.misconceptionOccurrenceCount} {rollup.misconceptionOccurrenceCount === 1 ? "occurrence" : "occurrences"}</p>
                    </div>
                    ) : null}
                    {rollup.slipsByAssignment.length ? (
                    <div className="rounded-xl bg-[var(--amber)]/10 px-3 py-3">
                      <p className="text-xs font-semibold">One-off slips</p>
                      <p className="mt-1 text-sm">{rollup.slipsByAssignment.reduce((sum, assignment) => sum + assignment.count, 0)} across {rollup.slipsByAssignment.length} {rollup.slipsByAssignment.length === 1 ? "assignment" : "assignments"}</p>
                    </div>
                    ) : null}
                    {rollup.uncertainCount > 0 ? (
                    <div className="rounded-xl bg-[var(--canvas)] px-3 py-3">
                      <p className="text-xs font-semibold">AI uncertainty</p>
                      <p className="mt-1 text-sm">{rollup.uncertainCount} {rollup.uncertainCount === 1 ? "item" : "items"} flagged as uncertain</p>
                    </div>
                    ) : null}
                  </div>
                  {rollup.leadingMisconceptions.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {rollup.leadingMisconceptions.map((group) => (
                        <Link
                          className="rounded-full border border-[var(--coral)]/20 bg-white px-3 py-1.5 text-xs font-semibold"
                          href={`/analytics/${group.items[0].assignmentId}#error-log`}
                          key={group.misconceptionId}
                        >
                          {group.teacherLabel} · {group.distinctStudentCount} {group.distinctStudentCount === 1 ? "student" : "students"}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {rollup.slipsByAssignment.length ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {rollup.slipsByAssignment.map((assignment) => (
                        <Link className="font-semibold text-[var(--sage)] underline-offset-4 hover:underline" href={`/analytics/${assignment.assignmentId}#error-log`} key={assignment.assignmentId}>
                          {assignment.assignmentTitle}: {assignment.count} {assignment.count === 1 ? "slip" : "slips"}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {latest ? (
          <Link
            className="mt-6 block rounded-[26px] border border-[var(--sage)]/15 bg-[var(--soft-mint)]/55 p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] transition hover:-translate-y-0.5"
            href={`/analytics/${latest.id}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              Latest assignment
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              {latest.title}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {latest.className} · {latest.diagnosedStudentCount} of {latest.studentCount} {latest.studentCount === 1 ? "student" : "students"} diagnosed · {uncertaintyLabel(latest.needsReviewCount)}
            </p>
            <span className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-xs font-semibold text-white">
              Open latest analytics →
            </span>
          </Link>
        ) : (
          hasClasses ? (
            <SingleActionEmptyState
              actionHref="/assignments?new=1"
              actionLabel="Create an assignment"
              description="Analytics appears after an exam source is confirmed."
              title="No analytics yet"
            />
          ) : (
            <FreshDatabaseState title="No analytics yet" />
          )
        )}

        {assignments.length > 1 ? (
          <section className="mt-7">
            <h2 className="text-sm font-semibold">All assignments</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {assignments.slice(1).map((assignment) => (
                <Link
                  className="rounded-2xl border border-black/[0.06] bg-white/75 p-4 transition hover:border-[var(--sage)]/20 hover:bg-white"
                  href={`/analytics/${assignment.id}`}
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

function uncertaintyLabel(count: number) {
  return `${count} ${count === 1 ? "item" : "items"} flagged as uncertain`;
}
