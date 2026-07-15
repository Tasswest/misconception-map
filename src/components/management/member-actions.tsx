"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SpinnerIcon } from "@/components/icons";

export function MemberActions({
  classId,
  membershipId,
  currentName,
}: {
  classId: string;
  membershipId: string;
  currentName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(membershipId)}`;

  async function readError(response: Response) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    return payload?.error?.message ?? "The roster could not be updated.";
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName || displayName === currentName) return;
    setBusy("save");
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The roster update failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Remove “${currentName}” from this class? Their submissions, diagnoses, Student Models, predictions, and generated practice for this class will be permanently deleted.`,
      )
    ) {
      return;
    }
    setBusy("remove");
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The member removal failed.",
      );
      setBusy(null);
    }
  }

  return (
    <div className="relative shrink-0">
      <div className="flex items-center gap-1">
        <button
          aria-label={`Edit ${currentName}`}
          className="rounded-md px-2 py-1 text-[10px] font-semibold text-[var(--muted)] transition hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
          disabled={busy !== null}
          onClick={() => {
            setEditing((open) => !open);
            setError(null);
          }}
          type="button"
        >
          Edit
        </button>
        <button
          aria-label={`Remove ${currentName} from class`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-[#9c4937] transition hover:bg-[var(--soft-coral)] disabled:opacity-45"
          disabled={busy !== null}
          onClick={() => void remove()}
          type="button"
        >
          {busy === "remove" ? (
            <SpinnerIcon className="size-2.5 animate-spin" />
          ) : null}
          Remove
        </button>
      </div>

      {editing ? (
        <form
          className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-black/10 bg-white p-3 shadow-xl"
          onSubmit={(event) => void save(event)}
        >
          <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Student display name
            <input
              autoFocus
              className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2 text-xs font-medium normal-case tracking-normal outline-none focus:border-[var(--sage)]"
              disabled={busy !== null}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--sidebar)] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-45"
              disabled={busy !== null || !name.trim() || name.trim() === currentName}
              type="submit"
            >
              {busy === "save" ? (
                <SpinnerIcon className="size-2.5 animate-spin" />
              ) : null}
              Save
            </button>
            <button
              className="px-2 py-2 text-[10px] font-semibold text-[var(--muted)]"
              disabled={busy !== null}
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p aria-live="polite" className="mt-2 text-[10px] text-[#9c4937]">
              {error}
            </p>
          ) : null}
        </form>
      ) : error ? (
        <p
          aria-live="polite"
          className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-[var(--coral)]/25 bg-white p-3 text-[10px] text-[#9c4937] shadow-lg"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
