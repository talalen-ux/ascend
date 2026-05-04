"use client";

import { motion } from "framer-motion";

export function Hero() {
  return (
    <header className="mb-14 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center gap-3"
      >
        <Mark />
        <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          sato · ethereum · genesis-deterministic
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.05 }}
        className="mt-5 text-4xl font-medium leading-[1.05] tracking-tight text-bone md:text-[64px]"
      >
        the contract that priced the first buy
        <br />
        will price <span className="text-accent">every buy</span> after it.
        <br />
        <span className="text-ash">forever.</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="mt-6 max-w-xl text-[14px] leading-relaxed text-ash"
      >
        sato is an erc-20 issued from a single bonding-curve contract. there is
        no team wallet, no liquidity provider position, no migration path. price
        is a function of cumulative ether ever paid in. supply asymptotes at
        21,000,000 and never quite reaches it. read the manifesto below.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        className="mt-7 flex items-center gap-4 text-[11px] font-mono text-ash"
      >
        <span>p(E) = (S/K) · e^(E/S)</span>
        <span className="opacity-30">|</span>
        <span>S = 500 Ξ</span>
        <span className="opacity-30">|</span>
        <span>K = 21,000,000</span>
        <span className="opacity-30">|</span>
        <span>fee = 0.3%</span>
      </motion.div>
    </header>
  );
}

function Mark() {
  return (
    <div className="relative h-7 w-7">
      <div className="absolute inset-0 rounded-full bg-accent/20 animate-breathe" />
      <svg viewBox="0 0 24 24" className="relative h-7 w-7">
        <circle cx="12" cy="12" r="10" stroke="#f4a261" strokeWidth="1" fill="none" />
        {/* exponential curve glyph */}
        <path
          d="M4 18 Q 12 18 12 12 Q 12 6 20 6"
          stroke="#f4a261"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
