import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AnalyticsTabs } from "@/components/analytics/analytics-navigation";
import { AssignmentStepper } from "@/components/assignment-stepper";
import { PrintButton } from "@/components/practice/print-button";
import { isOpenAIConfigured } from "@/lib/config";
import { formatUtcTimestamp } from "@/lib/date-format";
import { getPrintableFollowUpEvaluation } from "@/server/repositories/follow-up-evaluation";

export const dynamic = "force-dynamic";

const targetToneByKind = {
  MISCONCEPTION: "bg-[var(--soft-coral)] text-[#8e402d]",
  SLIP: "bg-[var(--amber)]/18 text-[#765725]",
  UNCERTAIN_RETEST: "bg-[var(--canvas)] text-[var(--muted)]",
} as const;

const targetNameByKind = {
  MISCONCEPTION: "Repeated pattern",
  SLIP: "One-off slip",
  UNCERTAIN_RETEST: "Uncertain item retest",
} as const;

export default async function FollowUpEvaluationPage({
  params,
}: {
  params: Promise<{ assignmentId: string; evaluationId: string }>;
}) {
  const { assignmentId, evaluationId } = await params;
  const evaluation = getPrintableFollowUpEvaluation(evaluationId);
  if (!evaluation || evaluation.assignmentId !== assignmentId) notFound();

  return (
    <AppShell activeNav="Analytics" liveAiReady={isOpenAIConfigured()}>
      <div className="print-root mx-auto max-w-5xl px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <AssignmentStepper
          assignmentId={assignmentId}
          className="print-hidden mb-7"
          currentStep={4}
        />
        <AnalyticsTabs
          activeTab="practice"
          assignmentId={assignmentId}
          className="print-hidden mb-5"
        />
        <div className="print-hidden mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <Link
              className="text-xs font-semibold text-[var(--sage)] transition hover:text-[var(--ink)]"
              href={`/analytics/${assignmentId}/practice`}
            >
              ← Back to practice &amp; brief
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
              {evaluation.title}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Version {evaluation.version} · generated {formatUtcTimestamp(evaluation.createdAt)} ·
              every question retests an observed mistake from {evaluation.assignmentTitle}. Review
              and edit on paper before using it in class — this draft never enters the gradebook.
            </p>
          </div>
          <PrintButton />
        </div>

        <section className="print-sheet rounded-[24px] border border-black/[0.08] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] md:p-9">
          <header className="flex items-start justify-between gap-6 border-b-2 border-[var(--sidebar)] pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
                Follow-up evaluation
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {evaluation.title}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {evaluation.assignmentTitle} · {evaluation.className}
              </p>
            </div>
            <div className="text-right text-xs leading-6 text-[var(--muted)]">
              <p>Name: __________________</p>
              <p>Date: __________________</p>
              <p className="font-semibold text-[var(--ink)]">
                {evaluation.questionCount} questions · {evaluation.totalPoints} points
              </p>
            </div>
          </header>

          <div className="mt-7 space-y-8">
            {evaluation.exercises.map((exercise) => (
              <div className="break-inside-avoid" key={exercise.position}>
                <h3 className="border-b border-black/15 pb-2 text-lg font-semibold tracking-[-0.02em]">
                  {exercise.exerciseLabel}
                </h3>
                {exercise.sharedContext ? (
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--canvas)] px-4 py-3 text-sm leading-6">
                    {exercise.sharedContext}
                  </p>
                ) : null}
                <ol className="mt-4 space-y-6">
                  {exercise.questions.map((question) => (
                    <li className="break-inside-avoid" key={question.position}>
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 rounded-lg bg-[var(--sidebar)] px-2 py-1 text-xs font-bold text-white">
                          {question.questionLabel}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-4">
                            <p className="whitespace-pre-wrap font-mono text-base leading-7">
                              {question.prompt}
                            </p>
                            <span className="shrink-0 rounded-full bg-[var(--canvas)] px-2.5 py-1 text-[10px] font-bold text-[var(--muted)]">
                              {question.points} {question.points === 1 ? "pt" : "pts"}
                            </span>
                          </div>
                          <div className="mt-5 h-14 border-b border-black/35" />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>

        <section className="print-sheet print-page-break mt-6 rounded-[24px] border border-black/[0.08] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.06)] md:p-9">
          <header className="border-b-2 border-[var(--sidebar)] pb-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Teacher answer key · {evaluation.title}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              What each question retests
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {evaluation.overview}
            </p>
            <p className="mt-3 text-xs font-semibold text-[var(--muted)]">
              Coverage: {evaluation.targeted.misconceptionTypeCount}{" "}
              {evaluation.targeted.misconceptionTypeCount === 1
                ? "repeated pattern"
                : "repeated patterns"}
              {evaluation.targeted.slipQuestionCount > 0
                ? ` · ${evaluation.targeted.slipQuestionCount} slip ${evaluation.targeted.slipQuestionCount === 1 ? "retest" : "retests"}`
                : ""}
              {evaluation.targeted.uncertainRetestCount > 0
                ? ` · ${evaluation.targeted.uncertainRetestCount} uncertain-item ${evaluation.targeted.uncertainRetestCount === 1 ? "retest" : "retests"}`
                : ""}
            </p>
          </header>

          <div className="mt-6 space-y-6">
            {evaluation.exercises.map((exercise) => (
              <div key={exercise.position}>
                <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                  {exercise.exerciseLabel}
                </h3>
                <ol className="mt-3 space-y-4">
                  {exercise.questions.map((question) => (
                    <li
                      className="break-inside-avoid rounded-2xl border border-black/[0.07] bg-white/55 p-4"
                      key={question.position}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 rounded-lg bg-[var(--sidebar)] px-2 py-1 text-xs font-bold text-white">
                          {question.questionLabel}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap font-mono text-sm font-semibold leading-6">
                            {question.prompt}
                          </p>
                          <p className="mt-2 rounded-xl bg-[var(--soft-mint)] px-3 py-2 font-mono text-sm font-semibold">
                            {question.expectedAnswer}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                              className={`rounded-full px-2.5 py-1 font-semibold ${targetToneByKind[question.targetKind]}`}
                            >
                              {targetNameByKind[question.targetKind]}
                              {question.targetLabel ? `: ${question.targetLabel}` : ""}
                            </span>
                            <span className="text-[var(--muted)]">
                              Seen at {question.sourceQuestionReference}
                              {question.targetKind !== "UNCERTAIN_RETEST"
                                ? ` · ${question.affectedStudentCount} ${question.affectedStudentCount === 1 ? "student" : "students"}`
                                : ""}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-[var(--ink)]">
                            {question.whyThisQuestion}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <p className="mt-6 border-t border-black/10 pt-4 text-[10px] leading-5 text-[var(--muted)]">
            This evaluation is an AI draft grounded in the diagnosed mistakes of{" "}
            {evaluation.assignmentTitle}. The teacher decides what to keep, edit, or discard; nothing
            here enters the gradebook or any statistic.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
