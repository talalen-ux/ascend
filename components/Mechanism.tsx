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
    title: "Tiles · the share",
    body:
      "30% of every swap fee funds a 12×12 grid of claimable tiles. once per 24h epoch, holders flip one tile and reveal a 1× to 4× multiplier on their share of the pool. the more volume, the bigger the prize. unclaimed tiles roll forward.",
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

export function Mechanism() {
  return (
    <section id="mechanism" className="mt-16 space-y-10">
      <header className="max-w-2xl">
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
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {properties.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.04 }}
            className="panel p-6"
          >
            <h3 className="text-[15px] font-medium text-bone">{p.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ash">{p.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
