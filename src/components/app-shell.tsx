import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardIcon,
  GridIcon,
  SparkIcon,
  UsersIcon,
} from "@/components/icons";
import { isHostedMode } from "@/lib/hosted-access";
import { getAiAvailability } from "@/server/openai/spend-protection";

const navigation = [
  { key: "Classes", label: "Classes", icon: UsersIcon, href: "/classes" },
  {
    key: "Assignments",
    label: "Assignments",
    icon: ClipboardIcon,
    href: "/assignments",
  },
  { key: "Analytics", label: "Analytics", icon: GridIcon, href: "/analytics" },
  {
    key: "Prediction Lab",
    label: "Prediction Lab",
    icon: SparkIcon,
    href: "/prediction-lab",
    protected: true,
  },
] as const;

export type AppNavItem = (typeof navigation)[number]["key"];

type AppShellProps = {
  children: ReactNode;
  liveAiReady: boolean;
  activeNav?: AppNavItem | null;
};

export function AppShell({
  children,
  liveAiReady,
  activeNav = "Assignments",
}: AppShellProps) {
  const hosted = isHostedMode();
  const aiAvailability = hosted ? getAiAvailability() : null;
  return (
    <div className="app-shell-layout min-h-screen bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="app-shell-sidebar hidden min-h-screen flex-col bg-[var(--sidebar)] px-5 py-6 text-white lg:flex">
        <Link
          className="flex items-center gap-3 rounded-xl px-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--mint)]"
          href="/assignments"
        >
          <div className="grid size-11 grid-cols-2 gap-1 rounded-2xl bg-white/12 p-2 ring-1 ring-white/15">
            <span className="rounded-sm bg-[var(--mint)]" />
            <span className="rounded-sm bg-[var(--amber)]" />
            <span className="rounded-sm bg-[var(--coral)]" />
            <span className="rounded-sm bg-white/80" />
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.01em]">
              Misconception
            </p>
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--mint)]">
              Map
            </p>
          </div>
        </Link>

        <nav aria-label="Primary navigation" className="mt-12 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.key === activeNav;
            const className =
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)] " +
              (active
                ? "bg-white/12 font-medium text-white ring-1 ring-white/10"
                : "text-white/55 hover:bg-white/[0.07] hover:text-white/85");

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={className}
                href={item.href}
                key={item.label}
              >
                <Icon className="size-[18px]" />
                <span>{item.label}</span>
                {"protected" in item && item.protected ? (
                  <span className="ml-auto rounded-full bg-[var(--mint)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--mint)]">
                    Core
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <Link
          className="mt-auto rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10 transition hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)]"
          href="/status"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-white/80">
            <span
              className={
                "size-2 rounded-full " +
                (liveAiReady ? "bg-[var(--mint)]" : "bg-[var(--amber)]")
              }
            />
            {liveAiReady ? "Live AI ready" : "Local mode"}
          </div>
          <p className="mt-2 text-xs leading-5 text-white/50">
            {liveAiReady
              ? "GPT-5.6 is configured for live diagnosis and instructional support."
              : "Add an API key for live diagnosis and instructional support."}
          </p>
          <p className="mt-2 text-[10px] font-semibold text-[var(--mint)]/80">
            View system status →
          </p>
        </Link>
      </aside>

      <div className="app-shell-main min-w-0">
        <header className="app-shell-header flex h-16 items-center justify-between border-b border-black/[0.06] bg-white/75 px-5 backdrop-blur md:px-8 lg:px-10">
          <Link className="flex items-center gap-3 lg:hidden" href="/assignments">
            <div className="grid size-8 grid-cols-2 gap-0.5 rounded-lg bg-[var(--sidebar)] p-1.5">
              <span className="rounded-[2px] bg-[var(--mint)]" />
              <span className="rounded-[2px] bg-[var(--amber)]" />
              <span className="rounded-[2px] bg-[var(--coral)]" />
              <span className="rounded-[2px] bg-white/80" />
            </div>
            <span className="text-sm font-semibold">Misconception Map</span>
          </Link>
          <p className="hidden text-sm text-[var(--muted)] lg:block">
            Teacher diagnostic workspace
          </p>
          <div className="flex items-center gap-2">
            {activeNav !== "Assignments" ? (
              <Link
                className="hidden rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] sm:block lg:hidden"
                href="/assignments?new=1"
              >
                New assignment
              </Link>
            ) : null}
            <div className="rounded-full border border-[var(--sage)]/25 bg-[var(--sage)]/8 px-3 py-1.5 text-xs font-semibold text-[var(--sidebar)]">
              Build Week · Education
            </div>
          </div>
        </header>
        {hosted ? (
          <div className="hosted-demo-banner border-b border-[#d7aa55]/35 bg-[#fff5df] px-5 py-3 text-sm text-[#765725] md:px-8 lg:px-10" role="status">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <p>
                <strong>Shared demo instance</strong> — upload only synthetic or de-identified work. Provided sample fixtures below.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
                <a className="underline underline-offset-4" href="/api/fixtures/full-page-followup.jpeg">Download full-page fixture</a>
                <a className="underline underline-offset-4" href="/api/fixtures/negative-distribution.jpeg">Download single-answer fixture</a>
              </div>
            </div>
            {aiAvailability && !aiAvailability.available ? (
              <p className="mx-auto mt-2 max-w-7xl border-t border-[#d7aa55]/25 pt-2 font-semibold">
                {aiAvailability.message}
              </p>
            ) : null}
          </div>
        ) : null}
        <main>{children}</main>
      </div>
    </div>
  );
}
