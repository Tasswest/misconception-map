"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  AlertIcon,
  GridIcon,
  SparkIcon,
  SpinnerIcon,
  XIcon,
} from "@/components/icons";
import { AnalyticsHeader } from "@/components/analytics/analytics-navigation";
import { ErrorLog } from "@/components/analytics/error-log";
import { EvidenceLegend } from "@/components/evidence-legend";
import { AiUnavailableNotice } from "@/components/readiness-states";
import type {
  HeatmapDashboard,
  HeatmapDiagnosisDetail,
} from "@/server/repositories/dashboard";
import { formatUtcTimestamp } from "@/lib/date-format";

type SelectedDiagnosis = {
  studentName: string;
  teacherLabel: string;
  formalLabel: string;
  citationNote: string;
  detail: HeatmapDiagnosisDetail;
};

export function MisconceptionHeatmap({
  dashboard,
  liveAiReady,
}: {
  dashboard: HeatmapDashboard;
  liveAiReady: boolean;
}) {
  const [selected, setSelected] = useState<SelectedDiagnosis | null>(null);
  const selectedCellRef = useRef<HTMLButtonElement | null>(null);
  const [teachingBrief, setTeachingBrief] = useState(dashboard.teachingBrief);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const repeatedColumns = dashboard.columns.filter(
    (column) => column.frequency >= 2,
  );
  const totalAssessed = dashboard.exercises.reduce(
    (sum, exercise) => sum + exercise.assessedCount,
    0,
  );
  const totalCorrect = dashboard.exercises.reduce(
    (sum, exercise) => sum + exercise.correctCount,
    0,
  );

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelected(null);
      window.requestAnimationFrame(() => selectedCellRef.current?.focus());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  function closeDiagnosisDrawer() {
    setSelected(null);
    window.requestAnimationFrame(() => selectedCellRef.current?.focus());
  }

  function openDiagnosis(
    sourceButton: HTMLButtonElement,
    studentName: string,
    column: HeatmapDashboard["columns"][number],
    detail: HeatmapDiagnosisDetail,
  ) {
    selectedCellRef.current = sourceButton;
    setSelected({
      studentName,
      teacherLabel: column.teacherLabel,
      formalLabel: column.label,
      citationNote: column.citationNote,
      detail,
    });
  }

  async function createTeachingBrief() {
    if (briefBusy || !liveAiReady) return;
    setBriefBusy(true);
    setBriefError(null);
    try {
      const data = await postGeneration(
        `/api/assignments/${encodeURIComponent(dashboard.assignment.id)}/teaching-brief`,
        {},
      );
      setTeachingBrief(data as NonNullable<HeatmapDashboard["teachingBrief"]>);
    } catch (error) {
      setBriefError(messageFromError(error));
    } finally {
      setBriefBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <AnalyticsHeader
        activeTab="class"
        assignment={dashboard.assignment}
        description="Start with the biggest difficulty, read the evidence behind it, then check any student in the grid."
      />

      {!liveAiReady ? <AiUnavailableNotice className="mt-5" /> : null}

      {repeatedColumns.length ? (
        <>
          <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/[0.06] px-5 py-4 md:px-6">
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
                What is known
              </p>
              <p className="text-xs font-medium text-[var(--muted)]">
                {dashboard.diagnosedStudentCount} of {dashboard.studentCount} students diagnosed
              </p>
            </div>
            <div className="grid grid-cols-2 divide-black/[0.06] max-md:gap-y-px md:grid-cols-4 md:divide-x">
              <SummaryStat
                label="diagnosed items correct"
                tone="mint"
                value={`${totalCorrect}/${totalAssessed}`}
              />
              <SummaryStat
                label={`repeated error ${dashboard.errorInventory.totals.misconceptionTypeCount === 1 ? "pattern" : "patterns"} · ${dashboard.errorInventory.totals.misconceptionOccurrenceCount} ${dashboard.errorInventory.totals.misconceptionOccurrenceCount === 1 ? "occurrence" : "occurrences"}`}
                tone="coral"
                value={`${dashboard.errorInventory.totals.misconceptionTypeCount}`}
              />
              <SummaryStat
                label={dashboard.errorInventory.totals.slipCount === 1 ? "one-off slip" : "one-off slips"}
                tone="amber"
                value={`${dashboard.errorInventory.totals.slipCount}`}
              />
              <SummaryStat
                label="flagged as uncertain"
                tone="amber"
                value={`${dashboard.summary.awaitingReviewCount}`}
              />
            </div>
          </section>

          <section className="mt-5 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
            <div className="border-b border-black/[0.06] px-5 py-5 md:px-6">
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
                Class priorities
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
                Most frequent difficulties
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                The bar shows how much of the class is affected. Select a student to read the exact work behind the label.
              </p>
            </div>
            <div className="space-y-3 p-5 md:p-6">
              {repeatedColumns.map((column, index) => {
                const columnIndex = dashboard.columns.findIndex(
                  (candidate) => candidate.misconceptionId === column.misconceptionId,
                );
                const affected = dashboard.rows
                  .map((row) => ({ row, cell: row.cells[columnIndex] }))
                  .filter(({ cell }) => cell?.state === "MISCONCEPTION")
                  .sort(
                    (left, right) =>
                      right.cell.frequency - left.cell.frequency ||
                      left.row.studentName.localeCompare(right.row.studentName),
                  );
                const clearCount = dashboard.rows.filter(
                  (row) => row.cells[columnIndex]?.state === "CLEAR",
                ).length;
                const width = Math.max(
                  6,
                  Math.round((column.affectedCount / Math.max(dashboard.studentCount, 1)) * 100),
                );
                return (
                  <div
                    className={`rounded-2xl border p-4 ${
                      index === 0
                        ? "border-[var(--coral)]/25 bg-[var(--soft-coral)]"
                        : "border-black/[0.06] bg-white/55"
                    }`}
                    key={column.misconceptionId}
                    title={`${column.label}. ${column.citationNote}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{column.teacherLabel}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {column.affectedCount} of {dashboard.studentCount} {column.affectedCount === 1 ? "student" : "students"} · {column.frequency} {column.frequency === 1 ? "occurrence" : "occurrences"}
                          {clearCount
                            ? ` · ${clearCount} showed correct reasoning on the same items`
                            : ""}
                        </p>
                      </div>
                      {index === 0 ? (
                        teachingBrief ? (
                          <Link
                            className="rounded-lg bg-[var(--sidebar)] px-3 py-2 text-xs font-semibold text-white"
                            href={`/analytics/${dashboard.assignment.id}/practice`}
                          >
                            Teach This Tomorrow →
                          </Link>
                        ) : (
                          <button
                            className="inline-flex items-center gap-2 rounded-lg bg-[var(--sidebar)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={briefBusy || !liveAiReady}
                            onClick={(event) => {
                              event.preventDefault();
                              void createTeachingBrief();
                            }}
                            type="button"
                          >
                            {briefBusy ? <SpinnerIcon className="size-3.5 animate-spin" /> : <SparkIcon className="size-3.5" />}
                            Teach This Tomorrow
                          </button>
                        )
                      ) : null}
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.06]">
                      <div
                        className={`h-full rounded-full ${index === 0 ? "bg-[var(--coral)]" : "bg-[var(--amber)]"}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {affected.map(({ row, cell }) => (
                        <button
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] transition hover:scale-[1.03] ${
                            cell.frequency > 1
                              ? "bg-[var(--coral)]/85 text-white"
                              : "bg-[var(--amber)]/30 text-[#5c451a]"
                          }`}
                          key={row.membershipId}
                          onClick={(event) => {
                            if (!cell.detail) return;
                            openDiagnosis(
                              event.currentTarget,
                              row.studentName,
                              column,
                              cell.detail,
                            );
                          }}
                          title={`${row.studentName}: ${cell.frequency} ${cell.frequency === 1 ? "occurrence" : "occurrences"} — select to read the work`}
                          type="button"
                        >
                          {row.studentName}
                          {cell.frequency > 1 ? ` ×${cell.frequency}` : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <a className="inline-flex text-xs font-semibold text-[var(--sage)]" href="#per-student-detail">
                See per-student detail ↓
              </a>
            </div>
          </section>
        </>
      ) : (
        <section className="mt-6 flex flex-col gap-5 rounded-[24px] border border-[var(--sage)]/15 bg-[var(--paper)] px-5 py-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              What is known
            </p>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.03em]">
              {dashboard.summary.diagnosedCount === 0
                ? "0 items diagnosed"
                : `${dashboard.summary.diagnosedCount} ${dashboard.summary.diagnosedCount === 1 ? "item" : "items"} diagnosed${dashboard.summary.correctCount === dashboard.summary.diagnosedCount ? " — all correct" : ` · ${dashboard.summary.correctCount}/${dashboard.summary.diagnosedCount} correct`}`} · {dashboard.summary.awaitingReviewCount} {dashboard.summary.awaitingReviewCount === 1 ? "item" : "items"} flagged as uncertain{dashboard.summary.notYetDiagnosedExerciseCount > 0 ? ` · ${dashboard.summary.notYetDiagnosedExerciseCount} ${dashboard.summary.notYetDiagnosedExerciseCount === 1 ? "exercise" : "exercises"} not yet diagnosed` : ""}
            </h2>
          </div>
          <Link
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[var(--sidebar)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#244b42]"
            href={`/analytics/${dashboard.assignment.id}/corrected-copies`}
          >
            See corrected copies
          </Link>
        </section>
      )}

      {briefError ? (
        <p
          aria-live="polite"
          className="mt-3 rounded-xl border border-[var(--coral)]/20 bg-[var(--soft-coral)] px-4 py-3 text-sm text-[#8e402d]"
        >
          {briefError}
        </p>
      ) : null}

      {teachingBrief ? (
        <section className="mt-5 overflow-hidden rounded-[24px] border border-[var(--sage)]/15 bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
          <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_320px] md:p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
                Teach This Tomorrow
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
                {teachingBrief.misconceptionLabel}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--ink)]">
                {teachingBrief.paragraph}
              </p>
              <p className="mt-3 text-[10px] font-medium text-[var(--muted)]">
                Evidence snapshot: {teachingBrief.clusterStudentCount} of {teachingBrief.diagnosedStudentCount} diagnosed {teachingBrief.diagnosedStudentCount === 1 ? "student" : "students"} · cutoff {formatDate(teachingBrief.evidenceCutoffAt)}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--sage)]/15 bg-[var(--soft-mint)]/65 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                Put this on the board
              </p>
              <p className="mt-3 whitespace-pre-wrap font-mono text-sm leading-6">
                {teachingBrief.workedExample.problemPrompt}
              </p>
              <div className="mt-4 border-t border-[var(--sage)]/15 pt-3">
                <p className="text-[10px] font-semibold text-[var(--muted)]">Worked answer</p>
                <p className="mt-1 whitespace-pre-wrap font-mono text-sm font-semibold text-[var(--sidebar)]">
                  {teachingBrief.workedExample.correctAnswer}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <ErrorLog inventory={dashboard.errorInventory} />

      <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
        <div className="border-b border-black/[0.06] px-5 py-4 md:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
            Exercise overview
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
            Which exercise needs attention?
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Compare success and flagged work by exercise, then open the per-student detail below for evidence.
          </p>
        </div>
        <div className="divide-y divide-black/[0.06]">
          {dashboard.exercises.map((exercise) => (
            exercise.questionCount === 0 ? (
              <div
                className="flex items-center justify-between gap-4 px-5 py-4 md:px-6"
                key={exercise.id}
              >
                <p className="text-sm font-semibold">
                  {dashboard.exercises.length === 1
                    ? dashboard.assignment.title
                    : exercise.label}
                </p>
                <span className="inline-flex rounded-full bg-[var(--line)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                  Not yet diagnosed
                </span>
              </div>
            ) : (
            <div
              className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(150px,0.8fr)_110px_minmax(220px,1.4fr)_110px] md:items-center md:px-6"
              key={exercise.id}
            >
              <div>
                <a className="text-sm font-semibold underline-offset-4 hover:underline" href="#per-student-detail">
                  {dashboard.exercises.length === 1
                    ? dashboard.assignment.title
                    : exercise.label}
                </a>
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                  {exercise.questionCount} {exercise.questionCount === 1 ? "question" : "questions"}
                  <span className="ml-2 inline-flex rounded-full bg-black/[0.05] px-2 py-0.5">
                    {exercise.taxonomyScope === "FULL"
                      ? "Misconception analysis"
                      : exercise.taxonomyScope === "PARTIAL"
                        ? "Mixed analysis scope"
                        : "Correction only"}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--sidebar)]">
                  {exercise.correctCount}/{exercise.assessedCount} correct
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-[var(--muted)]">diagnosed items</p>
              </div>
              {exercise.dominantMisconception ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Dominant misconception
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {exercise.dominantMisconception.teacherLabel} · {exercise.dominantMisconception.count} {exercise.dominantMisconception.count === 1 ? "occurrence" : "occurrences"}
                </p>
              </div>
              ) : <div aria-hidden="true" />}
              <div className="md:text-right">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                    exercise.flaggedCount
                      ? "bg-[var(--amber)]/18 text-[#765725]"
                      : "bg-[var(--soft-mint)] text-[var(--sage)]"
                  }`}
                >
                  {exercise.flaggedCount
                    ? `${exercise.flaggedCount} flagged as uncertain`
                    : `${exercise.assessedCount} diagnosed`}
                </span>
              </div>
            </div>
            )
          ))}
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]" id="per-student-detail">
        <div className="flex flex-col gap-3 border-b border-black/[0.06] px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              Per-student detail
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
              Which student has which difficulty?
            </h2>
            <p className="mt-2 max-w-4xl text-xs leading-5 text-[var(--muted)]">
              A colored cell = this error is evidenced in this student&apos;s work; the number = how many times; click for the student&apos;s actual work. A student&apos;s name opens their corrected copy.
            </p>
          </div>
          <EvidenceLegend />
        </div>

        {dashboard.columns.length === 0 ? (
          <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
                <GridIcon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">No repeated error pattern yet</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {dashboard.summary.awaitingReviewCount > dashboard.summary.diagnosedCount
                  ? "Most items are flagged as uncertain. Their reasons remain visible in the corrected copies."
                  : dashboard.summary.diagnosedCount > 0
                    ? "No repeated pattern — errors found are isolated slips or outside the algebra/fractions analysis scope."
                    : "No diagnosed work is available yet. Uncertainty reasons remain visible in the corrected copies."}
              </p>
              <Link
                className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
            href={`/analytics/${dashboard.assignment.id}/corrected-copies`}
          >
            See corrected copies
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid min-w-max"
              style={{
                gridTemplateColumns: `210px repeat(${dashboard.columns.length}, minmax(110px, 1fr))`,
              }}
            >
              <div className="sticky left-0 z-20 flex items-end border-b border-r border-black/[0.06] bg-[var(--paper)] px-4 py-3">
                <span className="text-xs font-semibold text-[var(--muted)]">Student</span>
              </div>
              {dashboard.columns.map((column) => (
                <div
                  className="flex flex-col justify-end border-b border-r border-black/[0.06] bg-white/45 p-3"
                  key={column.misconceptionId}
                  title={`${column.label}. ${column.citationNote}`}
                >
                  <p className="text-[11px] font-semibold leading-4 text-[var(--ink)]">
                    {column.teacherLabel}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
                    {column.affectedCount} {column.affectedCount === 1 ? "student" : "students"} · {column.frequency} {column.frequency === 1 ? "occurrence" : "occurrences"}
                  </p>
                </div>
              ))}

              {dashboard.rows.flatMap((row) => [
                <div
                  className="sticky left-0 z-10 flex min-h-[52px] items-center border-b border-r border-black/[0.06] bg-[var(--paper)] px-4 py-2"
                  key={`${row.membershipId}-name`}
                >
                  <div className="min-w-0">
                    <Link
                      className="block truncate text-sm font-semibold underline-offset-4 hover:underline"
                      href={`/analytics/${dashboard.assignment.id}/corrected-copies/${row.membershipId}`}
                      title={`Open the corrected copy for ${row.studentName}`}
                    >
                      {row.studentName}
                    </Link>
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                      {row.diagnosedCount} diagnosed{row.reviewCount ? ` · ${row.reviewCount} flagged as uncertain` : ""}
                    </p>
                  </div>
                </div>,
                ...row.cells.map((cell, columnIndex) => {
                  const column = dashboard.columns[columnIndex];
                  const copy = cellTooltip(
                    cell,
                    column.teacherLabel,
                    column.label,
                    column.citationNote,
                    row.studentName,
                  );
                  return (
                    <div
                      className="grid min-h-[52px] place-items-center border-b border-r border-black/[0.06] p-1.5"
                      key={`${row.membershipId}-${cell.misconceptionId}`}
                    >
                      <button
                        aria-label={copy}
                        className={`grid size-8 place-items-center rounded-lg transition ${cellClass(cell.state, cell.frequency)} ${cell.detail ? "cursor-pointer hover:scale-110 hover:shadow-md" : "cursor-default"}`}
                        disabled={!cell.detail}
                        onClick={(event) => {
                          if (!cell.detail) return;
                          openDiagnosis(
                            event.currentTarget,
                            row.studentName,
                            column,
                            cell.detail,
                          );
                        }}
                        title={copy}
                        type="button"
                      >
                        {cell.state === "MISCONCEPTION" ? (
                          <span className={`text-[11px] font-bold ${cell.frequency > 1 ? "text-white" : "text-[#623326]"}`}>
                            {cell.frequency}
                          </span>
                        ) : cell.state === "REVIEW" ? (
                          <AlertIcon className="size-3.5 text-[#765725]" />
                        ) : cell.state === "CLEAR" ? (
                          <span className="size-2 rounded-full bg-[var(--mint)] ring-1 ring-[var(--sage)]/30" />
                        ) : (
                          <span className="size-1.5 rounded-full bg-black/12" />
                        )}
                      </button>
                    </div>
                  );
                }),
              ])}
            </div>
          </div>
        )}
      </section>

      {selected ? (
        <DiagnosisDrawer selected={selected} onClose={closeDiagnosisDrawer} />
      ) : null}
    </div>
  );
}

function SummaryStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "mint" | "coral" | "amber";
  value: string;
}) {
  const marker =
    tone === "mint"
      ? "bg-[var(--mint)]"
      : tone === "coral"
        ? "bg-[var(--coral)]"
        : "bg-[var(--amber)]";
  return (
    <article className="px-5 py-4 md:px-6">
      <p className="text-2xl font-semibold tracking-[-0.03em]">{value}</p>
      <p className="mt-1 flex items-center gap-1.5 text-xs leading-5 text-[var(--muted)]">
        <span className={`size-2 shrink-0 rounded-full ring-1 ring-black/10 ${marker}`} />
        {label}
      </p>
    </article>
  );
}

async function postGeneration(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: unknown; error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? "The generation request did not complete.",
    );
  }
  if (payload?.data === undefined) {
    throw new Error("The generation request returned no saved result.");
  }
  return payload.data;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "The generation request failed.";
}

const formatDate = formatUtcTimestamp;

function DiagnosisDrawer({
  selected,
  onClose,
}: {
  selected: SelectedDiagnosis;
  onClose: () => void;
}) {
  const { detail } = selected;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);
  return (
    <div
      aria-labelledby="diagnosis-drawer-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-[#10231f]/35 p-3 backdrop-blur-sm md:p-5"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <div className="h-full w-full max-w-xl overflow-y-auto rounded-[24px] bg-[var(--paper)] p-5 shadow-2xl md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
              {selected.studentName} · {detail.questionReference}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]" id="diagnosis-drawer-title">
              {detail.outcome === "MISCONCEPTION"
                ? selected.teacherLabel
                : "AI uncertainty"}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {Math.round(detail.confidence * 100)}% confidence
            </p>
          </div>
          <button
            aria-label="Close diagnosis detail"
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-black/10 bg-white transition hover:bg-[var(--canvas)]"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {detail.outcome === "MISCONCEPTION" ? (
          <div className="mt-5 rounded-2xl border border-black/[0.06] bg-[var(--canvas)] p-4 text-xs leading-5">
            <p><span className="font-semibold">Formal taxonomy label:</span> {selected.formalLabel}</p>
            <p className="mt-1 text-[var(--muted)]">{selected.citationNote}</p>
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
            Problem
          </p>
          <p className="mt-2 whitespace-pre-wrap font-mono text-sm leading-6">
            {detail.problemPrompt}
          </p>
        </div>

        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
            Transcribed work
          </p>
          <div className="mt-3 space-y-2">
            {detail.steps.map((step) => (
              <div
                className={`rounded-xl border px-4 py-3 ${
                  step.correctness === "INCORRECT"
                    ? "border-[var(--coral)]/35 bg-[var(--soft-coral)]"
                    : step.correctness === "UNCLEAR"
                      ? "border-[var(--amber)]/35 bg-[var(--amber)]/10"
                      : "border-[var(--sage)]/15 bg-[var(--soft-mint)]/55"
                }`}
                key={`${detail.diagnosisId}-${step.position}`}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-white/70 text-[10px] font-bold">
                    {step.position}
                  </span>
                  <div className="min-w-0">
                    <p className="whitespace-pre-wrap font-mono text-sm leading-6">{step.step}</p>
                    {step.errorNote ? (
                      <p className="mt-1 text-xs leading-5 text-[#8e402d]">{step.errorNote}</p>
                    ) : null}
                    {step.correctNote ? (
                      <p className="mt-1 text-xs leading-5 text-[#426d5b]">{step.correctNote}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {detail.evidenceQuote ? (
          <div className="mt-5 rounded-2xl border border-[var(--coral)]/25 bg-[var(--soft-coral)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9c4937]">
              Evidence from the work
            </p>
            <p className="mt-2 font-mono text-sm font-semibold">“{detail.evidenceQuote}”</p>
          </div>
        ) : null}

        {detail.reviewReasons.length ? (
          <div className="mt-5">
            <p className="text-xs font-semibold text-[var(--muted)]">Uncertainty reasons</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.reviewReasons.map((reason) => (
                <span
                  className="rounded-full bg-[var(--amber)]/15 px-2.5 py-1 text-[10px] font-semibold text-[#765725]"
                  key={reason}
                >
                  {reason.replaceAll("_", " ").toLowerCase()}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function cellClass(
  state: HeatmapDashboard["rows"][number]["cells"][number]["state"],
  frequency: number,
) {
  if (state === "CLEAR") return "bg-transparent";
  if (state === "REVIEW") return "bg-[var(--amber)]/25 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.035)]";
  if (state === "NO_DATA") return "bg-transparent";
  return frequency > 1
    ? "bg-[var(--coral)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.035)]"
    : "bg-[var(--amber)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.035)]";
}

function cellTooltip(
  cell: HeatmapDashboard["rows"][number]["cells"][number],
  teacherLabel: string,
  formalLabel: string,
  citationNote: string,
  student: string,
) {
  if (cell.state === "MISCONCEPTION") {
    return `${student}: ${cell.detail?.questionReference ? `${cell.detail.questionReference}, ` : ""}${teacherLabel}; ${cell.frequency} ${cell.frequency === 1 ? "occurrence" : "occurrences"}. Formal label: ${formalLabel}. ${citationNote}${cell.evidenceQuote ? ` Evidence: ${cell.evidenceQuote}` : ""}`;
  }
  if (cell.state === "CLEAR") return `${student}: correct reasoning shown on opportunities related to ${teacherLabel}`;
  if (cell.state === "REVIEW") return `${student}: work is flagged as uncertain`;
  return `${student}: not assessed`;
}
