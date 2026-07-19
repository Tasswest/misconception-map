import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AddMemberButton } from "@/components/management/add-member-button";
import { ClassActions } from "@/components/management/class-actions";
import { MemberActions } from "@/components/management/member-actions";
import { isOpenAIConfigured } from "@/lib/config";
import { getClassGradebook } from "@/server/repositories/gradebook";

export const dynamic = "force-dynamic";

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function gradeLabel(value: string): string {
  return value === "MIXED_5_8"
    ? "Grades 5–8"
    : value.replace("GRADE_", "Grade ");
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const gradebook = getClassGradebook(classId);
  if (!gradebook) notFound();
  const { class: classroom, stats, students, assignments } = gradebook;

  return (
    <AppShell activeNav="Classes" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1120px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <Link
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--sage)]"
          href="/classes"
        >
          ← All classes
        </Link>

        <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">
              {classroom.name}
            </h1>
            {classroom.schoolName ? (
              <p className="mt-1.5 text-sm font-semibold text-[var(--sage)]">
                {classroom.schoolName}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-[var(--muted)]">
              {gradeLabel(classroom.gradeBand)}
              {classroom.schoolYear ? ` · ${classroom.schoolYear}` : ""}
            </p>
          </div>
          <ClassActions
            classId={classroom.id}
            currentGradeBand={
              classroom.gradeBand as
                | "GRADE_5"
                | "GRADE_6"
                | "GRADE_7"
                | "GRADE_8"
                | "MIXED_5_8"
            }
            currentName={classroom.name}
            currentSchoolName={classroom.schoolName}
            currentSchoolYear={classroom.schoolYear}
          />
        </header>

        <section className="mt-6 rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] md:p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              Class grades
            </p>
            <p className="text-[11px] font-semibold text-[var(--muted)]">
              {gradebook.gradedCount} paper{gradebook.gradedCount === 1 ? "" : "s"} graded
            </p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <StatTile label="Average" value={formatPercent(stats?.meanPercent ?? null)} />
            <StatTile label="Highest" value={formatPercent(stats?.highestPercent ?? null)} />
            <StatTile label="Lowest" value={formatPercent(stats?.lowestPercent ?? null)} />
          </div>
        </section>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {/* Students */}
          <section className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                Students
              </h2>
              <AddMemberButton classId={classroom.id} className={classroom.name} />
            </div>
            {students.length ? (
              <ul className="mt-4 flex flex-col gap-2">
                {students.map((student) => (
                  <li
                    className="flex items-center gap-3 rounded-xl border border-black/[0.07] bg-white px-3 py-2.5"
                    key={student.membershipId}
                  >
                    <Link
                      className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)] transition hover:text-[var(--sage)]"
                      href={`/classes/${classroom.id}/students/${student.membershipId}`}
                    >
                      {student.studentName}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {student.examsGraded} graded
                    </span>
                    <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--sage)]">
                      {formatPercent(student.overallPercent)}
                    </span>
                    <MemberActions
                      classId={classroom.id}
                      currentName={student.studentName}
                      membershipId={student.membershipId}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-black/10 bg-white/55 px-4 py-5">
                <p className="text-xs text-[var(--muted)]">
                  No students yet. Use{" "}
                  <span className="font-semibold text-[var(--ink)]">Add person</span> to build
                  this roster.
                </p>
              </div>
            )}
          </section>

          {/* Assignments */}
          <section className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] md:p-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              Exams
            </h2>
            {assignments.length ? (
              <ul className="mt-4 flex flex-col gap-2">
                {assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Link
                      className="flex items-center gap-3 rounded-xl border border-black/[0.07] bg-white px-3 py-2.5 transition hover:border-[var(--sage)]/30 hover:bg-[var(--soft-mint)]/40"
                      href={`/analytics/${assignment.id}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">
                        {assignment.title}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {assignment.gradedCount}/{assignment.studentCount} graded
                      </span>
                      <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--sage)]">
                        {formatPercent(assignment.meanPercent)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-black/10 bg-white/55 px-4 py-5">
                <p className="text-xs text-[var(--muted)]">
                  No exams yet. Create one from{" "}
                  <Link className="font-semibold text-[var(--ink)] underline" href="/assignments?new=1">
                    Assignments
                  </Link>
                  .
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--sage)]/15 bg-white px-3 py-3 text-center">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em] text-[var(--ink)]">
        {value}
      </p>
    </div>
  );
}
