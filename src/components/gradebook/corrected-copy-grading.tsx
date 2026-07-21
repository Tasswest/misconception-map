"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CheckIcon, SpinnerIcon } from "@/components/icons";
import type { GradeProposal } from "@/server/repositories/grading-proposals";

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, "");
}

function responseMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return fallback;
}

export function CorrectedCopyGrading({
  assignmentId,
  membershipId,
  initialProposal,
}: {
  assignmentId: string;
  membershipId: string;
  initialProposal: GradeProposal | null;
}) {
  const router = useRouter();
  const [proposal, setProposal] = useState(initialProposal);
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initialProposal?.items ?? []).map((item) => [
        item.assignmentItemId,
        item.finalScore !== null
          ? String(item.finalScore)
          : item.proposedScore !== null
            ? String(item.proposedScore)
            : "",
      ]),
    ),
  );
  const [busy, setBusy] = useState<"propose" | "validate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/assignments/${encodeURIComponent(assignmentId)}/grades/${encodeURIComponent(membershipId)}/proposal`;

  const teacherTotal = useMemo(() => {
    if (!proposal) return null;
    const values = proposal.items.map((item) => {
      const raw = scores[item.assignmentItemId]?.trim() ?? "";
      return raw === "" ? Number.NaN : Number(raw);
    });
    return values.every((value) => Number.isFinite(value))
      ? values.reduce((sum, value) => sum + value, 0)
      : null;
  }, [proposal, scores]);

  async function requestProposal() {
    setBusy("propose");
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: GradeProposal }
        | null;
      if (!response.ok || !payload?.data) {
        throw new Error(
          responseMessage(payload, "The AI grade proposal could not be created."),
        );
      }
      setProposal(payload.data);
      setScores(
        Object.fromEntries(
          payload.data.items.map((item) => [
            item.assignmentItemId,
            item.proposedScore === null ? "" : String(item.proposedScore),
          ]),
        ),
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The AI grade proposal could not be created.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function validateProposal() {
    if (!proposal) return;
    const items = proposal.items.map((item) => ({
      assignmentItemId: item.assignmentItemId,
      finalScore:
        (scores[item.assignmentItemId]?.trim() ?? "") === ""
          ? Number.NaN
          : Number(scores[item.assignmentItemId]),
    }));
    const invalid = items.find((item, index) => {
      const maxPoints = proposal.items[index]?.maxPoints ?? 0;
      return (
        !Number.isFinite(item.finalScore) ||
        item.finalScore < 0 ||
        item.finalScore > maxPoints
      );
    });
    if (invalid) {
      const item = proposal.items.find(
        (candidate) => candidate.assignmentItemId === invalid.assignmentItemId,
      );
      setError(
        `Enter a teacher score from 0 to ${formatPoints(item?.maxPoints ?? 0)} for ${item?.questionReference ?? "every question"}.`,
      );
      return;
    }

    setBusy("validate");
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id, items }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: GradeProposal }
        | null;
      if (!response.ok || !payload?.data) {
        throw new Error(responseMessage(payload, "The grade could not be validated."));
      }
      setProposal(payload.data);
      setScores(
        Object.fromEntries(
          payload.data.items.map((item) => [
            item.assignmentItemId,
            String(item.finalScore ?? ""),
          ]),
        ),
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The grade could not be validated.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!proposal) {
    return (
      <section
        className="print-hidden mt-6 rounded-2xl border border-[var(--sage)]/20 bg-[var(--soft-mint)]/45 p-5"
        data-testid="corrected-copy-grading"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
          Teacher-controlled grading
        </p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Ask AI for a points proposal</h3>
            <p className="mt-1 max-w-[58ch] text-xs leading-5 text-[var(--muted)]">
              The proposal is grounded in this correction. It stays outside the
              gradebook and every statistic until you review every question and
              explicitly validate it.
            </p>
          </div>
          <button
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void requestProposal()}
            type="button"
          >
            {busy === "propose" ? <SpinnerIcon className="size-4 animate-spin" /> : null}
            Propose grading
          </button>
        </div>
        {error ? <p className="mt-3 text-xs text-[#9c4937]">{error}</p> : null}
      </section>
    );
  }

  const validated = proposal.status === "VALIDATED";
  return (
    <section
      className={`mt-6 rounded-2xl border p-5 ${
        validated
          ? "border-[var(--sage)]/25 bg-[var(--soft-mint)]/55"
          : "border-[var(--amber)]/45 bg-[var(--amber)]/10"
      }`}
      data-testid="corrected-copy-grading"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
            {validated ? "Teacher validated" : "AI proposal · teacher decision required"}
          </p>
          <h3 className="mt-1 text-lg font-semibold">
            {validated ? "Validated grade" : "Review every question score"}
          </h3>
          <p className="mt-1 max-w-[62ch] text-xs leading-5 text-[var(--muted)]">
            {validated
              ? "The audit trail preserves the AI proposal and your final per-question values. This total now appears in the gradebook."
              : "Edit any value, complete every manual-scoring item, then validate. Nothing below is included in class or student statistics yet."}
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-black/[0.07] bg-white px-4 py-3 text-right">
          <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            {validated ? "Final total" : "Provisional AI total"}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatPoints(validated ? proposal.finalTotal ?? 0 : proposal.proposedTotal)}
            <span className="text-sm text-[var(--muted)]">/{formatPoints(proposal.maxScore)}</span>
          </p>
          {!validated && proposal.incomplete ? (
            <p className="mt-1 text-[10px] font-semibold text-[#70501f]">
              Incomplete · {proposal.manualItemCount} manual
            </p>
          ) : null}
        </div>
      </div>

      <div className="print-hidden mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {proposal.items.map((item) => (
          <label
            className="flex items-center gap-3 rounded-xl border border-black/[0.07] bg-white/85 px-3 py-2.5"
            key={item.assignmentItemId}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{item.questionReference}</span>
              <span className="block text-[10px] text-[var(--muted)]">
                AI: {item.proposedScore === null ? "manual required" : `${formatPoints(item.proposedScore)}/${formatPoints(item.maxPoints)}`}
              </span>
            </span>
            <input
              aria-label={`Teacher score for ${item.questionReference}`}
              className="w-16 rounded-lg border border-black/10 px-2 py-1.5 text-right text-sm font-semibold tabular-nums outline-none focus:border-[var(--sage)] disabled:bg-[var(--canvas)]"
              disabled={validated || busy !== null}
              inputMode="decimal"
              max={item.maxPoints}
              min={0}
              onChange={(event) =>
                setScores((current) => ({
                  ...current,
                  [item.assignmentItemId]: event.target.value,
                }))
              }
              step="0.01"
              type="number"
              value={scores[item.assignmentItemId] ?? ""}
            />
            <span className="text-xs text-[var(--muted)]">/{formatPoints(item.maxPoints)}</span>
          </label>
        ))}
      </div>

      {!validated ? (
        <div className="print-hidden mt-4 flex flex-col gap-3 border-t border-black/[0.07] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold tabular-nums text-[var(--ink)]">
            Teacher total: {teacherTotal === null ? "incomplete" : `${formatPoints(teacherTotal)}/${formatPoints(proposal.maxScore)}`}
          </p>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy !== null || teacherTotal === null}
            onClick={() => void validateProposal()}
            type="button"
          >
            {busy === "validate" ? <SpinnerIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
            Validate grade &amp; add to gradebook
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-[#9c4937]">{error}</p> : null}
    </section>
  );
}
