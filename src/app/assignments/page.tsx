import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EntityActions } from "@/components/management/entity-actions";
import { isOpenAIConfigured } from "@/lib/config";
import { listManagedAssignments } from "@/server/repositories/management";

export const dynamic = "force-dynamic";

export default function AssignmentsPage() {
  const assignments = listManagedAssignments();
  return (
    <AppShell activeNav="Assignments" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1260px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Diagnostic history
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
              Assignments
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Open a heatmap, add work, or archive setup mistakes without deleting evidence.
            </p>
          </div>
          <Link
            className="inline-flex self-start rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
            href="/diagnose"
          >
            New diagnostic
          </Link>
        </header>

        {assignments.length ? (
          <div className="mt-6 space-y-3">
            {assignments.map((assignment) => (
              <article
                className="flex flex-col gap-4 rounded-[22px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_14px_38px_rgba(35,51,46,0.04)] lg:flex-row lg:items-center lg:justify-between"
                key={assignment.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-[-0.02em]">
                      {assignment.title}
                    </h2>
                    <span className="rounded-full bg-[var(--soft-mint)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--sage)]">
                      {assignment.domain.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {assignment.className} · {formatDate(assignment.createdAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                    <span>{countLabel(assignment.itemCount, "problem")}</span>
                    <span>{assignment.diagnosedStudentCount} of {assignment.studentCount} {assignment.studentCount === 1 ? "student" : "students"} diagnosed</span>
                    <span>{countLabel(assignment.needsReviewCount, "review item")}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {assignment.status === "READY" ? (
                    <Link
                      className="rounded-xl bg-[var(--sidebar)] px-3.5 py-2.5 text-xs font-semibold text-white"
                      href={`/assignments/${assignment.id}/results`}
                    >
                      Open results
                    </Link>
                  ) : null}
                  {assignment.status === "READY" ? (
                    <Link
                      className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold"
                      href={`/assignments/${assignment.id}/dashboard`}
                    >
                      Class dashboard
                    </Link>
                  ) : null}
                  <Link
                    className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold"
                    href={`/assignments/${assignment.id}/diagnose`}
                  >
                    Add work
                  </Link>
                  <EntityActions
                    currentName={assignment.title}
                    entity="assignment"
                    entityId={assignment.id}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <section className="mt-6 rounded-[24px] border border-dashed border-black/10 bg-white/60 px-6 py-16 text-center">
            <h2 className="text-xl font-semibold">No active assignments</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Upload a worksheet once, then diagnose every student against its problems.
            </p>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
