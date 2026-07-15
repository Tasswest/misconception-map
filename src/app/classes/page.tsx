import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EntityActions } from "@/components/management/entity-actions";
import { isOpenAIConfigured } from "@/lib/config";
import { listManagedClasses } from "@/server/repositories/management";

export const dynamic = "force-dynamic";

export default function ClassesPage() {
  const classes = listManagedClasses();

  return (
    <AppShell activeNav="Classes" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1380px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Active roster
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
              Classes
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Open a class to see its roster, evidence coverage, and latest diagnostic.
            </p>
          </div>
          <Link
            className="inline-flex self-start rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
            href="/diagnose"
          >
            New class or assignment
          </Link>
        </header>

        {classes.length ? (
          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            {classes.map((classroom) => (
              <article
                className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)]"
                key={classroom.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold tracking-[-0.025em]">
                        {classroom.name}
                      </h2>
                      {classroom.isDemo ? (
                        <span className="rounded-full bg-[var(--soft-mint)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--sage)]">
                          Synthetic demo
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {gradeLabel(classroom.gradeBand)}
                      {classroom.schoolYear ? ` · ${classroom.schoolYear}` : ""}
                    </p>
                  </div>
                  <EntityActions
                    currentName={classroom.name}
                    entity="class"
                    entityId={classroom.id}
                  />
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Students" value={classroom.studentCount} />
                  <Stat label="Assignments" value={classroom.assignmentCount} />
                  <Stat label="Diagnosed" value={classroom.diagnosedStudentCount} />
                  <Stat label="Review" value={classroom.needsReviewCount} tone="amber" />
                </div>

                <div className="mt-5 border-t border-black/[0.06] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                      Roster
                    </p>
                    <span className="text-[10px] text-[var(--muted)]">
                      Synthetic names are marked in demo classes
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {classroom.students.slice(0, 10).map((student) =>
                      classroom.latestAssignment ? (
                        <Link
                          className="rounded-full border border-black/[0.07] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[var(--ink)] transition hover:border-[var(--sage)]/30 hover:bg-[var(--soft-mint)]"
                          href={`/assignments/${classroom.latestAssignment.id}/students/${student.membershipId}/corrected`}
                          key={student.membershipId}
                          title="Open corrected exam"
                        >
                          {student.displayName}
                        </Link>
                      ) : (
                        <span
                          className="rounded-full border border-black/[0.07] bg-white px-2.5 py-1.5 text-[10px] font-semibold"
                          key={student.membershipId}
                        >
                          {student.displayName}
                        </span>
                      ),
                    )}
                    {classroom.studentCount > 10 ? (
                      <span className="px-1 py-1.5 text-[10px] font-semibold text-[var(--muted)]">
                        +{classroom.studentCount - 10} more
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {classroom.latestAssignment ? (
                    <>
                      <Link
                        className="rounded-xl bg-[var(--sidebar)] px-3.5 py-2.5 text-xs font-semibold text-white"
                        href={`/assignments/${classroom.latestAssignment.id}/dashboard`}
                      >
                        Open latest dashboard
                      </Link>
                      <span className="text-xs text-[var(--muted)]">
                        {classroom.latestAssignment.title}
                      </span>
                    </>
                  ) : (
                    <Link
                      className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold"
                      href="/diagnose"
                    >
                      Create first assignment
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone = "green",
}: {
  label: string;
  value: number;
  tone?: "green" | "amber";
}) {
  return (
    <div className="rounded-xl border border-black/[0.05] bg-white/65 p-3">
      <p className="text-xl font-semibold tracking-[-0.025em]">{value}</p>
      <p className={`mt-1 text-[10px] font-semibold ${tone === "amber" && value ? "text-[#8a642a]" : "text-[var(--muted)]"}`}>
        {label}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="mt-6 rounded-[24px] border border-dashed border-black/10 bg-white/60 px-6 py-16 text-center">
      <h2 className="text-xl font-semibold">No active classes yet</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Create a class manually or load the synthetic demo classroom from Overview.
      </p>
      <Link
        className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
        href="/diagnose"
      >
        Create a class
      </Link>
    </section>
  );
}

function gradeLabel(value: string) {
  return value === "MIXED_5_8"
    ? "Grades 5–8"
    : value.replace("GRADE_", "Grade ");
}
