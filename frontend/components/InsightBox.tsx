"use client";

import { useAscentState } from "@/hooks/useAscentState";

export function InsightBox() {
  const { multiplier } = useAscentState();
  const penaltyPct = multiplier > 0 ? Math.max(0, (1 - 1 / multiplier) * 100) : 0;

  return (
    <section className="rounded-2xl border border-ember/40 bg-ember/5 p-6">
      <h2 className="text-xs uppercase tracking-[0.22em] text-ember">Insight</h2>
      <p className="mt-3 text-sm leading-relaxed text-bone">
        Buying now costs roughly{" "}
        <span className="font-mono text-ember">{penaltyPct.toFixed(1)}%</span> more than
        a memoryless AMM would charge. The system remembers prior demand and
        compresses the curve against late entrants.
      </p>
      <p className="mt-2 text-xs text-ash">
        Pressure decays per block. Patience reduces your effective price.
      </p>
    </section>
  );
}
