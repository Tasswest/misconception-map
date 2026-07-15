import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CheckIcon, AlertIcon } from "@/components/icons";
import { getSystemStatus } from "@/server/repositories/system-status";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  const status = getSystemStatus();
  return (
    <AppShell activeNav={null} liveAiReady={status.liveAiReady}>
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-8 lg:py-14">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
          Local setup
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
          System status
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Misconception Map runs locally. The API key is needed only for live AI actions; the seeded classroom works without it.
        </p>

        <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.07] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
          <StatusRow
            detail={status.databaseReady ? `Schema ${status.latestMigration ?? "ready"}` : "Run npm run db:migrate"}
            label="Local database"
            ready={status.databaseReady}
          />
          <StatusRow
            detail={`${status.misconceptionCount} of ${status.codeMisconceptionCount} taxonomy terms · v${status.taxonomyVersion}`}
            label="Taxonomy"
            ready={status.misconceptionCount === status.codeMisconceptionCount}
          />
          <StatusRow
            detail={status.liveAiReady ? `${status.model} is configured` : "OPENAI_API_KEY is not configured"}
            label="Live diagnosis"
            ready={status.liveAiReady}
            warning={!status.liveAiReady}
          />
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white" href="/">
            Return to Overview
          </Link>
          <Link className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold" href="/diagnose">
            Open diagnostic setup
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function StatusRow({
  label,
  detail,
  ready,
  warning = false,
}: {
  label: string;
  detail: string;
  ready: boolean;
  warning?: boolean;
}) {
  const Icon = ready ? CheckIcon : AlertIcon;
  return (
    <div className="flex items-start gap-3 border-b border-black/[0.06] p-5 last:border-b-0">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${ready ? "bg-[var(--soft-mint)] text-[var(--sage)]" : warning ? "bg-[var(--amber)]/15 text-[#8a642a]" : "bg-[var(--soft-coral)] text-[#9c4937]"}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
      </div>
    </div>
  );
}
