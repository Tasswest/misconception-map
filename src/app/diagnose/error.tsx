"use client";

import Link from "next/link";
import { AlertIcon, RefreshIcon } from "@/components/icons";

export default function DiagnoseSetupError({ reset }: { reset: () => void }) {
  return (
    <div className="grid min-h-[70vh] place-items-center bg-[var(--canvas)] px-5 py-12">
      <div className="max-w-md rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-7 text-center shadow-[0_18px_45px_rgba(35,51,46,0.06)]">
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--soft-coral)] text-[#9c4934]">
          <AlertIcon className="size-5" />
        </span>
        <h1 className="mt-5 text-xl font-semibold">The workspace did not load.</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Your local data has not been changed. Try loading it again or return to the overview.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
            onClick={reset}
            type="button"
          >
            <RefreshIcon className="size-4" /> Try again
          </button>
          <Link
            className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold"
            href="/"
          >
            Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
