export default function AssignmentDiagnoseLoading() {
  return (
    <div className="min-h-screen bg-[var(--canvas)] px-5 py-8 md:px-8 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-[1440px] animate-pulse">
        <div className="h-4 w-48 rounded bg-[var(--line)]" />
        <div className="mt-5 h-11 max-w-xl rounded-xl bg-[var(--line)]" />
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-[650px] rounded-[24px] bg-white/70" />
          <div className="h-[480px] rounded-[24px] bg-white/70" />
        </div>
      </div>
    </div>
  );
}
