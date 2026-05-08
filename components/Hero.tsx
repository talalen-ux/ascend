"use client";

import { motion } from "framer-motion";
import { Mark } from "./Mark";

export function Hero() {
  return (
    <header className="relative mb-14 max-w-3xl">
      {/* Large grey-fade mark anchored to the right of the title block.
          Sits behind the text with low opacity + grayscale. Positioned
          absolute so it doesn't shift the heading. Hidden on small
          screens to avoid crowding. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.1 }}
        className="pointer-events-none absolute right-[-40px] top-[40px] hidden md:block"
        aria-hidden="true"
      >
        <Mark
          size={280}
          className="opacity-[0.06] grayscale"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative flex items-center gap-3"
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
        className="relative mt-5 text-4xl font-medium leading-[1.05] tracking-tight text-bone md:text-[64px]"
      >
        a self-compounding
        <br />
        <span className="text-accent">asset.</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="relative mt-6 max-w-xl text-[15px] leading-relaxed text-ash"
      >
        one Uniswap V4 pool. the hook is the only LP. every swap pays
        a 1% fee plus a flat $2 surcharge on buys — 70% deepens the
        floor for every remaining holder, 30% fills a 12×12 grid of
        claimable tiles. flip one tile per 24h epoch and reveal a 1×
        to 4× multiplier on your share of the pool. the floor only
        goes up.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        className="relative mt-7 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ash"
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
