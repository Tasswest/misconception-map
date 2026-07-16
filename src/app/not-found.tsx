import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-12">
      <section className="max-w-md rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-7 text-center shadow-[0_18px_45px_rgba(35,51,46,0.06)]">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">Not found</p>
        <h1 className="mt-3 text-2xl font-semibold">This local workspace item is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          It may have been archived or belong to another local database.
        </p>
        <Link
          className="mt-6 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
          href="/"
        >
          Return to overview
        </Link>
      </section>
    </div>
  );
}
