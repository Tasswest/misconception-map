export default function DiagnoseSetupLoading() {
  return (
    <div className="min-h-screen bg-[var(--canvas)] px-5 py-10 md:px-8 lg:px-10">
      <div className="mx-auto max-w-[1240px] animate-pulse">
        <div className="h-7 w-36 rounded-full bg-[var(--line)]" />
        <div className="mt-6 h-12 max-w-2xl rounded-2xl bg-[var(--line)]" />
        <div className="mt-3 h-6 max-w-xl rounded-xl bg-[var(--line)]" />
        <div className="mt-8 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-5">
            <div className="h-72 rounded-[24px] bg-white/70" />
            <div className="h-72 rounded-[24px] bg-white/70" />
          </div>
          <div className="h-[620px] rounded-[24px] bg-white/70" />
        </div>
      </div>
    </div>
  );
}
