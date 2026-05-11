"use client";

import { motion } from "framer-motion";
import { useAscendState } from "@/hooks/useAscendState";
import { useEthPrice } from "@/hooks/useEthPrice";
import { livePerTokenBurnAt } from "@/lib/floor_v3";
import { fmtUsd, fmtEthShort } from "@/lib/fmtUsd";

const fmt = (n: number, d = 4) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};

const cellVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

export function State() {
  const state = useAscendState();
  const ethUsd = useEthPrice();
  const {
    floorEth,
    priceEth,
    marketCapEth,
    fdvEth,
    reserveEth,
    circulating,
    ethCum,
    isDemo,
    isLoading,
  } = state;

  const liveBurnEth = livePerTokenBurnAt(state);

  return (
    <section className="mt-10">
      <header className="mb-5 flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">Vitals</h2>
        <div className="flex items-center gap-2 text-[11px] text-ash">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isLoading ? "bg-ash" : isDemo ? "bg-accent animate-pulse-soft" : "bg-emerald-400"
            }`}
          />
          {isLoading ? "loading" : isDemo ? "demo" : "on-chain"}
        </div>
      </header>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-30px" }}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge md:grid-cols-4"
      >
        <Cell
          label="Mint price"
          value={fmtUsd(priceEth, ethUsd)}
          sub={fmtEthShort(priceEth)}
          hint="marginal cost on the bonding curve"
          emphasis
        />
        <Cell
          label="Live burn"
          value={fmtUsd(liveBurnEth, ethUsd)}
          sub={fmtEthShort(liveBurnEth)}
          hint="payout per ascend, tier-1, after fees"
        />
        <Cell
          label="Floor (mono)"
          value={fmtUsd(floorEth, ethUsd)}
          sub={fmtEthShort(floorEth)}
          hint="lifetime min if held — conceptual"
        />
        <Cell
          label="Reserve"
          value={fmtUsd(reserveEth, ethUsd)}
          sub={fmtEthShort(reserveEth)}
          hint="ETH the protocol actually holds"
        />
        <Cell
          label="Circulating"
          value={fmt(circulating, 2)}
          hint="ascend currently in wallets"
        />
        <Cell
          label="ETH in"
          value={fmtUsd(ethCum, ethUsd)}
          sub={fmtEthShort(ethCum)}
          hint="cumulative deposits routed to curve"
        />
        <Cell
          label="Market cap"
          value={fmtUsd(marketCapEth, ethUsd)}
          sub={fmtEthShort(marketCapEth)}
          hint="price × circulating · notional"
        />
        <Cell
          label="FDV"
          value={fmtUsd(fdvEth, ethUsd)}
          sub={fmtEthShort(fdvEth)}
          hint="price × 21m cap · notional"
        />
      </motion.div>
    </section>
  );
}

function Cell({
  label,
  value,
  sub,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <motion.div
      variants={cellVariants}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="group relative bg-canvas px-4 py-4 transition-colors hover:bg-canvas/60 md:px-5 md:py-5"
    >
      {/* Subtle accent edge that fades in on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-100"
      />
      <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">{label}</div>
      <div
        className={`mt-2 font-mono tabular transition-colors ${
          emphasis ? "text-[19px] md:text-[22px] text-accent" : "text-[16px] md:text-[18px] text-bone"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 font-mono text-[10px] text-ash/70 tabular">{sub}</div>
      )}
      <div className="mt-1 font-mono text-[10px] text-ash">{hint}</div>
    </motion.div>
  );
}
