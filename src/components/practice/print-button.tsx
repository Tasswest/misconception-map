"use client";

export function PrintButton({
  label = "Print worksheet + key",
}: {
  label?: string;
}) {
  return (
    <button
      className="inline-flex items-center justify-center rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#244b42]"
      onClick={() => window.print()}
      type="button"
    >
      {label}
    </button>
  );
}
