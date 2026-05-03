"use client";

import { motion } from "framer-motion";
import { useAscentState } from "@/hooks/useAscentState";
import { Stat } from "./Stat";

const fmt = (n: number, d = 4) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

export function Dashboard() {
  const { F, D, C, multiplier, treasury, isLoading } = useAscentState();

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-[0.22em] text-ash">System State</h2>
        <span className="text-xs text-ash">{isLoading ? "loading…" : "live"}</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        <Stat
          label="Multiplier m(E)"
          value={<span className="text-ember">×{fmt(multiplier, 3)}</span>}
          hint="distortion vs raw curve"
          className="col-span-2 md:col-span-1"
        />
        <Stat label="Flow F" value={fmt(F, 2)} hint="net buy ETH (decaying)" />
        <Stat label="Depth D" value={fmt(D, 2)} hint="slow integral" />
        <Stat label="Compression C" value={fmt(C, 2)} hint="sell memory" />
        <Stat label="Treasury" value={`${fmt(treasury, 2)} ETH`} hint="sell-side reserves" />
      </motion.div>
    </section>
  );
}
