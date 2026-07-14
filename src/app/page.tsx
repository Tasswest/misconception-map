import { AppShell } from "@/components/app-shell";
import { ArrowIcon, CheckIcon, SparkIcon } from "@/components/icons";
import { isOpenAIConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

const heatmap = [
  ["hot", "warm", "clear", "clear", "empty"],
  ["hot", "hot", "clear", "empty", "clear"],
  ["warm", "hot", "clear", "clear", "clear"],
  ["hot", "warm", "empty", "clear", "clear"],
  ["warm", "clear", "clear", "warm", "empty"],
];

const cellClass = {
  hot: "bg-[var(--coral)]",
  warm: "bg-[var(--amber)]",
  clear: "bg-[var(--mint)]",
  empty: "bg-[var(--line)]",
};

export default function Home() {
  const liveAiReady = isOpenAIConfigured();

  return (
    <AppShell liveAiReady={liveAiReady}>
      <div className="mx-auto max-w-[1440px] px-5 py-8 md:px-8 lg:px-10 lg:py-10">
        <section className="grid overflow-hidden rounded-[28px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_24px_70px_rgba(35,51,46,0.08)] lg:grid-cols-[1.18fr_0.82fr]">
          <div className="p-7 md:p-10 lg:p-14">
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--soft-mint)] px-3 py-1.5 text-xs font-semibold text-[var(--sidebar)]">
              <SparkIcon className="size-3.5" />
              From wrong answer to testable insight
            </div>
            <h1 className="mt-7 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-[var(--ink)] md:text-6xl">
              See the reasoning behind every wrong answer.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-base leading-7 text-[var(--muted)] md:text-lg md:leading-8">
              Diagnose recurring algebra and fraction strategies, test a student
              model on unseen problems, and turn the evidence into tomorrow&apos;s
              instruction.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244b42]"
                href="/diagnose"
              >
                Diagnose student work
                <ArrowIcon className="size-4" />
              </a>
              <a
                className="inline-flex items-center justify-center rounded-xl border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--canvas)]"
                href="/api/health"
              >
                Check local setup
              </a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-[var(--muted)]">
              <CheckIcon className="size-4 text-[var(--sage)]" />
              Synthetic demo data stays local; live analysis is always explicit.
            </p>
          </div>

          <div className="relative min-h-[420px] overflow-hidden bg-[var(--preview)] p-7 md:p-10 lg:min-h-full">
            <div className="absolute -right-24 -top-24 size-72 rounded-full bg-[var(--mint)]/20 blur-3xl" />
            <div className="relative mx-auto max-w-md rounded-[24px] border border-white/70 bg-white/92 p-5 shadow-[0_24px_60px_rgba(23,52,45,0.14)] backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sage)]">
                    Class signal
                  </p>
                  <p className="mt-1 text-lg font-semibold tracking-[-0.02em]">
                    Distribution checkpoint
                  </p>
                </div>
                <span className="rounded-full bg-[var(--soft-coral)] px-2.5 py-1 text-xs font-semibold text-[#a94b35]">
                  8 students
                </span>
              </div>
              <div
                aria-label="Illustrative misconception heatmap preview"
                className="mt-6 grid grid-cols-5 gap-2"
                role="img"
              >
                {heatmap.flatMap((row, rowIndex) =>
                  row.map((cell, columnIndex) => (
                    <span
                      className={
                        "aspect-square rounded-lg " +
                        cellClass[cell as keyof typeof cellClass]
                      }
                      key={rowIndex + "-" + columnIndex}
                    />
                  )),
                )}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-black/[0.06] pt-4 text-[11px] font-medium text-[var(--muted)] sm:grid-cols-4">
                <Legend color="bg-[var(--mint)]" label="Correct" />
                <Legend color="bg-[var(--amber)]" label="Emerging" />
                <Legend color="bg-[var(--coral)]" label="Strong" />
                <Legend color="bg-[var(--line)]" label="Not assessed" />
              </div>
            </div>

            <div
              className="relative ml-auto mt-5 max-w-[300px] rounded-2xl bg-[var(--sidebar)] p-4 text-white shadow-xl"
              id="prediction-lab"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--mint)]">
                <SparkIcon className="size-4" /> Prediction Lab
              </div>
              <p className="mt-2 text-sm leading-6 text-white/80">
                “Applies the negative sign to the first term only.”
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/10 p-2.5">
                  <p className="text-white/45">Predicted</p>
                  <p className="mt-1 font-semibold">−3x + 5</p>
                </div>
                <div className="rounded-lg bg-[var(--mint)]/15 p-2.5">
                  <p className="text-[var(--mint)]/70">Actual</p>
                  <p className="mt-1 font-semibold text-[var(--mint)]">Pending</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <StatusCard
            eyebrow="Storage"
            message="Classes and student evidence stay in a local SQLite file."
            title="Local by default"
          />
          <StatusCard
            eyebrow="Live analysis"
            message={
              liveAiReady
                ? "Your server can use GPT-5.6 when you explicitly diagnose work."
                : "Add OPENAI_API_KEY to .env.local when you want live diagnosis."
            }
            title={liveAiReady ? "GPT-5.6 ready" : "API key not set"}
            tone={liveAiReady ? "green" : "amber"}
          />
          <StatusCard
            eyebrow="Scope"
            message="Depth on recurring algebra and fraction strategies, not generic grading."
            title="Middle school focus"
          />
        </section>

        <section
          className="mt-6 rounded-[24px] border border-dashed border-[var(--sage)]/30 bg-white/65 p-7 md:flex md:items-center md:justify-between md:p-9"
          id="workspace"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sage)]">
              Workspace ready
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
              Start with one class and one diagnostic question.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Problem context anchors every diagnosis. Student Models become
              supported only when a strategy repeats across varied work.
            </p>
          </div>
          <div className="mt-5 flex items-center gap-3 md:mt-0">
            <div className="flex -space-x-2">
              {["AM", "JL", "SK"].map((initials, index) => (
                <span
                  className="grid size-9 place-items-center rounded-full border-2 border-white bg-[var(--soft-mint)] text-[10px] font-bold text-[var(--sidebar)]"
                  key={initials}
                  style={{ zIndex: 3 - index }}
                >
                  {initials}
                </span>
              ))}
            </div>
            <span className="text-xs font-medium text-[var(--muted)]">
              Synthetic students only
            </span>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

type StatusCardProps = {
  eyebrow: string;
  title: string;
  message: string;
  tone?: "green" | "amber";
};

function StatusCard({
  eyebrow,
  title,
  message,
  tone = "green",
}: StatusCardProps) {
  return (
    <article className="rounded-2xl border border-black/[0.06] bg-white/80 p-5">
      <div className="flex items-center gap-2">
        <span
          className={
            "size-2 rounded-full " +
            (tone === "green" ? "bg-[var(--sage)]" : "bg-[var(--amber)]")
          }
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          {eyebrow}
        </p>
      </div>
      <h2 className="mt-3 text-lg font-semibold tracking-[-0.02em]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{message}</p>
    </article>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={"size-2 rounded-full " + color} />
      {label}
    </span>
  );
}
