import Link from "next/link";

import { AlertIcon, ClipboardIcon } from "@/components/icons";

export function FreshDatabaseState({
  title = "No demo data is loaded yet",
}: {
  title?: string;
}) {
  return (
    <section className="mx-auto mt-8 max-w-2xl rounded-[24px] border border-dashed border-[var(--sage)]/30 bg-white/70 px-6 py-14 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
        <ClipboardIcon className="size-5" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
        Run this one command to load the complete synthetic classroom, results
        counts, grouped exercises, corrected copies, and Prediction Lab history.
      </p>
      <code className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-3 text-sm font-semibold text-white">
        npm run seed
      </code>
    </section>
  );
}

export function AiUnavailableNotice({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-[var(--amber)]/35 bg-[var(--amber)]/15 px-4 py-3.5 text-sm leading-6 text-[#765725] ${className}`}
      role="status"
    >
      <AlertIcon className="mt-1 size-4 shrink-0" />
      <p>
        Live AI is currently unavailable. In a local clone, add <code className="rounded bg-white/60 px-1.5 py-0.5 text-xs">OPENAI_API_KEY</code>{" "}
        to <code className="rounded bg-white/60 px-1.5 py-0.5 text-xs">.env.local</code> to enable live correction. On the shared demo, the banner above reports any daily budget limit. Seeded results remain fully readable.
      </p>
    </div>
  );
}

export function SingleActionEmptyState({
  actionHref,
  actionLabel,
  description,
  title,
}: {
  actionHref: string;
  actionLabel: string;
  description: string;
  title: string;
}) {
  return (
    <section className="mt-6 rounded-[24px] border border-dashed border-black/10 bg-white/60 px-6 py-14 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">{description}</p>
      <Link
        className="mt-5 inline-flex rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
        href={actionHref}
      >
        {actionLabel}
      </Link>
    </section>
  );
}
