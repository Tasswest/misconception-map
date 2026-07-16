"use client";

import Link from "next/link";
import { useState } from "react";

import {
  AlertIcon,
  CheckIcon,
  PlusIcon,
  SparkIcon,
  SpinnerIcon,
} from "@/components/icons";
import { AiUnavailableNotice } from "@/components/readiness-states";
import type { PredictionLabData } from "@/server/repositories/prediction-lab";
import { formatUtcTimestamp } from "@/lib/date-format";

type Props = {
  classes: Array<{ id: string; name: string; studentCount: number }>;
  data: PredictionLabData | null;
  liveAiReady: boolean;
};

export function PredictionLab({ classes, data, liveAiReady }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>(
    {},
  );

  async function prepareModel(
    row: NonNullable<Props["data"]>["rows"][number],
    candidate: NonNullable<Props["data"]>["rows"][number]["candidates"][number],
  ) {
    const key = `model:${row.membershipId}:${candidate.misconceptionId}`;
    setBusy(key);
    setError(null);
    try {
      await postJson(
        `/api/classes/${encodeURIComponent(data!.classRecord.id)}/student-models`,
        {
          assignmentId: candidate.assignmentId,
          membershipId: row.membershipId,
          misconceptionId: candidate.misconceptionId,
        },
      );
      window.location.reload();
    } catch (cause) {
      setError(`${row.studentName}: ${messageFromError(cause)}`);
      setBusy(null);
    }
  }

  async function lockPrediction(
    row: NonNullable<Props["data"]>["rows"][number],
    model: NonNullable<Props["data"]>["rows"][number]["models"][number],
    targetId?: string,
  ) {
    const selected =
      targetId ?? selectedTargets[model.id] ?? model.eligibleTargets[0]?.id;
    if (!selected) {
      setError(`${row.studentName}: choose or create a held-out problem first.`);
      return;
    }
    const key = `prediction:${model.id}`;
    setBusy(key);
    setError(null);
    try {
      await postJson("/api/predictions", {
        modelVersionId: model.id,
        targetAssignmentItemId: selected,
      });
      window.location.reload();
    } catch (cause) {
      setError(`${row.studentName}: ${messageFromError(cause)}`);
      setBusy(null);
    }
  }

  async function createProbeAndLock(
    event: React.FormEvent<HTMLFormElement>,
    row: NonNullable<Props["data"]>["rows"][number],
    model: NonNullable<Props["data"]>["rows"][number]["models"][number],
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const key = `probe:${model.id}`;
    setBusy(key);
    setError(null);
    try {
      const probe = (await postJson(
        `/api/classes/${encodeURIComponent(data!.classRecord.id)}/prediction-probes`,
        {
          modelVersionId: model.id,
          title: String(form.get("title") ?? "").trim(),
          problemPrompt: String(form.get("problemPrompt") ?? "").trim(),
          correctAnswer: String(form.get("correctAnswer") ?? "").trim(),
          answerFormat: String(form.get("answerFormat") ?? "EXPRESSION"),
        },
      )) as { item?: { id?: string } };
      const itemId = probe.item?.id;
      if (!itemId) throw new Error("The new probe did not return an assignment item.");
      await lockPrediction(row, model, itemId);
    } catch (cause) {
      setError(`${row.studentName}: ${messageFromError(cause)}`);
      setBusy(null);
    }
  }

  async function syncOutcomes() {
    if (!data) return;
    setBusy("sync");
    setError(null);
    try {
      await postJson(
        `/api/classes/${encodeURIComponent(data.classRecord.id)}/prediction-outcomes`,
        {},
      );
      window.location.reload();
    } catch (cause) {
      setError(messageFromError(cause));
      setBusy(null);
    }
  }

  async function decideRevision(
    suggestionId: string,
    action: "CONFIRM" | "DISMISS",
  ) {
    const key = `revision:${suggestionId}`;
    setBusy(key);
    setError(null);
    try {
      await postJson(
        `/api/model-revision-suggestions/${encodeURIComponent(suggestionId)}`,
        { action, note: null },
      );
      window.location.reload();
    } catch (cause) {
      setError(messageFromError(cause));
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <div className="mx-auto grid min-h-[calc(100vh-64px)] max-w-3xl place-items-center px-6 py-12 text-center">
        <div>
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
            <SparkIcon className="size-5" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold">Prediction Lab needs a class</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Create a class and diagnose student work, then return here to turn repeated error patterns into testable predictions.
          </p>
          <Link
            className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
            href="/diagnose"
          >
            Create a class
          </Link>
        </div>
      </div>
    );
  }

  const totals = data.rows.reduce(
    (sum, row) => ({
      valid: sum.valid + row.metrics.valid,
      attempted: sum.attempted + row.metrics.attempted,
      scorable: sum.scorable + row.metrics.scorable,
      matched: sum.matched + row.metrics.matched,
      invalidated: sum.invalidated + row.metrics.invalidated,
      expectedFlawed: sum.expectedFlawed + row.metrics.expectedFlawedMatches,
      flawedScorable: sum.flawedScorable + row.metrics.flawedScorable,
      flawedMatched: sum.flawedMatched + row.metrics.flawedMatched,
      mastery: sum.mastery + row.metrics.mastery,
      abstentions: sum.abstentions + row.metrics.abstentions,
    }),
    {
      valid: 0,
      attempted: 0,
      scorable: 0,
      matched: 0,
      invalidated: 0,
      expectedFlawed: 0,
      flawedScorable: 0,
      flawedMatched: 0,
      mastery: 0,
      abstentions: 0,
    },
  );

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
            Signature feature
          </p>
          <h1 className="mt-2 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
            Prediction Lab
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Model what a learner does wrong and right, then test it on unseen work. Every prediction is timestamped and locked; misses revise the hypothesis instead of becoming a label.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Consistency is an observed strategy rate, not certainty: learners often vary strategies within the same topic.{" "}
            <a
              className="font-semibold text-[var(--sage)] underline decoration-[var(--sage)]/35 underline-offset-2"
              href="https://doi.org/10.1037/a0031200"
              rel="noreferrer"
              target="_blank"
            >
              Siegler &amp; Pyke (2013)
            </a>
          </p>
        </div>
        <button
          className="inline-flex self-start items-center gap-2 rounded-xl border border-[var(--sage)]/20 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--sidebar)] transition hover:bg-[var(--soft-mint)] disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void syncOutcomes()}
          type="button"
        >
          {busy === "sync" ? (
            <SpinnerIcon className="size-4 animate-spin" />
          ) : (
            <CheckIcon className="size-4" />
          )}
          Compare new work
        </button>
      </div>

      {!liveAiReady ? <AiUnavailableNotice className="mt-5" /> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {classes.map((classRecord) => (
          <Link
            aria-current={classRecord.id === data.classRecord.id ? "page" : undefined}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              classRecord.id === data.classRecord.id
                ? "bg-[var(--sidebar)] text-white"
                : "border border-black/10 bg-white text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
            href={`/prediction-lab?classId=${encodeURIComponent(classRecord.id)}`}
            key={classRecord.id}
          >
            {classRecord.name} · {classRecord.studentCount} {classRecord.studentCount === 1 ? "student" : "students"}
          </Link>
        ))}
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="mt-4 rounded-xl border border-[var(--coral)]/25 bg-[var(--soft-coral)] px-4 py-3 text-sm text-[#8e402d]"
        >
          {error}
        </p>
      ) : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail={
            totals.flawedScorable
              ? Math.abs(totals.flawedMatched - totals.expectedFlawed) <= 1
                ? "Consistent with the observed application rate"
                : "The evidence warrants model revision"
              : "Waiting for actual flawed-rule outcomes"
          }
          label="Expected vs actual"
          value={
            totals.flawedScorable
              ? `${totals.flawedMatched} actual · ${totals.expectedFlawed.toFixed(1)} expected`
              : "—"
          }
        />
        <MetricCard
          detail="Rules applied ÷ valid locked trials"
          label="Prediction coverage"
          value={percentage(totals.attempted, totals.valid)}
        />
        <MetricCard
          detail="Correct outcomes predicted from demonstrated related skill"
          label="Mastery predictions"
          value={String(totals.mastery)}
        />
        <MetricCard
          detail={`${totals.abstentions} abstained · ${totals.invalidated} invalidated`}
          label="Guarded claims"
          value={String(totals.abstentions + totals.invalidated)}
        />
      </section>

      <div className="mt-6 space-y-5">
        {data.rows.map((row) => (
          <section
            className="overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]"
            key={row.membershipId}
          >
            <div className="flex flex-col gap-3 border-b border-black/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em]">
                  {row.studentName}
                </h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {row.metrics.scorable
                    ? `${row.metrics.matched} of ${row.metrics.scorable} matched`
                    : "No scorable prediction outcomes yet"}
                  {row.metrics.invalidated
                    ? ` · ${row.metrics.invalidated} invalidated`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
                <span className="rounded-full bg-[var(--soft-mint)] px-2.5 py-1 text-[var(--sidebar)]">
                  Coverage {percentage(row.metrics.attempted, row.metrics.valid)}
                </span>
                <span className="rounded-full bg-[var(--amber)]/15 px-2.5 py-1 text-[#765725]">
                  {row.metrics.mastery} {row.metrics.mastery === 1 ? "mastery prediction" : "mastery predictions"}
                </span>
              </div>
            </div>

            <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)]">
              <div className="space-y-4">
                {row.candidates
                  .filter((candidate) => !candidate.hasCurrentModel)
                  .map((candidate) => {
                    const key = `model:${row.membershipId}:${candidate.misconceptionId}`;
                    return (
                      <div
                        className="rounded-2xl border border-dashed border-[var(--sage)]/30 bg-white/55 p-4"
                        key={candidate.misconceptionId}
                      >
                        <p className="text-xs font-bold uppercase tracking-[0.11em] text-[var(--sage)]">
                          Diagnosed pattern
                        </p>
                        <p className="mt-2 text-sm font-semibold">
                          {candidate.misconceptionLabel}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          {candidate.evidenceCount} {candidate.evidenceCount === 1 ? "response" : "responses"} · {candidate.distinctProblemCount} distinct {candidate.distinctProblemCount === 1 ? "problem" : "problems"}
                        </p>
                        <button
                          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--sidebar)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
                          disabled={busy !== null || !liveAiReady}
                          onClick={() => void prepareModel(row, candidate)}
                          type="button"
                        >
                          {busy === key ? (
                            <SpinnerIcon className="size-3.5 animate-spin" />
                          ) : (
                            <SparkIcon className="size-3.5" />
                          )}
                          Build Student Model
                        </button>
                      </div>
                    );
                  })}

                {row.models.map((model) => {
                  const candidate = row.candidates.find(
                    (item) => item.misconceptionId === model.misconceptionId,
                  );
                  const predictionKey = `prediction:${model.id}`;
                  const consistencyTrials = row.predictions.filter(
                    (prediction) =>
                      prediction.modelVersionId === model.id &&
                      prediction.predictionKind === "FLAWED_RULE_APPLIES" &&
                      prediction.consistencySnapshot !== null &&
                      prediction.invalidation === null &&
                      (prediction.outcome?.matchState === "MATCH" ||
                        prediction.outcome?.matchState === "MISMATCH"),
                  );
                  const actualMatches = consistencyTrials.filter(
                    (prediction) => prediction.outcome?.matchState === "MATCH",
                  ).length;
                  const expectedMatches = consistencyTrials.reduce(
                    (sum, prediction) => sum + prediction.confidence,
                    0,
                  );
                  return (
                    <article
                      className="rounded-2xl border border-[var(--sage)]/15 bg-[var(--soft-mint)]/55 p-4"
                      key={model.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                          Student Model v{model.version}
                        </p>
                        <StatusBadge status={model.status} />
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6">
                        {model.ruleStatement}
                      </p>
                      <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
                        {model.misconceptionLabel} · {model.distinctSupportContent} distinct supporting {model.distinctSupportContent === 1 ? "problem" : "problems"} · {Math.round(model.confidence * 100)}% synthesis confidence
                      </p>
                      <div className="mt-3 rounded-xl border border-[var(--sage)]/15 bg-white/70 px-3 py-2.5 text-xs leading-5">
                        <p className="font-semibold text-[var(--sidebar)]">
                          {model.observedApplicationRate === null ||
                          model.observedApplicationCount === null ||
                          model.observedOpportunityCount === null
                            ? "Consistency unknown for this legacy model"
                            : `Applies this rule in ${model.observedApplicationCount} of ${model.observedOpportunityCount} observed opportunities (${Math.round(model.observedApplicationRate * 100)}%).`}
                        </p>
                        <p className="mt-0.5 text-[var(--muted)]">
                          {model.masteryEvidenceCount ?? 0} demonstrated-correct {model.masteryEvidenceCount === 1 ? "skill example" : "skill examples"} attached
                        </p>
                        {consistencyTrials.length ? (
                          <p className="mt-1 font-semibold text-[var(--sage)]">
                            Expected {expectedMatches.toFixed(1)} of {consistencyTrials.length} · actual {actualMatches} · {Math.abs(actualMatches - expectedMatches) <= 1 ? "CONSISTENT WITH MODEL" : "REVISION WARRANTED"}
                          </p>
                        ) : null}
                      </div>

                      {model.status === "SUPPORTED" && candidate ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            className="inline-flex items-center gap-2 rounded-lg border border-[var(--sage)]/20 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-45"
                            disabled={busy !== null || !liveAiReady}
                            onClick={() => void prepareModel(row, candidate)}
                            type="button"
                          >
                            {busy === `model:${row.membershipId}:${candidate.misconceptionId}` ? (
                              <SpinnerIcon className="size-3.5 animate-spin" />
                            ) : (
                              <CheckIcon className="size-3.5" />
                            )}
                            Check for model updates
                          </button>
                          <span className="text-[10px] leading-4 text-[var(--muted)]">
                            New evidence creates a new version; earlier locks stay visible but are excluded.
                          </span>
                        </div>
                      ) : null}

                      {model.status === "PROVISIONAL" && candidate ? (
                        <div className="mt-4 rounded-xl bg-white/70 p-3">
                          <p className="text-xs leading-5 text-[var(--muted)]">
                            A locked prediction requires two structurally distinct supporting problems. Current evidence: {model.distinctSupportContent} of 2.
                          </p>
                          <button
                            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[var(--sage)]/20 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-45"
                            disabled={busy !== null}
                            onClick={() => void prepareModel(row, candidate)}
                            type="button"
                          >
                            <CheckIcon className="size-3.5" /> Refresh evidence
                          </button>
                        </div>
                      ) : null}

                      {model.status === "SUPPORTED" ? (
                        <div className="mt-4 border-t border-[var(--sage)]/15 pt-4">
                          {model.eligibleTargets.length ? (
                            <div className="flex flex-col gap-2">
                              <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]" htmlFor={`target-${model.id}`}>
                                Existing unseen assignment problem
                              </label>
                              <select
                                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-xs outline-none focus:border-[var(--sage)]"
                                id={`target-${model.id}`}
                                onChange={(event) =>
                                  setSelectedTargets((current) => ({
                                    ...current,
                                    [model.id]: event.target.value,
                                  }))
                                }
                                value={selectedTargets[model.id] ?? model.eligibleTargets[0]?.id ?? ""}
                              >
                                {model.eligibleTargets.map((target) => (
                                  <option key={target.id} value={target.id}>
                                    {target.questionReference} · {target.assignmentTitle}: {target.prompt}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-45"
                                disabled={busy !== null || !liveAiReady}
                                onClick={() => void lockPrediction(row, model)}
                                type="button"
                              >
                                {busy === predictionKey ? (
                                  <SpinnerIcon className="size-3.5 animate-spin" />
                                ) : (
                                  <SparkIcon className="size-3.5" />
                                )}
                                Predict and lock
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs leading-5 text-[var(--muted)]">
                              No existing assignment problem is still unseen. Create a probe below.
                            </p>
                          )}

                          <details className="mt-3 rounded-xl border border-black/[0.07] bg-white/65 p-3">
                            <summary className="cursor-pointer text-xs font-semibold text-[var(--sidebar)]">
                              Create a typed held-out probe
                            </summary>
                            <form
                              className="mt-3 space-y-2.5"
                              onSubmit={(event) => void createProbeAndLock(event, row, model)}
                            >
                              <input
                                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
                                defaultValue={`Prediction probe · ${model.misconceptionLabel}`}
                                maxLength={160}
                                name="title"
                                required
                              />
                              <textarea
                                className="min-h-20 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
                                name="problemPrompt"
                                placeholder="Type the unseen problem"
                                required
                              />
                              <div className="grid gap-2 sm:grid-cols-2">
                                <input
                                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
                                  name="correctAnswer"
                                  placeholder="Expected correct answer"
                                  required
                                />
                                <select
                                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
                                  defaultValue="EXPRESSION"
                                  name="answerFormat"
                                >
                                  <option value="EXPRESSION">Expression</option>
                                  <option value="NUMBER">Number</option>
                                  <option value="FRACTION">Fraction</option>
                                  <option value="MULTIPLE_CHOICE">Multiple choice</option>
                                  <option value="SHORT_TEXT">Short text</option>
                                </select>
                              </div>
                              <button
                                className="inline-flex items-center gap-2 rounded-lg border border-[var(--sage)]/25 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-45"
                                disabled={busy !== null || !liveAiReady}
                                type="submit"
                              >
                                {busy === `probe:${model.id}` ? (
                                  <SpinnerIcon className="size-3.5 animate-spin" />
                                ) : (
                                  <PlusIcon className="size-3.5" />
                                )}
                                Create, predict, and lock
                              </button>
                            </form>
                          </details>
                        </div>
                      ) : null}
                    </article>
                  );
                })}

                {!row.models.length && !row.candidates.length ? (
                  <div className="rounded-2xl border border-dashed border-black/10 p-4 text-sm leading-6 text-[var(--muted)]">
                    Diagnose a misconception on this student’s work to begin a model hypothesis.
                  </div>
                ) : null}
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                  Locked prediction history
                </p>
                {row.predictions.length ? (
                  <div className="mt-3 space-y-3">
                    {row.predictions.map((prediction) => (
                      <PredictionRecord
                        busy={busy}
                        key={prediction.id}
                        onDecision={decideRevision}
                        prediction={prediction}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 grid min-h-44 place-items-center rounded-2xl border border-dashed border-black/10 bg-white/45 px-6 text-center">
                    <div>
                      <SparkIcon className="mx-auto size-5 text-[var(--sage)]" />
                      <p className="mt-2 text-sm font-semibold">No locked claims yet</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        Support a Student Model, choose an unseen target, then lock the prediction before collecting work.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PredictionRecord({
  busy,
  onDecision,
  prediction,
}: {
  busy: string | null;
  onDecision: (
    suggestionId: string,
    action: "CONFIRM" | "DISMISS",
  ) => Promise<void>;
  prediction: NonNullable<Props["data"]>["rows"][number]["predictions"][number];
}) {
  const invalid = prediction.invalidation !== null;
  const predictsAnswer = prediction.predictionKind !== "ABSTAIN";
  return (
    <article
      className={`rounded-2xl border p-4 ${
        invalid
          ? "border-black/10 bg-[var(--canvas)] opacity-75"
          : prediction.outcome?.matchState === "MATCH"
            ? "border-[var(--sage)]/20 bg-[var(--soft-mint)]/55"
            : prediction.outcome?.matchState === "MISMATCH"
              ? "border-[var(--coral)]/25 bg-[var(--soft-coral)]/45"
              : "border-black/[0.07] bg-white/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--muted)]">
            {prediction.questionReference} · Model v{prediction.modelVersion} · locked {formatDate(prediction.lockedAt)}
          </p>
          <p className="mt-1 text-sm font-semibold leading-6">
            {prediction.problemPrompt}
          </p>
        </div>
        {invalid ? (
          <span className="rounded-full bg-black/10 px-2.5 py-1 text-[10px] font-bold text-[var(--muted)]">
            Invalidated · excluded
          </span>
        ) : prediction.outcome ? (
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
              prediction.outcome.matchState === "MATCH"
                ? "bg-[var(--mint)]/45 text-[var(--sidebar)]"
                : "bg-[var(--coral)]/20 text-[#8e402d]"
            }`}
          >
            {prediction.outcome.matchState === "MATCH" ? "Matched" : "Did not match"}
          </span>
        ) : predictsAnswer ? (
          <span className="rounded-full bg-[var(--amber)]/20 px-2.5 py-1 text-[10px] font-bold text-[#765725]">
            Actual pending
          </span>
        ) : (
          <span className="rounded-full bg-[var(--amber)]/20 px-2.5 py-1 text-[10px] font-bold text-[#765725]">
            Abstained
          </span>
        )}
      </div>

      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--sage)]">
        {prediction.predictionKind === "FLAWED_RULE_APPLIES"
          ? `Flawed rule · ${Math.round(prediction.confidence * 100)}% observed consistency`
          : prediction.predictionKind === "MASTERY"
            ? `Mastery · ${Math.round(prediction.confidence * 100)}% confidence`
            : "Abstain · insufficient evidence"}
      </p>

      {predictsAnswer ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <AnswerBox label="Model predicted" value={prediction.predictedAnswer ?? "—"} />
          <AnswerBox label="Actual answer" value={prediction.outcome?.actualAnswer ?? "Pending"} />
          <AnswerBox label="Correct answer" value={prediction.correctAnswer} />
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-[var(--amber)]/12 px-3 py-2 text-xs leading-5 text-[#765725]">
          <span className="font-semibold">Model abstained:</span>{" "}
          {prediction.abstentionReason}
        </p>
      )}

      {prediction.predictionKind === "MASTERY" &&
      prediction.masteryEvidenceSummary ? (
        <p className="mt-2 rounded-xl bg-[var(--soft-mint)] px-3 py-2 text-xs leading-5 text-[var(--sidebar)]">
          <span className="font-semibold">Why predict success:</span>{" "}
          {prediction.masteryEvidenceSummary}
        </p>
      ) : null}

      {prediction.revisionSuggestion ? (
        <div className="mt-3 rounded-xl border border-[var(--coral)]/20 bg-white/75 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#8e402d]">
            Revision suggestion · teacher decision required
          </p>
          <p className="mt-1 text-xs font-semibold leading-5">
            {prediction.revisionSuggestion.kind === "DOWNGRADE_CONSISTENCY"
              ? `Downgrade consistency to ${Math.round((prediction.revisionSuggestion.proposedApplicationRate ?? 0) * 100)}%`
              : prediction.revisionSuggestion.proposedRuleStatement}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {prediction.revisionSuggestion.rationale}
          </p>
          {prediction.revisionSuggestion.decision ? (
            <p className="mt-2 text-xs font-semibold text-[var(--sage)]">
              {prediction.revisionSuggestion.decision.action === "CONFIRM"
                ? "Confirmed · a provisional next version was created"
                : "Dismissed · the current model history is unchanged"}
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-[var(--sidebar)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
                disabled={busy !== null}
                onClick={() =>
                  void onDecision(prediction.revisionSuggestion!.id, "CONFIRM")
                }
                type="button"
              >
                {busy === `revision:${prediction.revisionSuggestion.id}` ? (
                  <SpinnerIcon className="mr-1 inline size-3.5 animate-spin" />
                ) : null}
                Confirm as provisional v+1
              </button>
              <button
                className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-45"
                disabled={busy !== null}
                onClick={() =>
                  void onDecision(prediction.revisionSuggestion!.id, "DISMISS")
                }
                type="button"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      ) : null}

      {invalid ? (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          {prediction.invalidation?.reason.replaceAll("_", " ").toLowerCase()}: {prediction.invalidation?.note}
        </p>
      ) : !prediction.outcome && predictsAnswer ? (
        <Link
          className="mt-3 inline-flex text-xs font-semibold text-[var(--sage)] hover:text-[var(--ink)]"
          href={`/assignments/${prediction.assignmentId}/diagnose`}
        >
          Collect work on {prediction.assignmentTitle} →
        </Link>
      ) : null}
    </article>
  );
}

function AnswerBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white/70 px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap font-mono text-xs font-semibold">
        {value}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-black/[0.06] bg-white/75 p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.025em]">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{detail}</p>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  const supported = status === "SUPPORTED";
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] ${
        supported
          ? "bg-[var(--mint)]/45 text-[var(--sidebar)]"
          : "bg-[var(--amber)]/20 text-[#765725]"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function percentage(numerator: number, denominator: number) {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

const formatDate = formatUtcTimestamp;

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: unknown; error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "The request did not complete.");
  }
  if (payload?.data === undefined) {
    throw new Error("The request returned no saved result.");
  }
  return payload.data;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "The request failed.";
}
