import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ClipboardIcon, GridIcon, UsersIcon } from "@/components/icons";
import { isOpenAIConfigured } from "@/lib/config";
import {
  listManagedAssignments,
  listManagedClasses,
} from "@/server/repositories/management";

export const dynamic = "force-dynamic";

const firstRunSteps = [
  {
    number: 1,
    title: "Create a class",
    description: "Name the class and add the local roster.",
    href: "/assignments?new=1#class-setup",
    action: "Create a class",
    icon: UsersIcon,
  },
  {
    number: 2,
    title: "Create an assignment",
    description: "Choose the class and name the diagnostic.",
    href: "/assignments?new=1#assignments",
    action: "Create an assignment",
    icon: ClipboardIcon,
  },
  {
    number: 3,
    title: "Upload the exam",
    description: "Add the teacher copy and confirm its extracted questions.",
    href: "/assignments?new=1#assignments",
    action: "Upload the exam",
    icon: GridIcon,
  },
] as const;

export default function Home() {
  if (listManagedAssignments().length > 0) {
    redirect("/assignments");
  }

  const hasClass = listManagedClasses().length > 0;
  return (
    <AppShell activeNav="Assignments" liveAiReady={isOpenAIConfigured()}>
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-8 lg:px-10 lg:py-14">
        <header className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
            First run
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
            1. Create a class → 2. Create an assignment → 3. Upload the exam
          </h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            Follow these three setup actions once. The assignment stepper takes over from there.
          </p>
        </header>

        <section className="mt-7 grid gap-4 lg:grid-cols-3">
          {firstRunSteps.map((step) => {
            const Icon = step.icon;
            return (
              <article
                className="flex flex-col rounded-[22px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_14px_38px_rgba(35,51,46,0.04)]"
                key={step.number}
              >
                <span className="grid size-10 place-items-center rounded-2xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
                  <Icon className="size-4" />
                </span>
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                  Step {step.number}
                </p>
                <h2 className="mt-1 text-lg font-semibold">{step.title}</h2>
                <p className="mt-2 flex-1 text-xs leading-5 text-[var(--muted)]">
                  {step.description}
                </p>
                <Link
                  className="mt-5 inline-flex justify-center rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white"
                  href={step.href}
                >
                  {hasClass && step.number === 1 ? "Open class setup" : step.action}
                </Link>
              </article>
            );
          })}
        </section>

        <aside className="mt-5 rounded-2xl border border-dashed border-[var(--sage)]/30 bg-white/65 px-5 py-4 text-sm leading-6 text-[var(--muted)]">
          Want the complete judge classroom instead? Run <code className="rounded bg-[var(--soft-mint)] px-2 py-1 font-semibold text-[var(--sidebar)]">npm run seed</code>, then reopen the app.
        </aside>
      </div>
    </AppShell>
  );
}
