"use client";

import { motion } from "framer-motion";
import { Mark } from "./Mark";

export function Hero() {
  return (
    <header className="mb-14 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center gap-3"
      >
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-accent/15 blur-md animate-breathe" />
          <Mark size={28} className="relative" />
        </div>
        <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          ascend · a new ethereum-native asset class
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.05 }}
        className="mt-5 text-4xl font-medium leading-[1.05] tracking-tight text-bone md:text-[64px]"
      >
        a self-compounding
        <br />
        <span className="text-accent">asset.</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="mt-6 max-w-xl text-[15px] leading-relaxed text-ash"
      >
        one Uniswap V4 pool. the hook is the only LP. every swap pays
        5% — 4% deepens the floor for every remaining holder, 1% fills
        a 12×12 grid of claimable tiles. flip one tile per 24h epoch
        and reveal a 1× to 4× multiplier on your share of the pool.
        the floor only goes up.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ash"
      >
        <span>122M cap</span>
        <span className="opacity-30">|</span>
        <span>LP-backed floor</span>
        <span className="opacity-30">|</span>
        <span>tile rewards from volume</span>
        <span className="opacity-30">|</span>
        <span>no admin · no team · no presale</span>
      </motion.div>
    </header>
  );
}
