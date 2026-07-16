"use client";

import { AlertIcon, RefreshIcon } from "@/components/icons";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-12">
      <section className="max-w-md rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-7 text-center shadow-[0_18px_45px_rgba(35,51,46,0.06)]">
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--soft-coral)] text-[#9c4934]">
          <AlertIcon className="size-5" />
        </span>
        <h1 className="mt-5 text-xl font-semibold">This screen could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Local data was not changed. Retry this screen once; any saved AI work remains available.
        </p>
        <button
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
          onClick={reset}
          type="button"
        >
          <RefreshIcon className="size-4" /> Retry this screen
        </button>
      </section>
    </div>
  );
}
