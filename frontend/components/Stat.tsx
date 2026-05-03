import clsx from "clsx";

export function Stat({
  label,
  value,
  hint,
  className,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={clsx(
        "panel px-5 py-4 transition-colors",
        emphasis && "ring-1 ring-accent/20",
        className,
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
        {label}
      </div>
      <div
        className={clsx(
          "tabular mt-2 font-mono text-[22px] leading-none",
          emphasis ? "text-accent" : "text-bone",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-2 text-[11px] text-ash/80">{hint}</div>}
    </div>
  );
}
