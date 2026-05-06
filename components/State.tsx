"use client";

import { motion } from "framer-motion";
import { useAscendState } from "@/hooks/useAscendState";

const fmt = (n: number, d = 4) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

const fmtPrice = (n: number) =>
  n < 1e-4 ? n.toExponential(3) : fmt(n, 8);

export function State() {
  const {
    floorEth,
    priceEth,
    marketCapEth,
    premiumPct,
    reserveEth,
    supply,
    isDemo,
    isLoading,
  } = useAscendState();

  return (
    <section className="mt-10">
      <header className="mb-5 flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">Vitals</h2>
        <div className="flex items-center gap-2 text-[11px] text-ash">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isLoading ? "bg-ash" : isDemo ? "bg-accent animate-pulse-soft" : "bg-emerald-400"
            }`}
          />
          {isLoading ? "loading" : isDemo ? "demo" : "on-chain"}
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge md:grid-cols-3"
      >
        <Cell
          label="Price"
          value={`${fmtPrice(priceEth)} Ξ`}
          hint={`mining cost · ${premiumPct.toFixed(0)}% premium over floor`}
          emphasis
        />
        <Cell
          label="Floor"
          value={`${fmtPrice(floorEth)} Ξ`}
          hint="redemption value · vault / supply"
        />
        <Cell
          label="Market cap"
          value={`${fmt(marketCapEth, 3)} Ξ`}
          hint="price × issued"
        />
        <Cell label="Vault" value={`${fmt(reserveEth, 4)} Ξ`} hint="ETH backing the floor" />
        <Cell label="Issued" value={fmt(supply, 2)} hint="ascend mined into existence" />
        <Cell
          label="Premium"
          value={`+${premiumPct.toFixed(0)}%`}
          hint="paid by miners, kept by holders"
        />
      </motion.div>
    </section>
  );
}

function Cell({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-canvas px-5 py-5">
      <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">{label}</div>
      <div
        className={`mt-2 font-mono tabular ${
          emphasis ? "text-[22px] text-accent" : "text-[18px] text-bone"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] text-ash">{hint}</div>
    </div>
  );
}
