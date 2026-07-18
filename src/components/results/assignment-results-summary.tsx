import Link from "next/link";

import { AlertIcon, CheckIcon, FileTextIcon } from "@/components/icons";
import type { AssignmentResults } from "@/server/repositories/assignment-results";

export function AssignmentResultsSummary({
  results,
}: {
  results: AssignmentResults;
}) {
  const { summary } = results;
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-10 pt-7 md:px-8 lg:px-10 lg:pb-14">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <Link className="transition hover:text-[var(--ink)]" href="/assignments">
              Assignments
            </Link>
            <span aria-hidden="true">/</span>
            <span>{results.assignment.className}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--sage)]">Results</span>
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
            Results · {results.assignment.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Correction is complete. Uncertain items remain visible in each copy and in the error inventory; no follow-up action is required.
          </p>
        </div>
        <Link
          className="inline-flex self-start rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white md:self-auto"
          href={`/analytics/${results.assignment.id}/corrected-copies`}
        >
          See corrected copies
        </Link>
      </div>

      <section className="mt-7 overflow-hidden rounded-[26px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
        <div className="border-b border-black/[0.06] px-5 py-5 md:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
            Results summary
          </p>
          <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.03em]">
            {summary.submittedCopyCount} {summary.submittedCopyCount === 1 ? "copy" : "copies"} uploaded · {summary.diagnosedItemCount} {summary.diagnosedItemCount === 1 ? "item" : "items"} corrected · {summary.flaggedItemCount} {summary.flaggedItemCount === 1 ? "item" : "items"} flagged as uncertain
            {summary.outsideAnalysisCount > 0
              ? ` · ${summary.outsideAnalysisCount} outside misconception analysis`
              : ""}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            A flag means the AI abstained instead of guessing. The reason travels with the student&apos;s evidence.
          </p>
        </div>
        <div className="grid md:grid-cols-3">
          <SummaryCard
            icon={<CheckIcon className="size-5" />}
            label="Corrected work"
            value={`${summary.diagnosedItemCount} items across ${summary.submittedCopyCount} copies`}
          />
          <SummaryCard
            icon={<AlertIcon className="size-5" />}
            label="AI uncertainty"
            tone="amber"
            value={`${summary.flaggedItemCount} items the AI could not settle`}
          />
          <SummaryCard
            icon={<FileTextIcon className="size-5" />}
            label="Misconception-analysis boundary"
            tone="neutral"
            value={`${summary.outsideAnalysisCount} items outside algebra/fractions analysis`}
          />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-black/[0.06] px-5 py-4 md:px-6">
          <Link
            className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs font-semibold"
            href={`/analytics/${results.assignment.id}/corrected-copies`}
          >
            See corrected copies
          </Link>
          <Link
            className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs font-semibold"
            href={`/analytics/${results.assignment.id}#error-log`}
          >
            See error inventory
          </Link>
        </div>
      </section>

      {results.correctedCopies.length ? (
        <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)]">
          <div className="border-b border-black/[0.06] px-5 py-4 md:px-6">
            <h2 className="text-lg font-semibold">Corrected copies</h2>
          </div>
          <div className="divide-y divide-black/[0.06]">
            {results.correctedCopies.map((copy) => (
              <article
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6"
                key={copy.membershipId}
              >
                <div>
                  <h3 className="text-sm font-semibold">{copy.studentName}</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {copy.diagnosedCount} items corrected · {copy.flaggedCount} flagged as uncertain
                    {copy.outsideAnalysisCount
                      ? ` · ${copy.outsideAnalysisCount} outside misconception analysis`
                      : ""}
                  </p>
                </div>
                <Link
                  className="self-start rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold sm:self-auto"
                  href={copy.correctedCopyUrl}
                >
                  Read corrected copy
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  tone = "mint",
  value,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "mint" | "amber" | "neutral";
  value: string;
}) {
  const color =
    tone === "mint"
      ? "bg-[var(--soft-mint)] text-[var(--sage)]"
      : tone === "amber"
        ? "bg-[var(--amber)]/16 text-[#765725]"
        : "bg-[var(--canvas)] text-[var(--muted)]";
  return (
    <article className="border-b border-black/[0.06] p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 md:p-6">
      <span className={`grid size-10 place-items-center rounded-xl ${color}`}>{icon}</span>
      <p className="mt-4 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{label}</p>
    </article>
  );
}
