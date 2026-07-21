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
          href={`/analytics/${results.assignment.id}`}
        >
          Open class analytics
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

      <section className="mt-6">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Read the results in Analytics</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Everything below is already computed from this correction; nothing needs to be re-run.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <NextStepCard
            description="The class summary: most frequent difficulties with the students behind each one, exercise success rates, and the per-student evidence grid."
            href={`/analytics/${results.assignment.id}`}
            step="1"
            title="Class by exercise"
          />
          <NextStepCard
            description={`One returnable, exercise-grouped copy for each of the ${results.correctedCopies.length} ${results.correctedCopies.length === 1 ? "student" : "students"}, with feedback in the language of the exam.`}
            href={`/analytics/${results.assignment.id}/corrected-copies`}
            step="2"
            title="Corrected copies"
          />
          <NextStepCard
            description="The Teach This Tomorrow brief, targeted practice sheets, and a follow-up evaluation that retests every diagnosed mistake."
            href={`/analytics/${results.assignment.id}/practice`}
            step="3"
            title="Practice & brief"
          />
        </div>
      </section>
    </div>
  );
}

function NextStepCard({
  description,
  href,
  step,
  title,
}: {
  description: string;
  href: string;
  step: string;
  title: string;
}) {
  return (
    <Link
      className="group rounded-[22px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_14px_35px_rgba(35,51,46,0.04)] transition hover:border-[var(--sage)]/35 hover:shadow-[0_18px_45px_rgba(35,51,46,0.08)]"
      href={href}
    >
      <span className="grid size-7 place-items-center rounded-lg bg-[var(--soft-mint)] text-xs font-bold text-[var(--sidebar)]">
        {step}
      </span>
      <h3 className="mt-3 text-sm font-semibold">
        {title}
        <span aria-hidden="true" className="ml-1 inline-block transition group-hover:translate-x-0.5">→</span>
      </h3>
      <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{description}</p>
    </Link>
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
