import Link from "next/link";

import type { AssignmentGrades as AssignmentGradesData } from "@/server/repositories/gradebook";

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function AssignmentGrades({
  grades,
}: {
  grades: AssignmentGradesData;
}) {
  const stats = grades.stats;
  const gradedRank = grades.students.filter((student) => student.grade);

  return (
    <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
      <header className="flex flex-col gap-4 border-b border-black/[0.06] px-5 py-5 sm:flex-row sm:items-start sm:justify-between md:px-7">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Grades</h2>
            <span className="rounded-full bg-[var(--amber)]/18 px-2.5 py-1 text-[10px] font-bold text-[#70501f]">
              {grades.pendingValidationCount} pending validation
            </span>
          </div>
          <p className="mt-1 max-w-[52ch] text-xs leading-5 text-[var(--muted)]">
            AI may propose evidence-grounded points on a corrected copy; only a
            teacher-validated total appears here or enters class and student statistics.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-2 sm:gap-2.5">
          <Stat label="Average" value={stats ? `${formatNumber(stats.meanPercent)}%` : "—"} />
          <Stat label="Highest" value={stats ? `${formatNumber(stats.highestPercent)}%` : "—"} />
          <Stat label="Lowest" value={stats ? `${formatNumber(stats.lowestPercent)}%` : "—"} />
        </dl>
      </header>

      <div className="flex items-center justify-between gap-3 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] md:px-7">
        <span>
          {grades.gradedCount} of {grades.studentCount} validated
        </span>
        <span className="hidden sm:inline">Validated grades ranked by score</span>
      </div>

      <ol className="divide-y divide-black/[0.05] border-t border-black/[0.05]">
        {grades.students.map((student) => {
          const rank = student.grade ? gradedRank.indexOf(student) + 1 : null;
          const pending = student.proposalStatus === "PROPOSED";
          return (
            <li
              key={student.membershipId}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 md:px-7"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--canvas)] text-xs font-bold tabular-nums text-[var(--sage)]">
                {rank ?? "–"}
              </span>
              <span className="min-w-[6rem] flex-1 truncate text-sm font-medium text-[var(--ink)]">
                {student.studentName}
              </span>

              <div className="ml-auto flex shrink-0 items-center gap-3">
                {student.grade ? (
                  <>
                    <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-[var(--canvas)] sm:block">
                      <div
                        className="h-full rounded-full bg-[var(--sage)]"
                        style={{ width: `${Math.min(100, student.grade.percent)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">
                      {formatNumber(student.grade.score)}
                      <span className="text-[var(--muted)]">
                        /{formatNumber(student.grade.maxScore)}
                      </span>
                    </span>
                    <span className="w-11 text-right text-xs font-semibold tabular-nums text-[var(--sage)]">
                      {formatNumber(student.grade.percent)}%
                    </span>
                  </>
                ) : (
                  <span
                    className={`text-xs font-semibold ${
                      pending ? "text-[#70501f]" : "italic text-[var(--muted)]"
                    }`}
                  >
                    {pending ? "Awaiting validation" : "Not validated"}
                  </span>
                )}

                <Link
                  className="rounded-lg border border-[var(--sage)]/25 bg-white px-3 py-1.5 text-[11px] font-bold text-[var(--sidebar)] transition hover:bg-[var(--soft-mint)]"
                  href={`/analytics/${grades.assignment.id}/corrected-copies/${student.membershipId}`}
                >
                  {pending ? "Review proposal" : student.grade ? "View grade" : "Open copy"}
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--sage)]/15 bg-white px-3 py-2 text-center">
      <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-[var(--ink)]">
        {value}
      </dd>
    </div>
  );
}
