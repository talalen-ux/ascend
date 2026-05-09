"use client";

import { motion } from "framer-motion";
import { Mark } from "./Mark";

export function Hero() {
  return (
    <header className="relative mb-14 max-w-3xl">
      {/* Large grey-fade mark behind the title block. Floats subtly to
          add motion without distracting from the copy. Positioned to
          bleed off the right edge of the content area. Hidden on
          small screens to avoid crowding. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.88 }}
        animate={{
          opacity: 1,
          scale: 1,
          y: [0, -10, 0],
        }}
        transition={{
          opacity: { duration: 1.1, delay: 0.1 },
          scale: { duration: 1.1, delay: 0.1 },
          y: {
            duration: 9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.6,
          },
        }}
        className="pointer-events-none absolute right-[-180px] top-[-60px] hidden md:block"
        aria-hidden="true"
      >
        <Mark size={560} className="opacity-[0.08] grayscale" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative flex items-center gap-3"
      >
        <div className="relative">
          <motion.div
            className="absolute inset-0 rounded-full bg-accent/15 blur-md"
            animate={{ scale: [1, 1.25, 1], opacity: [0.45, 0.85, 0.45] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <Mark size={28} className="relative" />
        </div>
        <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          ascend · a singular market structure mining protocol
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="relative mt-5 text-4xl font-medium leading-[1.04] tracking-tight text-bone md:text-[64px]"
      >
        the floor only{" "}
        <span className="bg-gradient-to-r from-accent via-bone to-accent bg-[length:200%_100%] bg-clip-text text-transparent animate-shine">
          ascends.
        </span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="relative mt-6 max-w-xl text-[15px] leading-relaxed text-ash"
      >
        ascend is a singular market structure mining protocol on
        ethereum, where users mint ascend into existence.{" "}
        <span className="text-bone">ASCEND</span> transforms market
        activity into permanent structural reinforcement.
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.22 }}
        className="relative mt-3 max-w-xl text-[15px] leading-relaxed text-ash"
      >
        Alongside the core engine exists the{" "}
        <span className="text-accent">Ascension Grid</span>: a
        cryptographic surface embedded directly into the protocol's
        economic flow. The floor only ascends.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 0.32 }}
        className="relative mt-7 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ash"
      >
        <span>122M cap</span>
        <span className="opacity-30">|</span>
        <span>LP-backed floor</span>
        <span className="opacity-30">|</span>
        <span>Ascension Grid rewards</span>
        <span className="opacity-30">|</span>
        <span>no admin · no team · no presale</span>
      </motion.div>
    </header>
  );
}
