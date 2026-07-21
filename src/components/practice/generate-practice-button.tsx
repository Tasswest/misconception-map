"use client";

import Link from "next/link";
import { useState } from "react";

import { SparkIcon, SpinnerIcon } from "@/components/icons";

export function GeneratePracticeButton({
  assignmentId,
  membershipId,
  misconceptionId,
  studentName,
  liveAiReady,
}: {
  assignmentId: string;
  membershipId: string;
  misconceptionId: string;
  studentName: string;
  liveAiReady: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worksheetId, setWorksheetId] = useState<string | null>(null);

  async function generate() {
    if (busy || !liveAiReady) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/assignments/${encodeURIComponent(assignmentId)}/practice`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ membershipId, misconceptionId }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { data?: { id?: string }; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "The practice request did not complete.",
        );
      }
      const id = payload?.data?.id;
      if (typeof id !== "string" || !id) {
        throw new Error("The generated worksheet did not return an ID.");
      }
      setWorksheetId(id);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "The practice request failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (worksheetId) {
    return (
      <Link
        className="inline-flex self-start rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold transition hover:bg-[var(--canvas)] sm:self-auto"
        href={`/analytics/${assignmentId}/practice/${worksheetId}`}
      >
        Open worksheet &amp; answer key
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--sage)]/25 bg-white px-3.5 py-2.5 text-xs font-semibold text-[var(--sidebar)] transition hover:bg-[var(--soft-mint)] disabled:cursor-not-allowed disabled:opacity-45"
        disabled={busy || !liveAiReady}
        onClick={() => void generate()}
        title={
          liveAiReady
            ? `Generate a five-question practice sheet for ${studentName}`
            : "Live AI is unavailable. Add OPENAI_API_KEY to .env.local and restart to generate practice."
        }
        type="button"
      >
        {busy ? (
          <SpinnerIcon className="size-3.5 animate-spin" />
        ) : (
          <SparkIcon className="size-3.5" />
        )}
        {busy ? "Generating…" : "Generate practice sheet"}
      </button>
      {error ? (
        <p aria-live="polite" className="max-w-xs text-[11px] leading-4 text-[#8e402d]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
