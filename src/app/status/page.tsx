import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CheckIcon, AlertIcon } from "@/components/icons";
import { getSystemStatus } from "@/server/repositories/system-status";
import { isHostedMode } from "@/lib/hosted-access";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  const status = getSystemStatus();
  const hosted = isHostedMode();
  return (
    <AppShell activeNav={null} liveAiReady={status.liveAiReady}>
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-8 lg:py-14">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
          {hosted ? "Hosted demo" : "Local setup"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
          System status
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {hosted
            ? "The shared instance keeps its SQLite database and de-identified uploads on a persistent volume. Seeded views never spend tokens."
            : "Misconception Map runs locally. The API key is needed only for live AI actions; the seeded classroom works without it."}
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
            detail={status.liveAiReady ? `${status.model} is configured` : status.aiAvailability.message ?? "Live AI is unavailable"}
            label="Live diagnosis"
            ready={status.liveAiReady}
            warning={!status.liveAiReady}
          />
          {hosted && status.aiAvailability.spend && status.aiAvailability.dailyBudgetUsd !== null ? (
            <StatusRow
              detail={`$${status.aiAvailability.spend.estimatedUsd.toFixed(3)} estimated today · $${status.aiAvailability.dailyBudgetUsd.toFixed(2)} daily cap · resets at midnight UTC`}
              label="Daily demo budget"
              ready={status.aiAvailability.available}
              warning={!status.aiAvailability.available}
            />
          ) : null}
        </section>

        <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.07] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
          <div className="border-b border-black/[0.06] px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">AI run ledger</p>
            <h2 className="mt-1 text-lg font-semibold">Tokens per saved run</h2>
          </div>
          {status.recentRuns.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-[var(--canvas)] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Run</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Input</th>
                    <th className="px-4 py-3 font-semibold">Output</th>
                    <th className="px-4 py-3 font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">Latency</th>
                    <th className="px-4 py-3 font-semibold">Saved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {status.recentRuns.map((run, index) => (
                    <tr key={`${run.createdAt}-${run.purpose}-${index}`}>
                      <td className="px-4 py-3"><span className="font-semibold">{run.purpose.replaceAll("_", " ").toLowerCase()}</span><span className="mt-0.5 block text-[10px] text-[var(--muted)]">{run.model}{run.cacheHit ? " · cache hit" : ""}</span></td>
                      <td className="px-4 py-3">
                        {run.status.toLowerCase()}
                        {run.errorCode ? (
                          <span className="mt-0.5 block max-w-64 text-[10px] leading-4 text-[#8e402d]">
                            {run.errorCode}
                            {run.pageCount ? ` · ${run.pageCount} pages` : ""}
                            {run.errorMessage ? ` — ${run.errorMessage}` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono">{tokenLabel(run.inputTokens)}</td>
                      <td className="px-4 py-3 font-mono">{tokenLabel(run.outputTokens)}</td>
                      <td className="px-4 py-3 font-mono font-semibold">{tokenLabel(run.totalTokens)}</td>
                      <td className="px-4 py-3">{run.latencyMs === null ? "—" : `${run.latencyMs} ms`}</td>
                      <td className="px-4 py-3">{formatRunDate(run.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No live AI run has been saved yet. Seeded views do not spend tokens.</p>
          )}
        </section>

        <div className="mt-6">
          <Link className="rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white" href="/assignments">
            Return to Assignments
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function tokenLabel(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("en").format(value);
}

function formatRunDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
