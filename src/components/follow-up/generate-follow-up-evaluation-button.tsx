"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SparkIcon, SpinnerIcon } from "@/components/icons";

export function GenerateFollowUpEvaluationButton({
  assignmentId,
  liveAiReady,
  hasMistakes,
}: {
  assignmentId: string;
  liveAiReady: boolean;
  hasMistakes: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy || !liveAiReady || !hasMistakes) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/assignments/${encodeURIComponent(assignmentId)}/follow-up-evaluation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { data?: { id?: string }; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ??
            "The follow-up evaluation request did not complete.",
        );
      }
      const id = payload?.data?.id;
      if (typeof id !== "string" || !id) {
        throw new Error("The generated evaluation did not return an ID.");
      }
      router.push(
        `/analytics/${encodeURIComponent(assignmentId)}/follow-up/${encodeURIComponent(id)}`,
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "The follow-up evaluation request failed.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#244b42] disabled:cursor-not-allowed disabled:opacity-45"
        disabled={busy || !liveAiReady || !hasMistakes}
        onClick={() => void generate()}
        title={
          !hasMistakes
            ? "No diagnosed mistakes are available to retest yet."
            : liveAiReady
              ? "Draft a new evaluation that retests every diagnosed mistake"
              : "Live AI is unavailable. Add OPENAI_API_KEY to .env.local and restart to generate the evaluation."
        }
        type="button"
      >
        {busy ? (
          <SpinnerIcon className="size-4 animate-spin" />
        ) : (
          <SparkIcon className="size-4" />
        )}
        {busy ? "Drafting evaluation…" : "Generate follow-up evaluation"}
      </button>
      {error ? (
        <p aria-live="polite" className="max-w-sm text-[11px] leading-4 text-[#8e402d]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
