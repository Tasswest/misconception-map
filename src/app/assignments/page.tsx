import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { SetupWorkspace } from "@/components/diagnosis/setup-workspace";
import type { ClassWorkspaceOption } from "@/components/diagnosis/types";
import { EntityActions } from "@/components/management/entity-actions";
import { SingleActionEmptyState } from "@/components/readiness-states";
import { isOpenAIConfigured } from "@/lib/config";
import {
  listManagedAssignments,
  listManagedClasses,
} from "@/server/repositories/management";
import { getDraftWorksheetSetup } from "@/server/repositories/worksheet";
import { listWorkspaceOverview } from "@/server/repositories/workspace";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    assignmentId?: string | string[];
    new?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const requestedAssignmentId = firstValue(query.assignmentId);
  if (firstValue(query.new) === "1" || requestedAssignmentId) {
    return <AssignmentSetupHome assignmentId={requestedAssignmentId} />;
  }

  const assignments = listManagedAssignments();
  const hasClasses = listManagedClasses().length > 0;
  return (
    <AppShell activeNav="Assignments" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-[1260px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
              Diagnostic history
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
              Assignments
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Each assignment reopens at its current workflow step.
            </p>
          </div>
          {hasClasses ? (
            <Link
              className="inline-flex self-start rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
              href="/assignments?new=1"
            >
              New assignment
            </Link>
          ) : null}
        </header>

        {assignments.length ? (
          <div className="mt-6 space-y-3">
            {assignments.map((assignment) => (
              <article
                className="flex flex-col gap-4 rounded-[22px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_14px_38px_rgba(35,51,46,0.04)] lg:flex-row lg:items-center lg:justify-between"
                key={assignment.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-[-0.02em]">
                      {assignment.title}
                    </h2>
                    <span className="rounded-full bg-[var(--soft-mint)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--sage)]">
                      {assignment.domain.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {assignment.className} · {formatDate(assignment.createdAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                    <span>{countLabel(assignment.itemCount, "problem")}</span>
                    <span>{assignment.diagnosedStudentCount} of {assignment.studentCount} {assignment.studentCount === 1 ? "student" : "students"} diagnosed</span>
                    <span>{countLabel(assignment.needsReviewCount, "uncertain flag")}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="rounded-xl bg-[var(--sidebar)] px-3.5 py-2.5 text-xs font-semibold text-white"
                    href={assignment.currentStepHref}
                  >
                    Continue · {assignment.currentStep} of 4
                  </Link>
                  {assignment.currentStep === 4 ? (
                    <Link
                      className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold"
                      href={`/analytics/${assignment.id}`}
                    >
                      Open analytics
                    </Link>
                  ) : null}
                  <EntityActions
                    currentName={assignment.title}
                    entity="assignment"
                    entityId={assignment.id}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          hasClasses ? (
            <SingleActionEmptyState
              actionHref="/assignments?new=1"
              actionLabel="Create the first assignment"
              description="Upload one exam source, review its exercise structure, then add student copies."
              title="No active assignments"
            />
          ) : (
            <SingleActionEmptyState
              actionHref="/assignments?new=1"
              actionLabel="Create a class and assignment"
              description="Start with the class context, then add the teacher exam on the same guided screen."
              title="No active assignments"
            />
          )
        )}
      </div>
    </AppShell>
  );
}

function AssignmentSetupHome({ assignmentId }: { assignmentId?: string }) {
  let initialDraft = null;
  if (assignmentId) {
    try {
      initialDraft = getDraftWorksheetSetup(assignmentId);
    } catch {
      initialDraft = null;
    }
  }
  const overview = listWorkspaceOverview();
  const liveAiReady = isOpenAIConfigured();
  const initialClasses: ClassWorkspaceOption[] = overview.map((classroom) => ({
    id: classroom.id,
    name: classroom.name,
    gradeBand: classroom.gradeBand,
    schoolYear: classroom.schoolYear,
    students: classroom.memberships.map((membership) => ({
      membershipId: membership.id,
      displayName: membership.displayName,
    })),
    assignments: classroom.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      domain: assignment.domain,
      problemPrompt: assignment.item?.prompt ?? null,
      correctAnswer: assignment.item?.correctAnswer ?? null,
    })),
  }));

  return (
    <AppShell activeNav="Assignments" liveAiReady={liveAiReady}>
      <SetupWorkspace
        initialClasses={initialClasses}
        initialDraft={initialDraft}
        liveAiReady={liveAiReady}
      />
    </AppShell>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
