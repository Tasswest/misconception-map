"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  ChevronIcon,
  FileTextIcon,
  SpinnerIcon,
} from "@/components/icons";
import type {
  AssignmentTriage,
  TriageReviewItem,
} from "@/server/repositories/triage";

type View = "SUMMARY" | "REVIEW" | "AUTOMATIC" | "OUT_OF_SCOPE";

export function AssignmentTriageScreen({
  initialTriage,
}: {
  initialTriage: AssignmentTriage;
}) {
  const [triage, setTriage] = useState(initialTriage);
  const [view, setView] = useState<View>("SUMMARY");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentItem = triage.needsReview[reviewIndex] ?? null;

  useEffect(() => {
    if (view !== "REVIEW") return;
    function onKeyDown(event: KeyboardEvent) {
      const editingNote =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (editingNote && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
      if (event.key === "ArrowLeft") {
        setReviewIndex(Math.max(0, reviewIndex - 1));
        setNote("");
        setError(null);
      }
      if (event.key === "ArrowRight") {
        setReviewIndex(Math.min(triage.needsReview.length - 1, reviewIndex + 1));
        setNote("");
        setError(null);
      }
      if (event.key === "Escape") {
        setView("SUMMARY");
        setError(null);
        window.requestAnimationFrame(() => reviewButtonRef.current?.focus());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reviewIndex, triage.needsReview.length, view]);

  function selectReviewIndex(index: number) {
    setReviewIndex(index);
    setNote("");
    setError(null);
  }

  async function markReviewed() {
    if (!currentItem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/assignments/${encodeURIComponent(triage.assignment.id)}/triage/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetKey: currentItem.targetKey,
            note: note.trim() || null,
          }),
        },
      );
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const apiError = payload.error as Record<string, unknown> | undefined;
        throw new Error(
          typeof apiError?.message === "string" ? apiError.message : "The review could not be saved.",
        );
      }
      setTriage((current) => {
        const reviewedItem = current.needsReview.find(
          (item) => item.targetKey === currentItem.targetKey,
        );
        return {
          ...current,
          summary: {
            ...current.summary,
            needsReviewCount: Math.max(0, current.summary.needsReviewCount - 1),
          },
          needsReview: current.needsReview.filter(
            (item) => item.targetKey !== currentItem.targetKey,
          ),
          reviewed: reviewedItem
            ? [
                ...current.reviewed,
                {
                  ...reviewedItem,
                  reviewedAt: new Date().toISOString(),
                  teacherNote: note.trim() || null,
                },
              ]
            : current.reviewed,
        };
      });
      setReviewIndex((index) => Math.max(0, index - 1));
      setNote("");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <Link href="/assignments">Assignments</Link>
            <span aria-hidden="true">/</span>
            <span>{triage.assignment.className}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--sage)]">Results</span>
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
            {triage.assignment.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {view === "SUMMARY"
              ? "Review only what the AI could not resolve safely."
              : view === "REVIEW"
                ? "One flagged item at a time."
                : view === "AUTOMATIC"
                  ? "Copies completed without teacher intervention."
                  : "Items outside the supported diagnostic scope."}
          </p>
        </div>
        {view === "SUMMARY" ? (
          <Link
            className="inline-flex self-start rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold"
            href={`/analytics/${triage.assignment.id}`}
          >
            Open analytics
          </Link>
        ) : (
          <button
            className="inline-flex self-start items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold"
            onClick={() => setView("SUMMARY")}
            type="button"
          >
            <ArrowIcon className="size-4 rotate-180" /> Back to triage
          </button>
        )}
      </header>

      {view === "SUMMARY" ? (
        <SummaryView reviewButtonRef={reviewButtonRef} triage={triage} setView={setView} />
      ) : view === "REVIEW" ? (
        <ReviewView
          busy={busy}
          currentItem={currentItem}
          error={error}
          note={note}
          onMarkReviewed={() => void markReviewed()}
          reviewIndex={reviewIndex}
          setNote={setNote}
          setReviewIndex={selectReviewIndex}
          total={triage.needsReview.length}
        />
      ) : view === "AUTOMATIC" ? (
        <AutomaticCopies triage={triage} />
      ) : (
        <OutOfScopeItems triage={triage} />
      )}
    </div>
  );
}

function SummaryView({
  reviewButtonRef,
  triage,
  setView,
}: {
  reviewButtonRef: React.RefObject<HTMLButtonElement | null>;
  triage: AssignmentTriage;
  setView: (view: View) => void;
}) {
  const summary = triage.summary;
  const submittedCopyCount = new Set([
    ...triage.automaticallyCorrected.map((copy) => copy.membershipId),
    ...triage.needsReview.map((item) => item.membershipId),
    ...triage.reviewed.map((item) => item.membershipId),
    ...triage.outOfScope.map((item) => item.membershipId),
  ]).size;
  const flaggedItemCount =
    triage.needsReview.length + triage.reviewed.length + triage.outOfScope.length;
  const nothingToReview = summary.needsReviewCount === 0;
  const allOutOfScope =
    summary.outOfScopeCount > 0 &&
    summary.automaticallyCorrectedCount === 0 &&
    summary.needsReviewCount === 0;
  return (
    <>
      <section className="mt-7 overflow-hidden rounded-[28px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_22px_60px_rgba(35,51,46,0.07)]">
        <div className="border-b border-black/[0.06] px-6 py-6 md:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
            What needs your attention
          </p>
          <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
            {summary.automaticallyCorrectedCount} of {submittedCopyCount} submitted {submittedCopyCount === 1 ? "copy" : "copies"} corrected automatically · {summary.needsReviewCount} of {flaggedItemCount} flagged {flaggedItemCount === 1 ? "item" : "items"} awaiting your review · {summary.outOfScopeCount} of {flaggedItemCount} flagged {flaggedItemCount === 1 ? "item" : "items"} out of scope
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Each pile shows its denominator; open a pile to inspect the copies or flagged work behind it.
          </p>
        </div>
        <div className="grid md:grid-cols-3">
          <Pile
            action="See corrected copies"
            count={`${summary.automaticallyCorrectedCount} of ${submittedCopyCount} copies`}
            detail="Ready to open or return to students."
            disabled={summary.automaticallyCorrectedCount === 0}
            icon={<CheckIcon className="size-5" />}
            label="Corrected automatically"
            onClick={() => setView("AUTOMATIC")}
            tone="mint"
          />
          <Pile
            action="Review flagged items"
            buttonRef={reviewButtonRef}
            count={`${summary.needsReviewCount} of ${flaggedItemCount} flagged items`}
            detail="Unreadable, ambiguous, or not safely matched."
            disabled={summary.needsReviewCount === 0}
            icon={<AlertIcon className="size-5" />}
            label="Needs your review"
            onClick={() => setView("REVIEW")}
            tone="amber"
          />
          <Pile
            action="See out-of-scope items"
            count={`${summary.outOfScopeCount} of ${flaggedItemCount} flagged items`}
            detail="Visible work outside the supported domains or taxonomy."
            disabled={summary.outOfScopeCount === 0}
            icon={<FileTextIcon className="size-5" />}
            label="Out of scope"
            onClick={() => setView("OUT_OF_SCOPE")}
            tone="neutral"
          />
        </div>
      </section>

      {nothingToReview && !allOutOfScope ? (
        <section className="mt-5 flex flex-col items-center rounded-[24px] border border-[var(--sage)]/20 bg-[var(--soft-mint)] px-6 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-white text-[var(--sage)]">
            <CheckIcon className="size-5" />
          </span>
          <h2 className="mt-4 text-xl font-semibold">Nothing to review</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
            Every in-scope item was handled without forcing an uncertain decision.
          </p>
        </section>
      ) : null}
      {allOutOfScope ? (
        <section className="mt-5 rounded-[24px] border border-black/10 bg-white px-6 py-10 text-center">
          <h2 className="text-xl font-semibold">All submitted items are out of scope</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            No diagnostic labels were guessed. Open the out-of-scope pile to inspect what was submitted.
          </p>
        </section>
      ) : null}
    </>
  );
}

function Pile({
  action,
  buttonRef,
  count,
  detail,
  disabled,
  icon,
  label,
  onClick,
  tone,
}: {
  action: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
  count: string;
  detail: string;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone: "mint" | "amber" | "neutral";
}) {
  const toneClass =
    tone === "mint"
      ? "bg-[var(--soft-mint)] text-[var(--sage)]"
      : tone === "amber"
        ? "bg-[var(--amber)]/16 text-[#765725]"
        : "bg-[var(--canvas)] text-[var(--muted)]";
  return (
    <article className="border-b border-black/[0.06] p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 md:p-8">
      <div className={`grid size-11 place-items-center rounded-2xl ${toneClass}`}>{icon}</div>
      <p className="mt-5 text-2xl font-semibold tracking-[-0.035em]">{count}</p>
      <h3 className="mt-2 text-base font-semibold">{label}</h3>
      <p className="mt-1 min-h-10 text-xs leading-5 text-[var(--muted)]">{detail}</p>
      <button
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
        disabled={disabled}
        onClick={onClick}
        ref={buttonRef}
        type="button"
      >
        {action} <ArrowIcon className="size-3.5" />
      </button>
    </article>
  );
}

function ReviewView({
  busy,
  currentItem,
  error,
  note,
  onMarkReviewed,
  reviewIndex,
  setNote,
  setReviewIndex,
  total,
}: {
  busy: boolean;
  currentItem: TriageReviewItem | null;
  error: string | null;
  note: string;
  onMarkReviewed: () => void;
  reviewIndex: number;
  setNote: (note: string) => void;
  setReviewIndex: (index: number) => void;
  total: number;
}) {
  if (!currentItem) {
    return (
      <section className="mt-7 rounded-[28px] border border-[var(--sage)]/20 bg-[var(--soft-mint)] px-6 py-16 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-[var(--sage)]"><CheckIcon className="size-5" /></span>
        <h2 className="mt-4 text-2xl font-semibold">Nothing left to review</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Every flagged item in this assignment has been checked.</p>
      </section>
    );
  }

  return (
    <section className="mt-7 overflow-hidden rounded-[28px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_22px_60px_rgba(35,51,46,0.07)]">
      <div className="flex flex-col gap-3 border-b border-black/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">Item {reviewIndex + 1} of {total}</p>
          <h2 className="mt-1 text-xl font-semibold">{currentItem.studentName}{currentItem.questionReference ? ` · ${currentItem.questionReference}` : " · Unmatched work"}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button aria-label="Previous flagged item" className="grid size-10 place-items-center rounded-xl border border-black/10 bg-white disabled:opacity-30" disabled={reviewIndex === 0} onClick={() => setReviewIndex(reviewIndex - 1)} title="Previous (Left arrow)" type="button"><ChevronIcon className="size-4 rotate-90" /></button>
          <button aria-label="Next flagged item" className="grid size-10 place-items-center rounded-xl border border-black/10 bg-white disabled:opacity-30" disabled={reviewIndex >= total - 1} onClick={() => setReviewIndex(reviewIndex + 1)} title="Next (Right arrow)" type="button"><ChevronIcon className="size-4 -rotate-90" /></button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
        <div className="min-h-[560px] border-b border-black/[0.06] bg-[var(--preview)] p-5 lg:border-b-0 lg:border-r md:p-7">
          <SourcePreview item={currentItem} />
        </div>
        <div className="p-5 md:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Why it was flagged</p>
          <ul className="mt-3 space-y-2">
            {currentItem.reasons.map((reason) => <li className="flex gap-2 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber)]/10 px-3 py-2.5 text-xs leading-5 text-[#70501f]" key={reason}><AlertIcon className="mt-0.5 size-3.5 shrink-0" />{reason}</li>)}
          </ul>

          <EvidenceFocus item={currentItem} />

          {currentItem.problemPrompt ? (
            <div className="mt-5 rounded-xl border border-black/[0.06] bg-white px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Assignment item</p>
              <p className="mt-2 text-sm leading-6">{currentItem.problemPrompt}</p>
            </div>
          ) : null}
          <div className="mt-4 rounded-xl bg-[var(--canvas)] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Transcription</p>
            <p className="mt-2 whitespace-pre-wrap font-mono text-sm leading-6">
              {currentItem.diagnosisId ? (
                <HighlightedTranscription
                  evidence={currentItem.flaggedEvidence}
                  transcription={currentItem.transcription}
                />
              ) : (
                "No safe transcription was produced for this unmatched work."
              )}
            </p>
          </div>

          <label className="mt-5 block text-xs font-semibold" htmlFor="teacher-review-note">Teacher note <span className="font-normal text-[var(--muted)]">(optional)</span></label>
          <textarea className="mt-2 min-h-24 w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none focus:border-[var(--sage)] focus:ring-4 focus:ring-[var(--mint)]/25" id="teacher-review-note" maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Add context for your future self…" value={note} />
          {error ? <p className="mt-3 rounded-xl bg-[var(--soft-coral)] px-3 py-2 text-xs text-[#8e402d]">{error}</p> : null}
          <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={onMarkReviewed} type="button">{busy ? <SpinnerIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}{busy ? "Saving…" : "Mark as reviewed"}</button>
          <p className="mt-3 text-center text-[10px] text-[var(--muted)]">Use ← and → to move between flagged items.</p>
        </div>
      </div>
    </section>
  );
}

function EvidenceFocus({ item }: { item: TriageReviewItem }) {
  if (item.confirmedMistake && item.flaggedEvidence) {
    return (
      <div className="mt-4 rounded-xl border border-[var(--coral)]/25 bg-[var(--soft-coral)]/65 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#8e402d]">
          First incorrect step
        </p>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/60 px-3 py-2 font-mono text-sm font-semibold leading-6">
          {item.flaggedEvidence}
        </p>
        {item.flaggedEvidenceNote ? (
          <p className="mt-2 text-xs leading-5 text-[#8e402d]">
            {item.flaggedEvidenceNote}
          </p>
        ) : null}
      </div>
    );
  }

  if (item.flaggedEvidence) {
    return (
      <div className="mt-4 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber)]/10 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#70501f]">
          Line to verify - not a confirmed mistake
        </p>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/65 px-3 py-2 font-mono text-sm font-semibold leading-6">
          {item.flaggedEvidence}
        </p>
        <p className="mt-2 text-xs leading-5 text-[#70501f]">
          No incorrect mathematical step was identified. This item was flagged because the AI was uncertain about transcription, layout, or consistency.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-black/[0.07] bg-[var(--canvas)] px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
        No exact line isolated
      </p>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        The PDF could not be matched safely to one assignment item. Use the referenced page and exercise cues above; no student mistake has been asserted.
      </p>
    </div>
  );
}

function HighlightedTranscription({
  evidence,
  transcription,
}: {
  evidence: string | null;
  transcription: string;
}) {
  if (!evidence) return transcription;
  const evidenceStart = transcription.indexOf(evidence);
  if (evidenceStart < 0) return transcription;
  const evidenceEnd = evidenceStart + evidence.length;
  return (
    <>
      {transcription.slice(0, evidenceStart)}
      <mark className="rounded bg-[var(--amber)]/40 px-0.5 text-inherit">
        {transcription.slice(evidenceStart, evidenceEnd)}
      </mark>
      {transcription.slice(evidenceEnd)}
    </>
  );
}

function SourcePreview({ item }: { item: TriageReviewItem }) {
  if (item.assetUrl && item.mediaType === "application/pdf") {
    const pdfUrl = item.suggestedPage
      ? `${item.assetUrl}#page=${item.suggestedPage}&view=FitH`
      : item.assetUrl;
    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[var(--sidebar)]">
            {item.suggestedPage
              ? `PDF opened at referenced page ${item.suggestedPage}`
              : "Review the submitted PDF"}
          </p>
          <a
            className="text-xs font-semibold text-[var(--sage)] underline-offset-4 hover:underline"
            href={pdfUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open PDF in a new tab
          </a>
        </div>
        <object
          className="h-[640px] w-full rounded-2xl bg-white shadow-sm"
          data={pdfUrl}
          key={pdfUrl}
          type="application/pdf"
        >
          <a href={pdfUrl}>Open submitted PDF</a>
        </object>
      </div>
    );
  }
  if (item.assetUrl) {
    return (
      <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-2xl bg-white shadow-[0_16px_45px_rgba(35,51,46,0.15)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`Submitted work for ${item.studentName}`} className="max-h-[680px] w-auto max-w-full object-contain" src={item.assetUrl} />
        {item.region ? <span aria-label="Matched work region" className="pointer-events-none absolute rounded-lg border-2 border-[var(--coral)] bg-[var(--coral)]/8" style={{ left: `${item.region.x * 100}%`, top: `${item.region.y * 100}%`, width: `${item.region.width * 100}%`, height: `${item.region.height * 100}%` }} /> : null}
      </div>
    );
  }
  if (item.inputKind === "DEMO") {
    return (
      <div className="mx-auto min-h-[520px] max-w-xl rotate-[-0.5deg] rounded-md bg-[#fffef9] px-10 py-12 shadow-[0_18px_45px_rgba(35,51,46,0.16)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-black/35">Synthetic student page</p>
        <p className="mt-12 text-sm text-black/55">{item.questionReference ? `${item.questionReference} · ${item.problemPrompt}` : "Unmatched exercise work"}</p>
        <p className="mt-14 whitespace-pre-wrap font-mono text-2xl italic leading-10 text-[#2d3d5c]">{item.transcription}</p>
      </div>
    );
  }
  return (
    <div className="grid min-h-[520px] place-items-center rounded-2xl border border-dashed border-black/10 bg-white/60 px-8 text-center">
      <div><FileTextIcon className="mx-auto size-6 text-[var(--muted)]" /><p className="mt-3 text-sm font-semibold">No page image for this typed response</p><p className="mt-1 text-xs text-[var(--muted)]">The transcription is shown alongside the review reason.</p></div>
    </div>
  );
}

function AutomaticCopies({ triage }: { triage: AssignmentTriage }) {
  return (
    <section className="mt-7 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)]">
      {triage.automaticallyCorrected.length ? triage.automaticallyCorrected.map((copy) => (
        <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] px-5 py-4 last:border-b-0" key={copy.membershipId}><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[var(--soft-mint)] text-[var(--sage)]"><CheckIcon className="size-4" /></span><p className="text-sm font-semibold">{copy.studentName}</p></div><Link className="rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold" href={copy.correctedCopyUrl}>Open corrected copy</Link></div>
      )) : <EmptyList title="No automatically corrected copies yet" />}
    </section>
  );
}

function OutOfScopeItems({ triage }: { triage: AssignmentTriage }) {
  return (
    <section className="mt-7 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)]">
      {triage.outOfScope.length ? triage.outOfScope.map((item) => (
        <article className="border-b border-black/[0.06] px-5 py-5 last:border-b-0" key={item.targetKey}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-sm font-semibold">{item.studentName}{item.questionReference ? ` · ${item.questionReference}` : ""}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.reasons.join(" ")}</p></div><span className="self-start rounded-full bg-[var(--canvas)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">No label assigned</span></div></article>
      )) : <EmptyList title="No out-of-scope items" />}
    </section>
  );
}

function EmptyList({ title }: { title: string }) {
  return <div className="px-6 py-14 text-center"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 text-sm text-[var(--muted)]">This pile is empty.</p></div>;
}
