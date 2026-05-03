"use client";

import { useAscentState } from "@/hooks/useAscentState";

export function InsightBox() {
  const { multiplier, V, F } = useAscentState();
  const buyPenaltyPct = multiplier > 1 ? Math.max(0, (1 - 1 / multiplier) * 100) : 0;
  const sellBonusPct = multiplier > 1 ? Math.max(0, (multiplier - 1) * 100) : 0;
  const burst = V !== 0 ? Math.abs(V / Math.max(1, Math.abs(F))) : 0;

  return (
    <section className="rounded-2xl border border-ember/40 bg-ember/5 p-6">
      <h2 className="text-xs uppercase tracking-[0.22em] text-ember">Insight</h2>
      <p className="mt-3 text-sm leading-relaxed text-bone">
        Buying now costs roughly{" "}
        <span className="font-mono text-ember">{buyPenaltyPct.toFixed(1)}%</span> more
        than a memoryless AMM. Sellers receive up to{" "}
        <span className="font-mono text-ember">{sellBonusPct.toFixed(1)}%</span> bonus
        from the treasury.
      </p>
      <p className="mt-2 text-xs text-ash">
        Burst ratio V/F ≈{" "}
        <span className="font-mono">{burst.toFixed(2)}</span>. High burst → recent buying
        amplifies the multiplier; let it cool to enter cheaply.
      </p>
    </section>
  );
}
