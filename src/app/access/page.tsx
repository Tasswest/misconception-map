import { redirect } from "next/navigation";

import { AccessGateForm } from "./access-gate-form";
import { isHostedMode } from "@/lib/hosted-access";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/";
}

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (!isHostedMode()) redirect("/");
  const parameters = await searchParams;
  const configured = Boolean(process.env.JUDGE_ACCESS_CODE?.trim());

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-12 text-[var(--ink)]">
      <section className="w-full max-w-md rounded-[28px] border border-black/[0.07] bg-[var(--paper)] p-7 shadow-[0_24px_70px_rgba(35,51,46,0.10)] sm:p-9">
        <div className="grid size-12 grid-cols-2 gap-1 rounded-2xl bg-[var(--sidebar)] p-2.5">
          <span className="rounded-sm bg-[var(--mint)]" />
          <span className="rounded-sm bg-[var(--amber)]" />
          <span className="rounded-sm bg-[var(--coral)]" />
          <span className="rounded-sm bg-white/80" />
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-[var(--sage)]">
          Shared judge demo
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
          Enter the access code
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          One shared code protects the seeded classroom and live GPT‑5.6 correction. No account is created.
        </p>
        {configured ? (
          <AccessGateForm nextPath={safeNextPath(parameters.next)} />
        ) : (
          <p className="mt-6 rounded-xl bg-[var(--soft-coral)] px-4 py-3 text-sm leading-6 text-[#8c4132]" role="alert">
            This deployment is missing JUDGE_ACCESS_CODE. The operator must add it before the demo can open.
          </p>
        )}
      </section>
    </main>
  );
}
