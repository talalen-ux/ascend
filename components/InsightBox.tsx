"use client";

import { useAscentState } from "@/hooks/useAscentState";

export function InsightBox() {
  const { multiplier, V, F } = useAscentState();
  const buyPenaltyPct = multiplier > 1 ? Math.max(0, (1 - 1 / multiplier) * 100) : 0;
  const sellBonusPct = multiplier > 1 ? Math.max(0, (multiplier - 1) * 100) : 0;
  const burst = V !== 0 ? Math.abs(V / Math.max(1, Math.abs(F))) : 0;

  const heat = burst > 1 ? "hot" : burst > 0.3 ? "warming" : "cool";

  return (
    <section className="panel p-6">
      <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
        Right now
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-bone/90">
        Buyers are paying about{" "}
        <span className="tabular text-accent">{buyPenaltyPct.toFixed(1)}%</span>{" "}
        more than fair price. Sellers are earning a bonus of up to{" "}
        <span className="tabular text-accent">{sellBonusPct.toFixed(1)}%</span>{" "}
        on top of fair price.
      </p>
      <div className="hairline my-4" />
      <p className="text-[11px] leading-relaxed text-ash">
        The market feels{" "}
        <span className="text-bone/80">{heat}</span>. Wait for the rush to
        cool and you buy at a discount. Sell into a rush and the holder
        reserve tops up your exit.
      </p>
    </section>
  );
}
