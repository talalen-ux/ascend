"use client";

import { motion } from "framer-motion";
import { useSatoState } from "@/hooks/useSatoState";

const fmt = (n: number, d = 4) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

export function State() {
  const { cumulativeEth, priceEth, supply, isDemo, isLoading } = useSatoState();

  return (
    <section className="mt-12">
      <header className="mb-5 flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">State</h2>
        <div className="flex items-center gap-2 text-[11px] text-ash">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isLoading ? "bg-ash" : isDemo ? "bg-accent animate-pulse-soft" : "bg-emerald-400"
            }`}
          />
          {isLoading ? "loading" : isDemo ? "demo" : "live"}
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge md:grid-cols-4"
      >
        <Cell
          label="Price"
          value={priceEth < 1e-4 ? `${priceEth.toExponential(3)} Ξ` : `${fmt(priceEth, 6)} Ξ`}
          hint="ETH per sato"
        />
        <Cell label="Supply" value={fmt(supply, 0)} hint={`${((supply / 21_000_000) * 100).toFixed(2)}% of K`} />
        <Cell label="Cumulative ETH" value={`${fmt(cumulativeEth, 3)} Ξ`} hint="all-time inflow" />
        <Cell label="Asymptote" value="21,000,000" hint="never reached" />
      </motion.div>
    </section>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-canvas px-5 py-5">
      <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">{label}</div>
      <div className="mt-2 font-mono text-[18px] tabular text-bone">{value}</div>
      <div className="mt-1 font-mono text-[10px] text-ash">{hint}</div>
    </div>
  );
}
