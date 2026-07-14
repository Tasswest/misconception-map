"use client";

import Link from "next/link";
import { useState } from "react";

import {
  AlertIcon,
  CheckIcon,
  GridIcon,
  SparkIcon,
  SpinnerIcon,
  XIcon,
} from "@/components/icons";
import type {
  HeatmapDashboard,
  HeatmapDiagnosisDetail,
} from "@/server/repositories/dashboard";

export function MisconceptionHeatmap({
  dashboard,
  liveAiReady,
}: {
  dashboard: HeatmapDashboard;
  liveAiReady: boolean;
}) {
  const [selected, setSelected] = useState<{
    studentName: string;
    misconceptionLabel: string;
    detail: HeatmapDiagnosisDetail;
  } | null>(null);
  const [teachingBrief, setTeachingBrief] = useState(dashboard.teachingBrief);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [practiceBusy, setPracticeBusy] = useState<string | null>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [practiceByTarget, setPracticeByTarget] = useState(() =>
    new Map(
      dashboard.rows.flatMap((row) =>
        row.practice && row.practiceTarget
          ? [[practiceKey(row.membershipId, row.practiceTarget.misconceptionId), row.practice] as const]
          : [],
      ),
    ),
  );

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

  async function createPractice(row: HeatmapDashboard["rows"][number]) {
    if (!row.practiceTarget || practiceBusy || !liveAiReady) return;
    const key = practiceKey(row.membershipId, row.practiceTarget.misconceptionId);
    setPracticeBusy(key);
    setPracticeError(null);
    try {
      const data = await postGeneration(
        `/api/assignments/${encodeURIComponent(dashboard.assignment.id)}/practice`,
        {
          membershipId: row.membershipId,
          misconceptionId: row.practiceTarget.misconceptionId,
        },
      );
      const record = data as Record<string, unknown>;
      const worksheetId = typeof record.id === "string" ? record.id : "";
      if (!worksheetId) throw new Error("The generated worksheet did not return an ID.");
      setPracticeByTarget((current) => {
        const next = new Map(current);
        next.set(key, {
          worksheetId,
          membershipId: row.membershipId,
          misconceptionId: row.practiceTarget!.misconceptionId,
          title: typeof record.title === "string" ? record.title : "Targeted practice",
          modelStatus:
            record.modelStatus === "SUPPORTED" ? "SUPPORTED" : "PROVISIONAL",
          ruleStatement:
            typeof record.ruleStatement === "string"
              ? record.ruleStatement
              : "Provisional rule hypothesis",
          createdAt:
            typeof record.createdAt === "string"
              ? record.createdAt
              : new Date().toISOString(),
        });
        return next;
      });
    } catch (error) {
      setPracticeError(`${row.studentName}: ${messageFromError(error)}`);
    } finally {
      setPracticeBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <Link className="transition hover:text-[var(--ink)]" href="/diagnose">
              Classes
            </Link>
            <span aria-hidden="true">/</span>
            <span>{dashboard.assignment.className}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--sage)]">Heatmap</span>
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
            {dashboard.assignment.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Students and misconceptions are clustered by the strongest shared signal.
          </p>
        </div>
        <Link
          className="inline-flex self-start items-center justify-center rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] md:self-auto"
          href={`/assignments/${dashboard.assignment.id}/diagnose`}
        >
          Add more work
        </Link>
      </div>

      {dashboard.largestCluster ? (
        <section className="mt-6 flex flex-col gap-3 rounded-[22px] border border-[var(--coral)]/20 bg-[var(--soft-coral)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-white/70 text-[#9c4937]">
              <GridIcon className="size-4" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9c4937]">
                Largest cluster
              </p>
              <p className="mt-1 text-base font-semibold text-[var(--ink)]">
                {dashboard.largestCluster.affectedCount} of {dashboard.studentCount} students show {dashboard.largestCluster.shortLabel.toLowerCase()}.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-medium text-[var(--muted)]">
              {dashboard.diagnosedStudentCount} students have diagnosed work
            </p>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#244b42] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={briefBusy || !liveAiReady}
              onClick={() => void createTeachingBrief()}
              title={liveAiReady ? undefined : "Configure OPENAI_API_KEY to generate the brief"}
              type="button"
            >
              {briefBusy ? (
                <SpinnerIcon className="size-3.5 animate-spin" />
              ) : (
                <SparkIcon className="size-3.5" />
              )}
              {briefBusy
                ? "Writing tomorrow’s brief…"
                : teachingBrief
                  ? "Refresh brief"
                  : "Teach This Tomorrow"}
            </button>
          </div>
        </section>
      ) : null}

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
                Evidence snapshot: {teachingBrief.clusterStudentCount} of {teachingBrief.diagnosedStudentCount} diagnosed students · cutoff {formatDate(teachingBrief.evidenceCutoffAt)}
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

      <section className="mt-5 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
        <div className="flex flex-col gap-3 border-b border-black/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
              Class misconception map
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
              {dashboard.columns.length
                ? `${dashboard.columns.length} detected misconception ${dashboard.columns.length === 1 ? "cluster" : "clusters"}`
                : "Waiting for a definitive diagnosis"}
            </h2>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] font-medium text-[var(--muted)]">
            <Legend color="bg-[var(--mint)]" label="No evidence" />
            <Legend color="bg-[var(--amber)]" label="Emerging" />
            <Legend color="bg-[var(--coral)]" label="Strong" />
            <Legend color="bg-[var(--line)]" label="Not assessed" />
          </div>
        </div>

        {practiceError ? (
          <p
            aria-live="polite"
            className="border-b border-[var(--coral)]/15 bg-[var(--soft-coral)] px-5 py-3 text-xs font-medium text-[#8e402d]"
          >
            {practiceError}
          </p>
        ) : null}

        {dashboard.columns.length === 0 ? (
          <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
                <GridIcon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">No misconception cluster yet</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Correct and review-only results are saved, but the heatmap adds columns only when a misconception is supported by observable work.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid min-w-max"
              style={{
                gridTemplateColumns: `250px repeat(${dashboard.columns.length}, minmax(132px, 1fr))`,
              }}
            >
              <div className="sticky left-0 z-20 border-b border-r border-black/[0.06] bg-[var(--paper)] p-4">
                <span className="text-xs font-semibold text-[var(--muted)]">Student</span>
              </div>
              {dashboard.columns.map((column, columnIndex) => (
                <div
                  className={`border-b border-r border-black/[0.06] p-3 ${columnIndex === 0 ? "bg-[var(--soft-coral)]/55" : "bg-white/45"}`}
                  key={column.misconceptionId}
                >
                  <p className="text-xs font-semibold leading-4 text-[var(--ink)]">
                    {column.shortLabel}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
                    {column.affectedCount} students · {column.frequency} signals
                  </p>
                </div>
              ))}

              {dashboard.rows.flatMap((row) => {
                const key = row.practiceTarget
                  ? practiceKey(row.membershipId, row.practiceTarget.misconceptionId)
                  : "";
                const practice = key ? practiceByTarget.get(key) : null;
                return [
                  <div
                    className="sticky left-0 z-10 flex min-h-[88px] items-center border-b border-r border-black/[0.06] bg-[var(--paper)] px-4 py-3"
                    key={`${row.membershipId}-name`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{row.studentName}</p>
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        {row.diagnosedCount} diagnosed{row.reviewCount ? ` · ${row.reviewCount} review` : ""}
                      </p>
                      {row.practiceTarget ? (
                        practice ? (
                          <Link
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--soft-mint)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--sidebar)] transition hover:bg-[var(--mint)]/55"
                            href={`/assignments/${dashboard.assignment.id}/practice/${practice.worksheetId}`}
                          >
                            <CheckIcon className="size-3" /> Open practice
                          </Link>
                        ) : (
                          <button
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--sage)]/20 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[var(--sidebar)] transition hover:bg-[var(--soft-mint)] disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={practiceBusy !== null || !liveAiReady}
                            onClick={() => void createPractice(row)}
                            title={`Generate practice for ${row.practiceTarget.shortLabel}`}
                            type="button"
                          >
                            {practiceBusy === key ? (
                              <SpinnerIcon className="size-3 animate-spin" />
                            ) : (
                              <SparkIcon className="size-3" />
                            )}
                            {practiceBusy === key ? "Generating…" : "Generate practice"}
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>,
                  ...row.cells.map((cell, columnIndex) => {
                    const column = dashboard.columns[columnIndex];
                    const copy = cellTooltip(
                      cell,
                      column.shortLabel,
                      row.studentName,
                    );
                    return (
                      <div
                        className="grid min-h-[88px] place-items-center border-b border-r border-black/[0.06] p-2"
                        key={`${row.membershipId}-${cell.misconceptionId}`}
                      >
                        <button
                          aria-label={copy}
                          className={`group relative grid size-11 place-items-center rounded-xl shadow-[inset_0_0_0_1px_rgba(0,0,0,0.035)] transition ${cellClass(cell.state, cell.severity)} ${cell.detail ? "cursor-pointer hover:scale-105 hover:shadow-md" : "cursor-default"}`}
                          disabled={!cell.detail}
                          onClick={() => {
                            if (!cell.detail) return;
                            setSelected({
                              studentName: row.studentName,
                              misconceptionLabel: column.label,
                              detail: cell.detail,
                            });
                          }}
                          title={copy}
                          type="button"
                        >
                          {cell.state === "MISCONCEPTION" ? (
                            <span className="text-xs font-bold text-[#623326]">
                              {cell.frequency > 1 ? cell.frequency : cell.severity}
                            </span>
                          ) : cell.state === "CLEAR" ? (
                            <CheckIcon className="size-4 text-[var(--sidebar)]" />
                          ) : cell.state === "REVIEW" ? (
                            <AlertIcon className="size-4 text-[#765725]" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-black/15" />
                          )}
                        </button>
                      </div>
                    );
                  }),
                ];
              })}
            </div>
          </div>
        )}
      </section>

      {selected ? (
        <DiagnosisDrawer selected={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function practiceKey(membershipId: string, misconceptionId: string) {
  return `${membershipId}:${misconceptionId}`;
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

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(parsed);
}

function DiagnosisDrawer({
  selected,
  onClose,
}: {
  selected: {
    studentName: string;
    misconceptionLabel: string;
    detail: HeatmapDiagnosisDetail;
  };
  onClose: () => void;
}) {
  const { detail } = selected;
  return (
    <div
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
              {selected.studentName} · Problem {detail.problemPosition}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
              {detail.outcome === "MISCONCEPTION"
                ? selected.misconceptionLabel
                : "Teacher review needed"}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {Math.round(detail.confidence * 100)}% confidence
            </p>
          </div>
          <button
            aria-label="Close diagnosis detail"
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-black/10 bg-white transition hover:bg-[var(--canvas)]"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>

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
            <p className="text-xs font-semibold text-[var(--muted)]">Review reasons</p>
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
  severity: number,
) {
  if (state === "CLEAR") return "bg-[var(--mint)]";
  if (state === "REVIEW") return "bg-[var(--amber)]/25";
  if (state === "NO_DATA") return "bg-[var(--line)]";
  if (severity >= 3) return "bg-[var(--coral)]";
  if (severity === 2) return "bg-[#efab72]";
  return "bg-[var(--amber)]";
}

function cellTooltip(
  cell: HeatmapDashboard["rows"][number]["cells"][number],
  misconception: string,
  student: string,
) {
  if (cell.state === "MISCONCEPTION") {
    return `${student}: ${misconception}, severity ${cell.severity}${cell.frequency > 1 ? `, seen ${cell.frequency} times` : ""}${cell.evidenceQuote ? `. Evidence: ${cell.evidenceQuote}` : ""}`;
  }
  if (cell.state === "CLEAR") return `${student}: no evidence of ${misconception} in diagnosed work`;
  if (cell.state === "REVIEW") return `${student}: work needs teacher review`;
  return `${student}: not assessed`;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
