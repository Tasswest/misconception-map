"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SpinnerIcon } from "@/components/icons";

type GradeBand =
  | "GRADE_5"
  | "GRADE_6"
  | "GRADE_7"
  | "GRADE_8"
  | "MIXED_5_8";

const gradeOptions: Array<[GradeBand, string]> = [
  ["GRADE_5", "Grade 5"],
  ["GRADE_6", "Grade 6"],
  ["GRADE_7", "Grade 7"],
  ["GRADE_8", "Grade 8"],
  ["MIXED_5_8", "Grades 5–8"],
];

export function ClassActions({
  classId,
  currentName,
  currentGradeBand,
  currentSchoolYear,
  currentSchoolName,
}: {
  classId: string;
  currentName: string;
  currentGradeBand: GradeBand;
  currentSchoolYear: string | null;
  currentSchoolName: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [gradeBand, setGradeBand] = useState(currentGradeBand);
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear ?? "");
  const [schoolName, setSchoolName] = useState(currentSchoolName ?? "");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/classes/${encodeURIComponent(classId)}`;

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
      throw new Error(
        payload?.error?.message ?? "The class could not be updated.",
      );
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    try {
      await mutate({
        name: name.trim(),
        gradeBand,
        schoolYear: schoolYear.trim() || null,
        schoolName: schoolName.trim() || null,
      });
      setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The class update failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Remove “${currentName}” from active views? Its assignments and evidence history will remain archived.`,
      )
    ) {
      return;
    }
    setBusy("remove");
    setError(null);
    try {
      await mutate({ action: "ARCHIVE" });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The class removal failed.",
      );
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--canvas)] disabled:opacity-45"
          disabled={busy !== null}
          onClick={() => {
            setEditing((open) => !open);
            setError(null);
          }}
          type="button"
        >
          Edit class
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--coral)]/25 bg-white px-3 py-2 text-xs font-semibold text-[#9c4937] transition hover:bg-[var(--soft-coral)] disabled:opacity-45"
          disabled={busy !== null}
          onClick={() => void remove()}
          type="button"
        >
          {busy === "remove" ? (
            <SpinnerIcon className="size-3 animate-spin" />
          ) : null}
          Remove class
        </button>
      </div>

      {editing ? (
        <form
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-3rem))] space-y-3 rounded-2xl border border-black/10 bg-white p-4 text-left shadow-xl"
          onSubmit={(event) => void save(event)}
        >
          <div>
            <p className="text-sm font-semibold">Edit class details</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
              These changes update labels only; existing evidence remains linked.
            </p>
          </div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Class name
            <input
              className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2 text-xs font-medium normal-case tracking-normal outline-none focus:border-[var(--sage)]"
              disabled={busy !== null}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            School <span className="font-medium normal-case">(optional)</span>
            <input
              className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2 text-xs font-medium normal-case tracking-normal outline-none focus:border-[var(--sage)]"
              disabled={busy !== null}
              maxLength={120}
              onChange={(event) => setSchoolName(event.target.value)}
              placeholder="Collège Jean Moulin"
              value={schoolName}
            />
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Grade band
            <select
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-medium normal-case tracking-normal outline-none focus:border-[var(--sage)]"
              disabled={busy !== null}
              onChange={(event) =>
                setGradeBand(event.target.value as GradeBand)
              }
              value={gradeBand}
            >
              {gradeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            School year
            <input
              className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2 text-xs font-medium normal-case tracking-normal outline-none focus:border-[var(--sage)]"
              disabled={busy !== null}
              maxLength={20}
              onChange={(event) => setSchoolYear(event.target.value)}
              placeholder="2026–27"
              value={schoolYear}
            />
          </label>
          <div className="flex items-center gap-2 border-t border-black/[0.06] pt-3">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--sidebar)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
              disabled={busy !== null || !name.trim()}
              type="submit"
            >
              {busy === "save" ? (
                <SpinnerIcon className="size-3 animate-spin" />
              ) : null}
              Save changes
            </button>
            <button
              className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--muted)]"
              disabled={busy !== null}
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p aria-live="polite" className="text-xs text-[#9c4937]">
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
