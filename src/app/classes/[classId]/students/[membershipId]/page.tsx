import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { isOpenAIConfigured } from "@/lib/config";
import { getStudentGradebook } from "@/server/repositories/gradebook";

export const dynamic = "force-dynamic";

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ classId: string; membershipId: string }>;
}) {
  const { classId, membershipId } = await params;
  const gradebook = getStudentGradebook(classId, membershipId);
  if (!gradebook) notFound();
  const { class: classroom, student, overallPercent, exams } = gradebook;
  const gradedExams = exams.filter((exam) => exam.grade);

  return (
    <AppShell activeNav="Classes" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[900px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <Link
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--sage)]"
          href={`/classes/${classroom.id}`}
        >
          ← {classroom.name}
        </Link>

        <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Student
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] md:text-4xl">
              {student.studentName}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {gradedExams.length} of {exams.length} assignment
              {exams.length === 1 ? "" : "s"} graded
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--sage)]/20 bg-white px-5 py-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              Overall
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-[-0.02em] text-[var(--ink)]">
              {formatPercent(overallPercent)}
            </p>
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-black/[0.06] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] md:px-7">
            <span>Assignment</span>
            <span className="w-24 text-right">Grade</span>
            <span className="w-20 text-right">Class avg</span>
          </div>

          {exams.length ? (
            <ul className="divide-y divide-black/[0.05]">
              {exams.map((exam) => {
                const delta =
                  exam.grade && exam.classAveragePercent !== null
                    ? exam.grade.percent - exam.classAveragePercent
                    : null;
                return (
                  <li
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3.5 md:px-7"
                    key={exam.assignmentId}
                  >
                    <div className="min-w-0">
                      <Link
                        className="block truncate text-sm font-semibold text-[var(--ink)] transition hover:text-[var(--sage)]"
                        href={`/analytics/${exam.assignmentId}/corrected-copies/${student.membershipId}`}
                      >
                        {exam.title}
                      </Link>
                      {delta !== null && Math.abs(delta) >= 0.05 ? (
                        <p className="mt-0.5 text-[11px] font-medium text-[var(--muted)]">
                          {delta > 0 ? "+" : "−"}
                          {formatNumber(Math.abs(delta))} pts vs class
                        </p>
                      ) : null}
                    </div>
                    <div className="w-24 text-right">
                      {exam.grade ? (
                        <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">
                          {formatNumber(exam.grade.score)}
                          <span className="text-[var(--muted)]">
                            /{formatNumber(exam.grade.maxScore)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs font-medium italic text-[var(--muted)]">
                          Not graded
                        </span>
                      )}
                    </div>
                    <span className="w-20 text-right text-sm font-medium tabular-nums text-[var(--muted)]">
                      {formatPercent(exam.classAveragePercent)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-8 text-center md:px-7">
              <p className="text-sm text-[var(--muted)]">
                No assignments for this class yet.
              </p>
            </div>
          )}
        </section>

        <p className="mt-4 px-1 text-xs text-[var(--muted)]">
          Select an assignment to open this student&apos;s corrected copy and misconception
          evidence.
        </p>
      </div>
    </AppShell>
  );
}
