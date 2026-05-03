import clsx from "clsx";

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-lg border border-edge bg-panel/60 px-5 py-4", className)}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-ash">{label}</div>
      <div className="mt-2 font-mono text-2xl text-bone">{value}</div>
      {hint && <div className="mt-1 text-xs text-ash">{hint}</div>}
    </div>
  );
}
