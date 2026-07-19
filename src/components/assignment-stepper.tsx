import Link from "next/link";

import { CheckIcon } from "@/components/icons";

export type AssignmentWorkflowStep = 1 | 2 | 3 | 4;

const steps = [
  { number: 1 as const, label: "Exam source" },
  { number: 2 as const, label: "Student copies" },
  { number: 3 as const, label: "AI correction" },
  { number: 4 as const, label: "Results" },
];

export function AssignmentStepper({
  assignmentId,
  currentStep,
  className = "",
}: {
  assignmentId?: string;
  currentStep: AssignmentWorkflowStep;
  className?: string;
}) {
  return (
    <nav
      aria-label="Exam progress"
      className={`assignment-stepper ${className}`}
    >
      <ol className="grid gap-2 rounded-[22px] border border-black/[0.06] bg-[var(--paper)] p-2 shadow-[0_12px_32px_rgba(35,51,46,0.04)] sm:grid-cols-4">
        {steps.map((step) => {
          const completed = step.number < currentStep;
          const current = step.number === currentStep;
          const content = (
            <>
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  completed
                    ? "bg-[var(--sage)] text-white"
                    : current
                      ? "bg-[var(--sidebar)] text-white"
                      : "bg-black/[0.05] text-[var(--muted)]"
                }`}
              >
                {completed ? <CheckIcon className="size-3.5" /> : step.number}
              </span>
              <span className="min-w-0">
                <span className="block text-[9px] font-bold uppercase tracking-[0.11em] text-[var(--muted)]">
                  {current ? "You are here" : completed ? "Complete" : "Next"}
                </span>
                <span className="mt-0.5 block truncate text-xs font-semibold">
                  {step.label}
                </span>
              </span>
            </>
          );
          const classes = `flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-left ${
            current
              ? "bg-[var(--soft-mint)] text-[var(--sidebar)] ring-1 ring-[var(--sage)]/20"
              : "text-[var(--ink)]"
          }`;
          const href = completed
            ? step.number === 4
              ? assignmentId
                ? `/assignments/${assignmentId}/results`
                : null
              : step.number >= 2 && assignmentId
                ? `/assignments/${assignmentId}/diagnose`
                : null
            : null;
          return (
            <li aria-current={current ? "step" : undefined} key={step.number}>
              {href ? (
                <Link className={`${classes} transition hover:bg-[var(--canvas)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sage)]`} href={href}>
                  {content}
                </Link>
              ) : (
                <div className={classes}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
