import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AssignmentStepper } from "@/components/assignment-stepper";
import { PrintButton } from "@/components/practice/print-button";
import { isOpenAIConfigured } from "@/lib/config";
import {
  getCorrectedExam,
  type CorrectedExam,
} from "@/server/repositories/corrected-exam";

export const dynamic = "force-dynamic";

function verdictLabel(outcome: string, french = false) {
  if (outcome === "CORRECT") return french ? "Correct" : "Correct";
  if (outcome === "MISCONCEPTION")
    return french ? "Correction nécessaire" : "Correction needed";
  return french ? "À vérifier par l’enseignant" : "Needs teacher review";
}

const FRENCH_REVIEW_REASONS: Record<string, string> = {
  MODEL_REQUESTED_REVIEW: "L’IA demande une vérification",
  LOW_CONFIDENCE: "Confiance insuffisante",
  LOW_REASONING_CONFIDENCE: "Raisonnement incertain",
  LOW_TRANSCRIPTION_CONFIDENCE: "Transcription incertaine",
  POOR_IMAGE_QUALITY: "Qualité d’image insuffisante",
  IMAGE_QUALITY_NOT_ASSESSED: "Qualité d’image non évaluée",
  UNREADABLE_TRANSCRIPTION: "Transcription illisible",
  IMPLAUSIBLE_TRANSCRIPTION_STEP: "Étape transcrite peu plausible",
  INSUFFICIENT_WORK_SHOWN: "Travail présenté insuffisant",
  MULTIPLE_PLAUSIBLE_RULES: "Plusieurs interprétations possibles",
  NO_TAXONOMY_MATCH: "Hors du référentiel de notions pris en charge",
  MISSING_EVIDENCE: "Preuve visible manquante",
  UNGROUNDED_EVIDENCE: "Conclusion non étayée par la copie",
  DOMAIN_MISMATCH: "Hors du domaine de l’évaluation",
  INCONSISTENT_OUTPUT: "Résultats contradictoires",
};

function reviewReasonLabel(reason: string, french: boolean) {
  if (french && FRENCH_REVIEW_REASONS[reason]) {
    return FRENCH_REVIEW_REASONS[reason];
  }
  return reason
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function isFrenchExam(exam: CorrectedExam) {
  const text = [
    exam.assignmentTitle,
    ...exam.exercises.flatMap((exercise) => [
      exercise.label,
      exercise.sharedContext ?? "",
      ...exercise.items.map((item) => item.problemPrompt),
    ]),
  ].join(" ");
  return /[àâçéèêëîïôùûüÿœ]|\b(?:calculer|développer|montrer|résoudre|trouver|vérifier|quelle?s?|trajet|dépenses|élève)\b/iu.test(
    text,
  );
}

export default async function CorrectedExamPage({
  params,
}: {
  params: Promise<{ assignmentId: string; membershipId: string }>;
}) {
  const { assignmentId, membershipId } = await params;
  const exam = getCorrectedExam(assignmentId, membershipId);
  if (!exam) notFound();
  const french = isFrenchExam(exam);

  return (
    <AppShell activeNav="Dashboard" liveAiReady={isOpenAIConfigured()}>
      <div className="corrected-copy-root print-root mx-auto max-w-5xl px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <AssignmentStepper
          assignmentId={assignmentId}
          className="print-hidden mb-7"
          currentStep={4}
        />
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

          <nav
            aria-label="Results by exercise"
            className="corrected-copy-summary mt-5"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              At a glance
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {exam.exercises.map((exercise) => {
                const summary = (
                  <>
                    {exam.exercises.length > 1 ? (
                      <span className="font-bold text-[var(--ink)]">
                        {exercise.shortLabel}
                      </span>
                    ) : (
                      <span className="font-bold text-[var(--ink)]">Whole copy</span>
                    )}
                    <span className="text-[#426d5b]">✓ {exercise.counts.correct}</span>
                    <span className="text-[#8e402d]">✕ {exercise.counts.incorrect}</span>
                    <span className="text-[#70501f]">⚠ {exercise.counts.flagged}</span>
                  </>
                );
                const classes =
                  "inline-flex items-center gap-2 rounded-xl border border-black/[0.07] bg-[var(--canvas)] px-3 py-2 text-xs";
                return exam.exercises.length > 1 ? (
                  <a
                    className={`${classes} transition hover:border-[var(--sage)]/35 hover:bg-[var(--soft-mint)]`}
                    href={`#exercise-${exercise.position}`}
                    key={exercise.id}
                  >
                    {summary}
                  </a>
                ) : (
                  <span className={classes} key={exercise.id}>
                    {summary}
                  </span>
                );
              })}
            </div>
          </nav>

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
                      {source.mediaType === "application/pdf"
                        ? "Protected original PDF"
                        : "Preprocessed copy"}
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
                  {source.mediaType === "application/pdf" ? (
                    <div className="corrected-copy-pdf-frame overflow-hidden rounded-2xl border border-black/10 bg-white">
                      <object
                        aria-label={`Submitted PDF work for ${exam.assignmentTitle}`}
                        className="h-[70vh] min-h-[560px] w-full"
                        data={source.src}
                        type="application/pdf"
                      >
                        <p className="p-5 text-sm text-[var(--muted)]">
                          PDF preview is unavailable in this browser.{" "}
                          <a
                            className="font-semibold text-[var(--sage)]"
                            href={source.src}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open the submitted PDF
                          </a>
                          .
                        </p>
                      </object>
                      <p className="corrected-copy-pdf-print-note hidden p-4 text-xs leading-5 text-[var(--muted)]">
                        The original multi-page PDF is preserved in the local
                        app. Return that source PDF alongside this feedback
                        report.
                      </p>
                    </div>
                  ) : (
                    <div className="corrected-copy-image-frame relative overflow-hidden rounded-2xl border border-black/10 bg-white">
                      <Image
                        alt={`Submitted work for ${exam.assignmentTitle}`}
                        className="corrected-copy-image h-auto w-full object-contain"
                        height={source.height ?? 1}
                        priority
                        src={source.src}
                        unoptimized
                        width={source.width ?? 1}
                      />
                      {source.markers.map((marker) => (
                        <div
                          aria-label={`${marker.questionReference} location on submitted page`}
                          className="corrected-copy-marker absolute rounded-md border-2 border-[var(--coral)] bg-[var(--soft-coral)]/15"
                          key={`${source.submissionId}-${marker.position}`}
                          style={{
                            left: `${marker.region.x * 100}%`,
                            top: `${marker.region.y * 100}%`,
                            width: `${marker.region.width * 100}%`,
                            height: `${marker.region.height * 100}%`,
                          }}
                        >
                          <span className="absolute left-1 top-1 grid min-h-6 min-w-6 place-items-center rounded-full bg-[var(--coral)] px-2 text-[9px] font-bold text-white shadow-sm">
                            {marker.questionReference}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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

            {exam.exercises.map((exercise) => (
              <details
                className={`corrected-copy-exercise group rounded-[22px] border border-black/[0.08] bg-white/35 ${
                  exam.exercises.length === 1 ? "border-0 bg-transparent" : ""
                }`}
                id={`exercise-${exercise.position}`}
                key={exercise.id}
                open
              >
                {exam.exercises.length > 1 ? (
                  <summary className="cursor-pointer list-none px-5 py-4 marker:hidden">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.02em]">
                          {exercise.label}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {exercise.items.length} {exercise.items.length === 1 ? "question" : "questions"}
                        </p>
                      </div>
                      <span className="print-hidden text-xs font-semibold text-[var(--sage)] group-open:hidden">
                        Show
                      </span>
                      <span className="print-hidden hidden text-xs font-semibold text-[var(--sage)] group-open:inline">
                        Hide
                      </span>
                    </div>
                  </summary>
                ) : null}
                <div className={exam.exercises.length > 1 ? "border-t border-black/[0.07] p-5" : ""}>
                  {exercise.sharedContext ? (
                    <div className="mb-4 rounded-xl border border-[var(--sage)]/15 bg-[var(--soft-mint)]/60 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--sage)]">
                        Shared context
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                        {exercise.sharedContext}
                      </p>
                    </div>
                  ) : null}
                  <div className="space-y-4">
                    {exercise.items.map((item) => (
                      <CorrectedQuestion
                        french={french}
                        item={item}
                        key={item.assignmentItemId}
                      />
                    ))}
                  </div>
                </div>
              </details>
            ))}
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

function CorrectedQuestion({
  french,
  item,
}: {
  french: boolean;
  item: CorrectedExam["items"][number];
}) {
  const diagnosis = item.diagnosis;
  const needsReview =
    diagnosis !== null &&
    diagnosis.outcome !== "CORRECT" &&
    diagnosis.outcome !== "MISCONCEPTION";
  return (
    <article className="corrected-copy-problem break-inside-avoid rounded-2xl border border-black/[0.08] bg-white/70 p-5">
      <div className="flex items-start gap-4">
        <span className="grid min-w-12 shrink-0 place-items-center rounded-xl bg-[var(--sidebar)] px-2 py-2 text-[10px] font-bold text-white">
          {item.questionReference}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="corrected-copy-problem-heading whitespace-pre-wrap font-mono text-sm font-semibold leading-6"
            data-question-reference={item.questionReference}
          >
            {item.problemPrompt}
          </p>

          {!diagnosis ? (
            <div className="mt-3 rounded-xl border border-[var(--amber)]/45 bg-[var(--amber)]/12 px-3 py-2 text-xs leading-5 text-[#70501f]">
              <span className="font-semibold">
                {french ? "À vérifier par l’enseignant —" : "Needs teacher review —"}
              </span>{" "}
              {french
                ? "aucun travail n’a pu être associé avec certitude à cette question."
                : "no student work was matched safely to this question."}
            </div>
          ) : (
            <>
              <div className="corrected-copy-verdict mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    diagnosis.outcome === "CORRECT"
                      ? "bg-[var(--soft-mint)] text-[#426d5b]"
                      : diagnosis.outcome === "MISCONCEPTION"
                        ? "bg-[var(--soft-coral)] text-[#8e402d]"
                        : "bg-[var(--amber)]/18 text-[#70501f]"
                  }`}
                >
                  {verdictLabel(diagnosis.outcome, french)}
                </span>
                {diagnosis.misconceptionLabel ? (
                  <span className="rounded-full bg-[var(--soft-coral)] px-2.5 py-1 text-[#8e402d]">
                    {diagnosis.misconceptionLabel}
                  </span>
                ) : null}
              </div>

              {needsReview ? (
                <div className="corrected-copy-review mt-3 rounded-xl border border-[var(--amber)]/45 bg-[var(--amber)]/12 px-3 py-2 text-xs leading-5 text-[#70501f]">
                  <span className="font-semibold">
                    {french ? "À vérifier par l’enseignant —" : "Needs teacher review —"}
                  </span>{" "}
                  {diagnosis.reviewReasons.length > 0
                    ? diagnosis.reviewReasons
                        .map((reason) => reviewReasonLabel(reason, french))
                        .join(" ; ")
                    : french
                      ? "les éléments disponibles ne permettent pas une conclusion automatique fiable."
                      : "the available evidence does not support a safe automatic verdict."}
                </div>
              ) : null}

              <div className="mt-4 rounded-xl bg-[var(--canvas)] px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  {french ? "Travail de l’élève transcrit" : "Transcribed student work"}
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
                        (french
                          ? "Cette étape est mathématiquement cohérente avec le travail précédent."
                          : "This step is mathematically consistent with the previous work.")
                      : step.errorNote ??
                        (french
                          ? "Cette étape doit être vérifiée par l’enseignant."
                          : "This step needs teacher review.");
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
                        <span aria-hidden="true" className="text-sm font-bold">
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
                                ? french
                                  ? "Pourquoi c’est correct : "
                                  : "Why correct: "
                                : step.correctness === "INCORRECT"
                                  ? french
                                    ? "À corriger : "
                                    : "Why wrong: "
                                  : french
                                    ? "Vérification enseignant : "
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
            <span className="font-semibold">
              {french ? "Réponse attendue :" : "Expected answer:"}
            </span>{" "}
            <span className="font-mono">{item.correctAnswer}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
