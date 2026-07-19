"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SpinnerIcon } from "@/components/icons";
import type {
  AssignmentGradeStudent,
  AssignmentGrades as AssignmentGradesData,
} from "@/server/repositories/gradebook";

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function AssignmentGrades({
  grades,
}: {
  grades: AssignmentGradesData;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default a new paper's maximum to whatever the teacher already used on this
  // exam, so marking a roster only asks for the max once.
  const defaultMax =
    grades.students.find((student) => student.grade)?.grade?.maxScore ?? 20;

  function beginEdit(student: AssignmentGradeStudent) {
    setEditing(student.membershipId);
    setScoreInput(student.grade ? String(student.grade.score) : "");
    setMaxInput(String(student.grade?.maxScore ?? defaultMax));
    setError(null);
  }

  async function saveGrade(membershipId: string) {
    const score = Number(scoreInput);
    const maxScore = Number(maxInput);
    if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
      setError("Enter a score and a maximum above zero.");
      return;
    }
    if (score < 0 || score > maxScore) {
      setError("The score must be between 0 and the maximum.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/assignments/${encodeURIComponent(grades.assignment.id)}/grades`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ membershipId, score, maxScore }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "The grade could not be saved.");
      }
      setEditing(null);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The grade could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const stats = grades.stats;
  const gradedRank = grades.students.filter((student) => student.grade);

  return (
    <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
      <header className="flex flex-col gap-4 border-b border-black/[0.06] px-5 py-5 sm:flex-row sm:items-start sm:justify-between md:px-7">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Grades</h2>
          <p className="mt-1 max-w-[46ch] text-xs leading-5 text-[var(--muted)]">
            Marks you enter yourself, kept separate from the AI diagnosis. The
            engine never assigns a grade — this is your record of the paper.
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
          {grades.gradedCount} of {grades.studentCount} graded
        </span>
        <span className="hidden sm:inline">Ranked by score</span>
      </div>

      <ol className="divide-y divide-black/[0.05] border-t border-black/[0.05]">
        {grades.students.map((student) => {
          const rank = student.grade
            ? gradedRank.indexOf(student) + 1
            : null;
          const isEditing = editing === student.membershipId;
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
                  <span className="text-xs font-medium italic text-[var(--muted)]">
                    Not graded
                  </span>
                )}

                {!isEditing ? (
                  <button
                    className="rounded-lg border border-[var(--sage)]/25 bg-white px-3 py-1.5 text-[11px] font-bold text-[var(--sidebar)] transition hover:bg-[var(--soft-mint)]"
                    onClick={() => beginEdit(student)}
                    type="button"
                  >
                    {student.grade ? "Edit" : "Add grade"}
                  </button>
                ) : null}
              </div>

              {isEditing ? (
                <form
                  className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveGrade(student.membershipId);
                  }}
                >
                  <label className="sr-only" htmlFor={`score-${student.membershipId}`}>
                    Score for {student.studentName}
                  </label>
                  <input
                    autoFocus
                    className="w-16 rounded-lg border border-black/10 px-2.5 py-1.5 text-sm font-medium tabular-nums outline-none focus:border-[var(--sage)]"
                    disabled={busy}
                    id={`score-${student.membershipId}`}
                    inputMode="decimal"
                    onChange={(event) => setScoreInput(event.target.value)}
                    placeholder="0"
                    value={scoreInput}
                  />
                  <span className="text-sm text-[var(--muted)]">/</span>
                  <label className="sr-only" htmlFor={`max-${student.membershipId}`}>
                    Maximum score
                  </label>
                  <input
                    className="w-16 rounded-lg border border-black/10 px-2.5 py-1.5 text-sm font-medium tabular-nums outline-none focus:border-[var(--sage)]"
                    disabled={busy}
                    id={`max-${student.membershipId}`}
                    inputMode="decimal"
                    onChange={(event) => setMaxInput(event.target.value)}
                    placeholder="20"
                    value={maxInput}
                  />
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--sidebar)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45"
                    disabled={busy}
                    type="submit"
                  >
                    {busy ? <SpinnerIcon className="size-3 animate-spin" /> : null}
                    Save
                  </button>
                  <button
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)]"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setError(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </form>
              ) : null}

              {isEditing && error ? (
                <p
                  aria-live="polite"
                  className="w-full text-xs text-[#9c4937]"
                >
                  {error}
                </p>
              ) : null}
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
