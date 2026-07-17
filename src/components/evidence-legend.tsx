const items = [
  { color: "bg-[var(--mint)]", label: "Correct reasoning shown" },
  { color: "bg-[var(--amber)]", label: "Seen once" },
  { color: "bg-[var(--coral)]", label: "Seen repeatedly" },
  { color: "bg-[var(--line)]", label: "Not assessed" },
];

export function EvidenceLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-3 text-[11px] font-medium text-[var(--muted)] ${className}`}>
      {items.map((item) => (
        <span className="flex items-center gap-1.5" key={item.label}>
          <span className={`size-2.5 rounded-full ring-1 ring-black/10 ${item.color}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
