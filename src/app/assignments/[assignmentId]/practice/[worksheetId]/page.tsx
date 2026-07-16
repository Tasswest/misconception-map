import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PrintButton } from "@/components/practice/print-button";
import { isOpenAIConfigured } from "@/lib/config";
import { getPrintableWorksheet } from "@/server/repositories/instructional-support";

export const dynamic = "force-dynamic";

export default async function PracticeWorksheetPage({
  params,
}: {
  params: Promise<{ assignmentId: string; worksheetId: string }>;
}) {
  const { assignmentId, worksheetId } = await params;
  const worksheet = getPrintableWorksheet(worksheetId);
  if (!worksheet || worksheet.assignmentId !== assignmentId) notFound();

  return (
    <AppShell activeNav="Dashboard" liveAiReady={isOpenAIConfigured()}>
      <div className="print-root mx-auto max-w-5xl px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <div className="print-hidden mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <Link
              className="text-xs font-semibold text-[var(--sage)] transition hover:text-[var(--ink)]"
              href={`/assignments/${assignmentId}/dashboard`}
            >
              ← Back to class heatmap
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
              {worksheet.title}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Preview both pages, then print or save as PDF from your browser.
            </p>
          </div>
          <PrintButton />
        </div>

        <section className="print-sheet rounded-[24px] border border-black/[0.08] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] md:p-9">
          <header className="flex items-start justify-between gap-6 border-b-2 border-[var(--sidebar)] pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
                Targeted micro-practice
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {worksheet.title}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {worksheet.assignmentTitle} · {worksheet.className}
              </p>
              {worksheet.sourceReference ? (
                <p className="mt-1 text-xs font-semibold text-[var(--sage)]">
                  Targeted from {worksheet.sourceReference}
                </p>
              ) : null}
            </div>
            <div className="text-right text-xs leading-6 text-[var(--muted)]">
              <p>
                Name: <span className="font-semibold text-[var(--ink)]">{worksheet.studentName}</span>
              </p>
              <p>Date: __________________</p>
            </div>
          </header>

          <div className="mt-6 rounded-2xl bg-[var(--soft-mint)] px-4 py-3 text-sm leading-6">
            <span className="font-semibold">Before you begin:</span>{" "}
            {worksheet.rationale}
          </div>

          <ol className="mt-7 space-y-7">
            {worksheet.items.map((item) => (
              <li className="break-inside-avoid" key={item.position}>
                <div className="flex items-start gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--sidebar)] text-sm font-bold text-white">
                    {item.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <p className="whitespace-pre-wrap font-mono text-base font-semibold leading-7">
                        {item.problemPrompt}
                      </p>
                      <span className="rounded-full bg-[var(--canvas)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                        Level {item.difficulty}
                      </span>
                    </div>
                    <div className="mt-5 h-12 border-b border-black/35" />
                    <p className="mt-2 text-[11px] text-[var(--muted)]">
                      Hint if you need it: {item.hint}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="print-sheet print-page-break mt-6 rounded-[24px] border border-black/[0.08] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] md:p-9">
          <header className="border-b-2 border-[var(--sidebar)] pb-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Teacher answer key · {worksheet.studentName}
              {worksheet.sourceReference ? ` · ${worksheet.sourceReference}` : ""}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Make the mismatch visible
            </h2>
          </header>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[var(--amber)]/35 bg-[var(--amber)]/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#765725]">
                {worksheet.modelStatus === "SUPPORTED" ? "Supported" : "Provisional"} student-model hypothesis
              </p>
              <p className="mt-2 text-sm font-semibold leading-6">
                {worksheet.ruleStatement}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--sage)]/20 bg-[var(--soft-mint)] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                Why these problems
              </p>
              <p className="mt-2 text-sm leading-6">
                Each item is a discrepant event: the provisional rule predicts a visibly different answer from the mathematically correct rule. Discussing that mismatch gives the student evidence to revise the rule.
              </p>
            </div>
          </div>

          <ol className="mt-7 space-y-5">
            {worksheet.items.map((item) => (
              <li
                className="break-inside-avoid rounded-2xl border border-black/[0.07] bg-white/55 p-4"
                key={item.position}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--sidebar)] text-xs font-bold text-white">
                    {item.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap font-mono text-sm font-semibold leading-6">
                      {item.problemPrompt}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Answer label="Correct answer" tone="correct" value={item.correctAnswer} />
                      <Answer label="Model predicts" tone="predicted" value={item.predictedAnswer} />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[var(--ink)]">
                      <span className="font-semibold">Explain:</span>{" "}
                      {item.explanation}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                      {item.discrepantEventRationale}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 border-t border-black/10 pt-4 text-[10px] leading-5 text-[var(--muted)]">
            This rule is a versioned, falsifiable hypothesis based on observed work—not a fixed attribute or an ability label. Confirm or revise it as new answers arrive.
          </p>
        </section>
      </div>
    </AppShell>
  );
}

function Answer({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "correct" | "predicted";
}) {
  return (
    <div
      className={
        tone === "correct"
          ? "rounded-xl bg-[var(--soft-mint)] px-3 py-2"
          : "rounded-xl bg-[var(--soft-coral)] px-3 py-2"
      }
    >
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
