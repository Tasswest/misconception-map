import Link from "next/link";

import type {
  AssignmentErrorInventory,
  ErrorInventoryItem,
} from "@/server/repositories/error-inventory";

export function ErrorLog({
  inventory,
}: {
  inventory: AssignmentErrorInventory;
}) {
  const hasErrors =
    inventory.totals.misconceptionOccurrenceCount > 0 ||
    inventory.totals.slipCount > 0 ||
    inventory.totals.uncertainCount > 0 ||
    inventory.totals.outOfScopeCount > 0;
  if (!hasErrors) return null;
  return (
    <section className="mt-6 scroll-mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]" id="error-log">
      <div className="border-b border-black/[0.06] px-5 py-5 md:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
          Complete inventory
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
          What errors were found in the copies?
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          Ranked by teaching priority: repeated patterns first, then one-off slips by exercise, then items the AI could not settle. Open a group to see the exact evidence and copy.
        </p>
        <p className="mt-2 max-w-4xl text-xs leading-5 text-[var(--muted)]">
          A one-off slip is not a misconception. Only repeated, evidenced patterns can feed Student Models. This distinction follows{" "}
          <a
            className="font-semibold text-[var(--sage)] underline decoration-[var(--sage)]/35 underline-offset-2"
            href="https://doi.org/10.1207/s15516709cog0804_4"
            rel="noreferrer"
            target="_blank"
          >
            Sleeman (1984)
          </a>
          .
        </p>
      </div>
      <div className="divide-y divide-black/[0.06]">
        {inventory.misconceptions.length ? (
          <InventorySection
            summary={`Misconceptions: ${inventory.totals.misconceptionTypeCount} ${inventory.totals.misconceptionTypeCount === 1 ? "type" : "types"} · ${inventory.totals.misconceptionStudentCount} ${inventory.totals.misconceptionStudentCount === 1 ? "student" : "students"} · ${inventory.totals.misconceptionOccurrenceCount} ${inventory.totals.misconceptionOccurrenceCount === 1 ? "occurrence" : "occurrences"}`}
            tone="coral"
          >
            {inventory.misconceptions.map((group, index) => (
              <div className="rounded-2xl border border-[var(--coral)]/15 bg-[var(--soft-coral)]/55 p-4" key={group.misconceptionId}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{index + 1}. {group.teacherLabel}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {group.distinctStudentCount} {group.distinctStudentCount === 1 ? "student" : "students"} · {group.occurrenceCount} {group.occurrenceCount === 1 ? "occurrence" : "occurrences"}
                  </p>
                </div>
                <ItemList items={group.items} />
              </div>
            ))}
          </InventorySection>
        ) : null}

        {inventory.slipsByExercise.length ? (
          <InventorySection
            summary={`Isolated slips: ${inventory.totals.slipCount} ${inventory.totals.slipCount === 1 ? "one-off slip" : "one-off slips"}`}
            tone="amber"
          >
            {inventory.slipsByExercise.map((group, index) => (
              <div className="rounded-2xl border border-[var(--amber)]/25 bg-[var(--amber)]/8 p-4" key={`${group.exercisePosition}:${group.exerciseLabel}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{index + 1}. {group.exerciseLabel}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {group.occurrenceCount} of {inventory.totals.slipCount} isolated {inventory.totals.slipCount === 1 ? "slip" : "slips"} · {group.distinctStudentCount} {group.distinctStudentCount === 1 ? "student" : "students"}
                  </p>
                </div>
                <ItemList items={group.items} />
              </div>
            ))}
          </InventorySection>
        ) : null}

        {inventory.uncertain.length ? (
          <InventorySection
            summary={`AI uncertainty: ${inventory.uncertain.length} ${inventory.uncertain.length === 1 ? "item" : "items"} the AI could not settle`}
            tone="amber"
          >
            <ItemList items={inventory.uncertain} />
          </InventorySection>
        ) : null}

        {inventory.outOfScope.length ? (
          <InventorySection
            summary={`Out of scope: ${inventory.outOfScope.length} of ${inventory.outOfScope.length} valid ${inventory.outOfScope.length === 1 ? "item" : "items"} outside algebra/fractions`}
            tone="neutral"
          >
            <ItemList items={inventory.outOfScope} />
          </InventorySection>
        ) : null}
      </div>
    </section>
  );
}

function InventorySection({
  children,
  summary,
  tone,
}: {
  children: React.ReactNode;
  summary: string;
  tone: "coral" | "amber" | "neutral";
}) {
  const marker =
    tone === "coral"
      ? "bg-[var(--coral)]"
      : tone === "amber"
        ? "bg-[var(--amber)]"
        : "bg-[var(--line)]";
  return (
    <details className="group px-5 py-4 md:px-6">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sage)]">
        <span className="flex items-center gap-3 text-sm font-semibold">
          <span className={`size-2.5 rounded-full ring-1 ring-black/10 ${marker}`} />
          {summary}
        </span>
        <span aria-hidden="true" className="text-lg text-[var(--muted)] transition group-open:rotate-45">+</span>
      </summary>
      <div className="mt-4 space-y-3">{children}</div>
    </details>
  );
}

function ItemList({ items }: { items: ErrorInventoryItem[] }) {
  return (
    <ul className="mt-3 divide-y divide-black/[0.06]">
      {items.map((item) => (
        <li className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" key={item.id}>
          <div>
            <p className="text-xs font-semibold">
              {item.studentName} · {item.questionReference}
            </p>
            <blockquote className="mt-1 border-l-2 border-black/10 pl-3 font-mono text-xs leading-5 text-[var(--ink)]">
              “{item.evidenceQuote}”
            </blockquote>
            {item.explanation ? (
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.explanation}</p>
            ) : null}
          </div>
          <Link
            className="text-xs font-semibold text-[var(--sage)] underline-offset-4 hover:underline"
            href={item.correctedCopyUrl}
          >
            Open corrected copy →
          </Link>
        </li>
      ))}
    </ul>
  );
}
