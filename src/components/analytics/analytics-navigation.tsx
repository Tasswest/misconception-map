import Link from "next/link";

import { AssignmentStepper } from "@/components/assignment-stepper";

export type AnalyticsTab = "class" | "copies" | "practice";

const tabs = [
  { key: "class" as const, label: "Class by exercise", suffix: "" },
  {
    key: "copies" as const,
    label: "Corrected copies",
    suffix: "/corrected-copies",
  },
  {
    key: "practice" as const,
    label: "Practice & brief",
    suffix: "/practice",
  },
];

export function AnalyticsTabs({
  activeTab,
  assignmentId,
  className = "",
}: {
  activeTab: AnalyticsTab;
  assignmentId: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Assignment analytics"
      className={`overflow-x-auto rounded-2xl border border-black/[0.06] bg-white/70 p-1.5 ${className}`}
    >
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sage)] ${
                active
                  ? "bg-[var(--sidebar)] text-white shadow-sm"
                  : "text-[var(--muted)] hover:bg-[var(--soft-mint)] hover:text-[var(--ink)]"
              }`}
              href={`/analytics/${assignmentId}${tab.suffix}`}
              key={tab.key}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AnalyticsHeader({
  activeTab,
  assignment,
  description,
}: {
  activeTab: AnalyticsTab;
  assignment: { id: string; title: string; className: string };
  description: string;
}) {
  const activeLabel = tabs.find((tab) => tab.key === activeTab)?.label;
  return (
    <>
      <AssignmentStepper
        assignmentId={assignment.id}
        className="mb-7"
        currentStep={4}
      />
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <Link className="transition hover:text-[var(--ink)]" href="/analytics">
              Analytics
            </Link>
            <span aria-hidden="true">/</span>
            <span>{assignment.className}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--sage)]">{activeLabel}</span>
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
            {assignment.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {description}
          </p>
        </div>
        {activeTab !== "copies" ? (
          <Link
            className="inline-flex self-start items-center justify-center rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] md:self-auto"
            href={`/analytics/${assignment.id}/corrected-copies`}
          >
            See corrected copies
          </Link>
        ) : null}
      </div>
      <AnalyticsTabs
        activeTab={activeTab}
        assignmentId={assignment.id}
        className="mt-5"
      />
    </>
  );
}
