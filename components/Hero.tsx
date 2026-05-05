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
        ascend is mined into existence by ETH. every wei paid in deepens
        the vault that backs the asset. the floor — the price every holder
        can always redeem at — is the vault divided by the issued supply.
        the contract was born deterministic and runs against the same rules
        every block after.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ash"
      >
        <span>vault-backed</span>
        <span className="opacity-30">|</span>
        <span>monotone floor</span>
        <span className="opacity-30">|</span>
        <span>own counterparty</span>
        <span className="opacity-30">|</span>
        <span>no admin · no upgrade · no migration</span>
      </motion.div>
    </header>
  );
}

function Mark() {
  return (
    <div className="relative h-7 w-7">
      <div className="absolute inset-0 rounded-full bg-accent/20 animate-breathe" />
      <svg viewBox="0 0 24 24" className="relative h-7 w-7">
        <circle cx="12" cy="12" r="10" stroke="#c5ee47" strokeWidth="1" fill="none" />
        {/* upward staircase */}
        <path
          d="M5 18 L9 18 L9 14 L13 14 L13 10 L17 10 L17 6 L19 6"
          stroke="#c5ee47"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
