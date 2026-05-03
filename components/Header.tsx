"use client";

import { motion } from "framer-motion";

export function Header() {
  return (
    <header className="relative mb-12 flex items-end justify-between">
      <div>
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-3"
        >
          <Mark />
          <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Ascent · A store of value with memory
          </span>
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-3 max-w-xl text-3xl font-medium leading-[1.1] tracking-tight text-bone md:text-[40px]"
        >
          The market that
          <span className="text-accent"> rewards patience</span>.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-3 max-w-md text-[13px] leading-relaxed text-ash"
        >
          Ascent is a store of value with one rule: the more people chase it,
          the more it costs to chase. The longer you hold, the more the
          market pays you when you sell.
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="hidden text-right md:block"
      >
        <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          The deal
        </div>
        <div className="mt-2 text-[12px] text-bone/80">
          Buyers pay a premium during hype.
        </div>
        <div className="mt-1 text-[12px] text-bone/80">
          Sellers earn a bonus when hype cools.
        </div>
        <div className="mt-1 text-[11px] text-ash">
          Same pool. Same token. Different timing.
        </div>
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
        <path
          d="M4 16 L10 9 L14 13 L20 5"
          stroke="#f4a261"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
