import Link from "next/link";
import { ClipboardIcon } from "@/components/icons";

export default function AssignmentNotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-12">
      <div className="max-w-md rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-7 text-center shadow-[0_18px_45px_rgba(35,51,46,0.06)]">
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
          <ClipboardIcon className="size-5" />
        </span>
        <h1 className="mt-5 text-xl font-semibold">Assignment not found</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          It may have been archived, or the link may be incomplete.
        </p>
        <Link
          className="mt-6 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
          href="/assignments"
        >
          Choose an assignment
        </Link>
      </div>
    </div>
  );
}
