import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { FreshDatabaseState } from "@/components/readiness-states";
import { isOpenAIConfigured } from "@/lib/config";
import { listManagedClasses } from "@/server/repositories/management";

export const dynamic = "force-dynamic";

export default function ClassesPage() {
  const classes = listManagedClasses();

  return (
    <AppShell activeNav="Classes" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1120px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Active roster
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
              Classes
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Open a class to see its students, exams, and grade analysis.
            </p>
          </div>
          {classes.length ? (
            <Link
              className="inline-flex self-start rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
              href="/assignments?new=1"
            >
              New class or exam
            </Link>
          ) : null}
        </header>

        {classes.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {classes.map((classroom) => (
              <Link
                className="group flex items-center gap-4 rounded-[22px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] transition hover:border-[var(--sage)]/30 hover:shadow-[0_20px_50px_rgba(35,51,46,0.09)]"
                href={`/classes/${classroom.id}`}
                key={classroom.id}
              >
                <span
                  aria-hidden="true"
                  className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--soft-mint)] text-lg font-semibold text-[var(--sidebar)]"
                >
                  {monogram(classroom.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {classroom.name}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-medium text-[var(--sage)]">
                    {classroom.schoolName ?? gradeLabel(classroom.gradeBand)}
                  </span>
                  <span className="mt-1.5 block text-xs text-[var(--muted)]">
                    {classroom.studentCount} student
                    {classroom.studentCount === 1 ? "" : "s"} ·{" "}
                    {classroom.assignmentCount} exam
                    {classroom.assignmentCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-[var(--muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--sage)]"
                >
                  →
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <FreshDatabaseState title="No active classes yet" />
        )}
      </div>
    </AppShell>
  );
}

function gradeLabel(value: string): string {
  return value === "MIXED_5_8"
    ? "Grades 5–8"
    : value.replace("GRADE_", "Grade ");
}

function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
