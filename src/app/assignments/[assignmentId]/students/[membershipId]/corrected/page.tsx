import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PrintButton } from "@/components/practice/print-button";
import { isOpenAIConfigured } from "@/lib/config";
import { getCorrectedExam } from "@/server/repositories/corrected-exam";

export const dynamic = "force-dynamic";

export default async function CorrectedExamPage({
  params,
}: {
  params: Promise<{ assignmentId: string; membershipId: string }>;
}) {
  const { assignmentId, membershipId } = await params;
  const exam = getCorrectedExam(assignmentId, membershipId);
  if (!exam) notFound();

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
              Corrected exam · {exam.studentName}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {exam.diagnosedProblemCount} of {exam.totalProblemCount} {exam.totalProblemCount === 1 ? "problem has" : "problems have"} diagnostic feedback.
            </p>
          </div>
          <PrintButton />
        </div>

        <section className="print-sheet rounded-[24px] border border-black/[0.08] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] md:p-9">
          <header className="flex items-start justify-between gap-6 border-b-2 border-[var(--sidebar)] pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
                Corrected student work
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {exam.assignmentTitle}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{exam.className}</p>
            </div>
            <div className="text-right text-xs leading-6 text-[var(--muted)]">
              <p className="font-semibold text-[var(--ink)]">{exam.studentName}</p>
              <p>Teacher diagnostic copy</p>
            </div>
          </header>

          <div className="mt-6 space-y-6">
            {exam.items.map((item) => (
              <article
                className="break-inside-avoid rounded-2xl border border-black/[0.08] bg-white/55 p-5"
                key={item.assignmentItemId}
              >
                <div className="flex items-start gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--sidebar)] text-sm font-bold text-white">
                    {item.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap font-mono text-sm font-semibold leading-6">
                      {item.problemPrompt}
                    </p>
                    {!item.diagnosis ? (
                      <p className="mt-3 rounded-xl bg-[var(--canvas)] px-3 py-2 text-xs text-[var(--muted)]">
                        No matched student work was diagnosed for this problem.
                      </p>
                    ) : (
                      <>
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                          <span className="rounded-full bg-[var(--canvas)] px-2.5 py-1">
                            {item.diagnosis.outcome.replaceAll("_", " ")}
                          </span>
                          {item.diagnosis.misconceptionLabel ? (
                            <span className="rounded-full bg-[var(--soft-coral)] px-2.5 py-1 text-[#8e402d]">
                              {item.diagnosis.misconceptionLabel}
                            </span>
                          ) : null}
                        </div>
                        <ol className="mt-4 space-y-2">
                          {item.diagnosis.steps.map((step) => (
                            <li
                              className={`rounded-xl border px-3 py-3 ${
                                step.correctness === "CORRECT"
                                  ? "border-[var(--sage)]/20 bg-[var(--soft-mint)]/65"
                                  : step.correctness === "INCORRECT"
                                    ? "border-[var(--coral)]/30 bg-[var(--soft-coral)]/65"
                                    : "border-[var(--amber)]/35 bg-[var(--amber)]/10"
                              }`}
                              key={`${item.assignmentItemId}-${step.position}`}
                            >
                              <div className="flex items-start gap-3">
                                <span className="text-sm font-bold" aria-hidden="true">
                                  {step.correctness === "CORRECT"
                                    ? "✓"
                                    : step.correctness === "INCORRECT"
                                      ? "✕"
                                      : "?"}
                                </span>
                                <div>
                                  <p className="font-mono text-sm leading-6">{step.step}</p>
                                  <p className={`mt-1 text-xs leading-5 ${step.correctness === "INCORRECT" ? "text-[#8e402d]" : "text-[#426d5b]"}`}>
                                    {step.correctness === "CORRECT"
                                      ? step.correctNote ?? "This step is mathematically consistent with the previous work."
                                      : step.errorNote ?? "This step needs teacher review."}
                                  </p>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                    <div className="mt-4 rounded-xl border border-[var(--sage)]/15 bg-[var(--soft-mint)] px-3 py-2 text-xs leading-5">
                      <span className="font-semibold">Expected answer:</span>{" "}
                      <span className="font-mono">{item.correctAnswer}</span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <p className="mt-6 border-t border-black/10 pt-4 text-[10px] leading-5 text-[var(--muted)]">
            Feedback is generated from observable steps and assignment-owned answer context. Review abstentions and unclear handwriting before returning this page to a student.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
