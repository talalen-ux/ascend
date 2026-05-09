"use client";

import { motion } from "framer-motion";

const properties = [
  {
    title: "One LP, one chart",
    body:
      "ascend trades on a single Uniswap V4 pool whose only LP is the hook itself. buyers and sellers walk the same constant-product curve, so DexScreener prints normal green/red candles on a single price band. no admin, no governance, no upgrade path.",
  },
  {
    title: "Floor only goes up",
    body:
      "every swap pays a 1% fee — buys also pay a flat ~$2 surcharge. 70% of every fee is retained in the LP, growing the ETH side without minting any ascend. the LP's lower bound — vault per circulating ascend — is monotone non-decreasing forever. holders have a redemption guarantee that compounds with volume.",
  },
  {
    title: "Ascension Grid · the share",
    body:
      "30% of every swap fee funds a 12×12 cryptographic grid. once per 24h epoch, 68% of holders are selected at random — the chosen flip one tile and reveal a 1× to 4× multiplier on their share of the pool. the more volume, the bigger the prize. unclaimed tiles roll forward.",
  },
  {
    title: "Real liquidity",
    body:
      "the vault IS the LP. every wei of accumulated fee shows up as visible depth on Uniswap, DexScreener, and every aggregator. no off-pool routing, no honeypot heuristic flags, no two-band whipsaw. it looks normal because it is normal.",
  },
  {
    title: "No team, no presale",
    body:
      "122 million ascend, all minted into the LP at genesis. zero allocations. zero unlocks. the only path into circulation is to swap ETH for it through the V4 pool. the only path out is to swap ascend back. there is no other way.",
  },
  {
    title: "Verifiable forever",
    body:
      "the LP composition, the floor, the tile pool, every swap fee, every claim — all readable on-chain via standard V4 reads. anyone can compute the floor. anyone can claim a tile. anyone can audit the curve. nothing is off-chain.",
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
          Mechanism
        </p>
        <h2 className="mt-3 text-2xl font-medium leading-tight text-bone md:text-[36px]">
          a self-compounding asset with a share for everyone.
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed text-ash">
          ascend is a Uniswap V4 hook that owns its own pool. every swap
          deepens the floor. every swap fills a tile. holders aren't
          spectators — they have a deterministic, claimable share of the
          protocol's volume, on-chain, every day.
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
