"use client";

import { useAscentState } from "@/hooks/useAscentState";

export function InsightBox() {
  const { multiplier, V, F } = useAscentState();
  const buyPenaltyPct = multiplier > 1 ? Math.max(0, (1 - 1 / multiplier) * 100) : 0;
  const sellBonusPct = multiplier > 1 ? Math.max(0, (multiplier - 1) * 100) : 0;
  const burst = V !== 0 ? Math.abs(V / Math.max(1, Math.abs(F))) : 0;

  return (
    <section className="panel p-6">
      <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
        Insight
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-bone/90">
        Buying now costs roughly{" "}
        <span className="tabular text-accent">{buyPenaltyPct.toFixed(1)}%</span> more
        than a memoryless AMM. Sellers receive up to{" "}
        <span className="tabular text-accent">{sellBonusPct.toFixed(1)}%</span> bonus
        from the treasury.
      </p>
      <div className="hairline my-4" />
      <p className="text-[11px] leading-relaxed text-ash">
        Burst ratio V/F ≈{" "}
        <span className="tabular text-bone/80">{burst.toFixed(2)}</span>. High burst
        means recent buying amplifies the multiplier. Patience reduces your
        effective price.
      </p>
    </section>
  );
}
