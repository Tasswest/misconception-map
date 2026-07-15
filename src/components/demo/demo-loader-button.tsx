"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SparkIcon, SpinnerIcon } from "@/components/icons";

export function DemoLoaderButton({ loaded = false }: { loaded?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDemo() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/demo", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { assignmentId?: string }; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "The demo classroom could not be loaded.");
      }
      const assignmentId = payload?.data?.assignmentId;
      if (assignmentId) {
        router.push(`/assignments/${assignmentId}/dashboard`);
        router.refresh();
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo classroom could not be loaded.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--sage)]/25 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--sidebar)] transition hover:bg-[var(--soft-mint)] disabled:opacity-50"
        disabled={busy}
        onClick={() => void loadDemo()}
        type="button"
      >
        {busy ? (
          <SpinnerIcon className="size-4 animate-spin" />
        ) : (
          <SparkIcon className="size-4" />
        )}
        {busy ? "Loading demo…" : loaded ? "Open demo classroom" : "Load demo classroom"}
      </button>
      {error ? (
        <p aria-live="polite" className="mt-2 max-w-xs text-xs text-[#9c4937]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
