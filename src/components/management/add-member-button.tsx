"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SpinnerIcon } from "@/components/icons";

export function AddMemberButton({
  classId,
  className,
}: {
  classId: string;
  className: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [rosterCode, setRosterCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/classes/${encodeURIComponent(classId)}/students`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: displayName.trim(),
            externalRef: null,
            rosterCode: rosterCode.trim() || null,
            sortOrder: 0,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "The person could not be added.",
        );
      }
      setDisplayName("");
      setRosterCode("");
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The person could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        className="inline-flex items-center rounded-lg border border-[var(--sage)]/25 bg-white px-3 py-2 text-[10px] font-bold text-[var(--sidebar)] transition hover:bg-[var(--soft-mint)] disabled:opacity-45"
        disabled={busy}
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
        type="button"
      >
        + Add person
      </button>

      {open ? (
        <form
          className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-3rem))] rounded-2xl border border-black/10 bg-white p-4 text-left shadow-xl"
          onSubmit={(event) => void addPerson(event)}
        >
          <p className="text-sm font-semibold">Add a person to {className}</p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
            The display name stays in this local workspace and is never included
            in OpenAI prompts.
          </p>
          <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Display name
            <input
              autoFocus
              className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2 text-xs font-medium normal-case tracking-normal outline-none focus:border-[var(--sage)]"
              disabled={busy}
              maxLength={120}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Student name or local label"
              required
              value={displayName}
            />
          </label>
          <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Roster code <span className="font-medium normal-case">(optional)</span>
            <input
              className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2 text-xs font-medium normal-case tracking-normal outline-none focus:border-[var(--sage)]"
              disabled={busy}
              maxLength={40}
              onChange={(event) => setRosterCode(event.target.value)}
              placeholder="For example, 7A-14"
              value={rosterCode}
            />
          </label>
          <div className="mt-4 flex items-center gap-2 border-t border-black/[0.06] pt-3">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--sidebar)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
              disabled={busy || !displayName.trim()}
              type="submit"
            >
              {busy ? <SpinnerIcon className="size-3 animate-spin" /> : null}
              Add to class
            </button>
            <button
              className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--muted)]"
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p aria-live="polite" className="mt-3 text-xs text-[#9c4937]">
              {error}
            </p>
          ) : null}
        </form>
      ) : error ? (
        <p
          aria-live="polite"
          className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-[var(--coral)]/25 bg-white p-3 text-xs text-[#9c4937] shadow-lg"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
