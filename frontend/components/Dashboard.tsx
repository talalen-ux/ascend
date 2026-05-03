"use client";

import { motion } from "framer-motion";
import { useAscentState } from "@/hooks/useAscentState";
import { Stat } from "./Stat";

const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

export function Dashboard() {
  const { F, V, D, C, multiplier, treasury, isLoading, isDemo } = useAscentState();

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          System State
        </h2>
        <div className="flex items-center gap-2 text-[11px] text-ash">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isLoading ? "bg-ash" : isDemo ? "bg-accent animate-pulse-soft" : "bg-emerald-400"
            }`}
          />
          {isLoading ? "loading" : isDemo ? "demo" : "live"}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="grid grid-cols-2 gap-3 md:grid-cols-6"
      >
        <Stat
          label="Multiplier m"
          value={`× ${fmt(multiplier, 3)}`}
          hint="exp(α·tanh(z))"
          className="col-span-2 md:col-span-1"
          emphasis
        />
        <Stat label="Flow F" value={fmt(F)} hint="net buy ETH" />
        <Stat label="Velocity V" value={fmt(V)} hint="recent burst" />
        <Stat label="Depth D" value={fmt(D)} hint="slow integral" />
        <Stat label="Compress C" value={fmt(C)} hint="sell memory" />
        <Stat label="Treasury" value={`${fmt(treasury)} Ξ`} hint="bonus reserve" />
      </motion.div>
    </section>
  );
}
