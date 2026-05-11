"use client";

import { motion } from "framer-motion";

const properties = [
  {
    title: "Bonding curve, not LP",
    body:
      "ascend issues against a Sato-style exponential curve — q(e) = K·(1−e^(−e/S)) — through a Uniswap V4 hook. supply starts at 0; every mint creates new tokens, every burn destroys them. there is no LP position anyone owns or can withdraw — the hook is the issuer, the reserve is its balance.",
  },
  {
    title: "3% surplus on every mint",
    body:
      "of every mint deposit, 0.3% goes to the protocol fee and 3% goes to a dedicated `surplusReserve` that never advances the curve. the reserve grows faster than the curve obligation — every mint mechanically over-collateralizes the protocol on behalf of every existing holder.",
  },
  {
    title: "Block-age burn penalty",
    body:
      "burning within 10 blocks of your last mint pays 90% of the curve return. 10–100 blocks: 95%. 100–1000: 99%. 1000+ blocks: full payout. tracked per-holder via a weighted-average receive block, so routing tokens through a fresh wallet doesn't dodge it. flippers literally fund diamond hands.",
  },
  {
    title: "Reserve-aware bonus",
    body:
      "when surplus exceeds 10% of curve-owed reserves, every burn earns a bonus paid out of the buffer. ramps to a 5% maximum at 35% over-collateralization. accumulated panic-burn penalties subsidize the long-term holder's eventual exit — without governance, without a treasury vote.",
  },
  {
    title: "Tile rewards as buyback",
    body:
      "30% of every fee funds a 12×12 cryptographic grid. claim a tile and your reward isn't paid in ETH — it's auto-routed back through the curve as a fresh mint that lifts the price for everyone, then issued to you as ascend. tile rewards become protocol-backed buybacks.",
  },
  {
    title: "No team, no presale, no admin",
    body:
      "the hook is the only minter. the curve is the only price oracle. no allocation, no vesting, no pause, no upgrade. all the parameters — K, S, fees, penalty tiers, bonus formula — are constants, set at deploy. when we walk away, the contract keeps running on the same rules.",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

export function Mechanism() {
  return (
    <section id="mechanism" className="mt-16 space-y-10">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-2xl"
      >
        <p className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
          structural edge
        </p>
        <h2 className="mt-3 text-2xl font-medium leading-tight text-bone md:text-[36px]">
          impatient flippers fund the patient holders.
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed text-ash">
          ascend takes the Sato bonding curve and adds four upgrades that
          structurally bias the protocol toward long-term participation:
          mathematically symmetric forward/inverse curves, a 3% backing
          surplus on every mint, a continuous block-age burn penalty,
          and a reserve-aware bonus that pays diamond hands out of the
          accumulated penalty pool. zero admin, zero treasury, zero
          governance — just better math.
        </p>
      </motion.header>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-40px" }}
        className="grid gap-4 md:grid-cols-2"
      >
        {properties.map((p) => (
          <motion.div
            key={p.title}
            variants={cardVariants}
            whileHover={{ y: -3 }}
            transition={{ duration: 0.25 }}
            className="panel group relative overflow-hidden p-5 md:p-6"
          >
            {/* Gradient sheen that sweeps across on hover. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-accent/[0.06] to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
            {/* Top accent edge that fades in on hover. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-100"
            />
            <h3 className="relative text-[15px] font-medium text-bone">{p.title}</h3>
            <p className="relative mt-2 text-[13px] leading-relaxed text-ash">{p.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
