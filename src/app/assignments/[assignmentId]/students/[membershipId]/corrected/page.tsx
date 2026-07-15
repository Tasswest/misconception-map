import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PrintButton } from "@/components/practice/print-button";
import { isOpenAIConfigured } from "@/lib/config";
import { getCorrectedExam } from "@/server/repositories/corrected-exam";

export const dynamic = "force-dynamic";

function verdictLabel(outcome: string) {
  if (outcome === "CORRECT") return "Correct";
  if (outcome === "MISCONCEPTION") return "Correction needed";
  return "Needs teacher review";
}

function reviewReasonLabel(reason: string) {
  return reason
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

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
      <div className="corrected-copy-root print-root mx-auto max-w-5xl px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <div className="print-hidden mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <Link
              className="text-xs font-semibold text-[var(--sage)] transition hover:text-[var(--ink)]"
              href={`/assignments/${assignmentId}/dashboard`}
            >
              ← Back to class heatmap
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
              Corrected copy · {exam.studentName}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {exam.diagnosedProblemCount} of {exam.totalProblemCount}{" "}
              {exam.totalProblemCount === 1
                ? "problem has"
                : "problems have"}{" "}
              diagnostic feedback.
            </p>
          </div>
          <div className="sm:text-right">
            <PrintButton label="Download corrected copy (PDF)" />
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Choose “Save as PDF” in the print dialog.
            </p>
          </div>
        </div>

        <section className="corrected-copy-sheet print-sheet rounded-[24px] border border-black/[0.08] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] md:p-9">
          <header className="corrected-copy-header flex items-start justify-between gap-6 border-b-2 border-[var(--sidebar)] pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
                Returnable corrected copy
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {exam.assignmentTitle}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {exam.className}
              </p>
            </div>
            <div className="text-right text-xs leading-6 text-[var(--muted)]">
              <p className="font-semibold text-[var(--ink)]">
                {exam.studentName}
              </p>
              <p>Teacher diagnostic copy</p>
            </div>
          </header>

          {exam.sourcePages.length > 0 ? (
            <div className="corrected-copy-sources mt-6 space-y-6">
              {exam.sourcePages.map((source) => (
                <figure
                  className="corrected-copy-source break-inside-avoid"
                  key={source.submissionId}
                >
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <figcaption className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                      {source.label}
                    </figcaption>
                    <span className="rounded-full bg-[var(--canvas)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                      Preprocessed copy
                    </span>
                  </div>
                  {source.status === "FAILED" ||
                  source.status === "NEEDS_REVIEW" ||
                  source.reviewNote ? (
                    <div className="mb-3 rounded-xl border border-[var(--amber)]/45 bg-[var(--amber)]/12 px-3 py-2 text-xs leading-5 text-[#70501f]">
                      <span className="font-semibold">Teacher review:</span>{" "}
                      {source.reviewNote ??
                        (source.status === "FAILED"
                          ? "Automatic diagnosis did not finish, but the submitted page is preserved here for review."
                          : "Automatic diagnosis needs teacher review. The submitted page is preserved here alongside any safely matched feedback.")}
                    </div>
                  ) : null}
                  <div className="corrected-copy-image-frame relative overflow-hidden rounded-2xl border border-black/10 bg-white">
                    <Image
                      alt={`Submitted work for ${exam.assignmentTitle}`}
                      className="corrected-copy-image h-auto w-full object-contain"
                      height={source.height}
                      priority
                      src={source.src}
                      unoptimized
                      width={source.width}
                    />
                    {source.markers.map((marker) => (
                      <div
                        aria-label={`Problem ${marker.position} location on submitted page`}
                        className="corrected-copy-marker absolute rounded-md border-2 border-[var(--coral)] bg-[var(--soft-coral)]/15"
                        key={`${source.submissionId}-${marker.position}`}
                        style={{
                          left: `${marker.region.x * 100}%`,
                          top: `${marker.region.y * 100}%`,
                          width: `${marker.region.width * 100}%`,
                          height: `${marker.region.height * 100}%`,
                        }}
                      >
                        <span className="absolute left-1 top-1 grid size-6 place-items-center rounded-full bg-[var(--coral)] text-[11px] font-bold text-white shadow-sm">
                          {marker.position}
                        </span>
                      </div>
                    ))}
                  </div>
                </figure>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-black/8 bg-[var(--canvas)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
              This corrected copy was created from typed or seeded work, so no
              submitted page image is available.
            </div>
          )}

          <div className="corrected-copy-feedback mt-7 space-y-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                  Problem-by-problem correction
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Each note is grounded in the visible student work. Review
                  uncertain items before returning this copy.
                </p>
              </div>
            </div>

            {exam.items.map((item) => {
              const diagnosis = item.diagnosis;
              const needsReview =
                diagnosis !== null &&
                diagnosis.outcome !== "CORRECT" &&
                diagnosis.outcome !== "MISCONCEPTION";

              return (
                <article
                  className="corrected-copy-problem break-inside-avoid rounded-2xl border border-black/[0.08] bg-white/55 p-5"
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

                      {!diagnosis ? (
                        <div className="mt-3 rounded-xl border border-[var(--amber)]/45 bg-[var(--amber)]/12 px-3 py-2 text-xs leading-5 text-[#70501f]">
                          <span className="font-semibold">
                            Needs teacher review —
                          </span>{" "}
                          no student work was matched safely to this problem.
                      </div>
                      ) : (
                        <>
                          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                            <span
                              className={`rounded-full px-2.5 py-1 ${
                                diagnosis.outcome === "CORRECT"
                                  ? "bg-[var(--soft-mint)] text-[#426d5b]"
                                  : diagnosis.outcome === "MISCONCEPTION"
                                    ? "bg-[var(--soft-coral)] text-[#8e402d]"
                                    : "bg-[var(--amber)]/18 text-[#70501f]"
                              }`}
                            >
                              {verdictLabel(diagnosis.outcome)}
                            </span>
                            {diagnosis.misconceptionLabel ? (
                              <span className="rounded-full bg-[var(--soft-coral)] px-2.5 py-1 text-[#8e402d]">
                                {diagnosis.misconceptionLabel}
                              </span>
                            ) : null}
                          </div>

                          {needsReview ? (
                            <div className="mt-3 rounded-xl border border-[var(--amber)]/45 bg-[var(--amber)]/12 px-3 py-2 text-xs leading-5 text-[#70501f]">
                              <span className="font-semibold">
                                Needs teacher review —
                              </span>{" "}
                              {diagnosis.reviewReasons.length > 0
                                ? diagnosis.reviewReasons
                                    .map(reviewReasonLabel)
                                    .join("; ")
                                : "the available evidence does not support a safe automatic verdict."}
                            </div>
                          ) : null}

                          <div className="mt-4 rounded-xl bg-[var(--canvas)] px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                              Transcribed student work
                            </p>
                            <p className="mt-1 whitespace-pre-wrap font-mono text-sm leading-6">
                              {diagnosis.transcription}
                            </p>
                          </div>

                          <ol className="mt-4 space-y-2">
                            {diagnosis.steps.map((step) => {
                              const note =
                                step.correctness === "CORRECT"
                                  ? step.correctNote ??
                                    "This step is mathematically consistent with the previous work."
                                  : step.errorNote ??
                                    "This step needs teacher review.";
                              return (
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
                                    <span
                                      aria-hidden="true"
                                      className="text-sm font-bold"
                                    >
                                      {step.correctness === "CORRECT"
                                        ? "✓"
                                        : step.correctness === "INCORRECT"
                                          ? "✕"
                                          : "?"}
                                    </span>
                                    <div>
                                      <p className="font-mono text-sm leading-6">
                                        {step.step}
                                      </p>
                                      <p
                                        className={`mt-1 text-xs leading-5 ${
                                          step.correctness === "CORRECT"
                                            ? "text-[#426d5b]"
                                            : step.correctness === "INCORRECT"
                                              ? "text-[#8e402d]"
                                              : "text-[#70501f]"
                                        }`}
                                      >
                                        <span className="font-semibold">
                                          {step.correctness === "CORRECT"
                                            ? "Why correct: "
                                            : step.correctness === "INCORRECT"
                                              ? "Why wrong: "
                                              : "Teacher check: "}
                                        </span>
                                        {note}
                                      </p>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
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
              );
            })}
          </div>

          <p className="corrected-copy-footer mt-6 border-t border-black/10 pt-4 text-[10px] leading-5 text-[var(--muted)]">
            Feedback is generated from observable steps and assignment-owned
            answer context. “Needs teacher review” means the system abstained
            rather than guessing.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
