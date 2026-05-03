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
          Market mood
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
          label="Demand premium"
          value={`× ${fmt(multiplier, 3)}`}
          hint="what buyers pay over fair price"
          className="col-span-2 md:col-span-1"
          emphasis
        />
        <Stat label="Net buying" value={fmt(F)} hint="cumulative inflow" />
        <Stat label="Recent rush" value={fmt(V)} hint="last few blocks" />
        <Stat label="Holder base" value={fmt(D)} hint="long-term conviction" />
        <Stat label="Sell pressure" value={fmt(C)} hint="cools the premium" />
        <Stat label="Holder reserve" value={`${fmt(treasury)} Ξ`} hint="paid out as sell bonuses" />
      </motion.div>
    </section>
  );
}
