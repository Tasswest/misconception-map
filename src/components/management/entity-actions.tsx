"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SpinnerIcon } from "@/components/icons";

export function EntityActions({
  entity,
  entityId,
  currentName,
}: {
  entity: "class" | "assignment";
  entityId: string;
  currentName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState<"rename" | "archive" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint =
    entity === "class"
      ? `/api/classes/${encodeURIComponent(entityId)}`
      : `/api/assignments/${encodeURIComponent(entityId)}`;

  async function mutate(body: unknown) {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "The update did not complete.");
    }
  }

  async function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName === currentName) return;
    setBusy("rename");
    setError(null);
    try {
      await mutate({ name: nextName });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rename failed.");
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    if (
      !window.confirm(
        `Archive “${currentName}”? It will leave active views without deleting its evidence history.`,
      )
    ) {
      return;
    }
    setBusy("archive");
    setError(null);
    try {
      await mutate({ action: "ARCHIVE" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Archive failed.");
      setBusy(null);
    }
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]">
        Manage
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-black/10 bg-white p-3 shadow-xl">
        <form className="space-y-2" onSubmit={(event) => void rename(event)}>
          <label
            className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]"
            htmlFor={`rename-${entity}-${entityId}`}
          >
            Rename {entity}
          </label>
          <input
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-xs outline-none focus:border-[var(--sage)]"
            disabled={busy !== null}
            id={`rename-${entity}-${entityId}`}
            maxLength={entity === "class" ? 120 : 160}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--sidebar)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
            disabled={busy !== null || !name.trim() || name.trim() === currentName}
            type="submit"
          >
            {busy === "rename" ? (
              <SpinnerIcon className="size-3 animate-spin" />
            ) : null}
            Save name
          </button>
        </form>
        <div className="mt-3 border-t border-black/[0.06] pt-3">
          <button
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9c4937] disabled:opacity-45"
            disabled={busy !== null}
            onClick={() => void archive()}
            type="button"
          >
            {busy === "archive" ? (
              <SpinnerIcon className="size-3 animate-spin" />
            ) : null}
            Archive {entity}
          </button>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
            Evidence is preserved; this only removes it from active views.
          </p>
        </div>
        {error ? (
          <p aria-live="polite" className="mt-2 text-xs text-[#9c4937]">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
