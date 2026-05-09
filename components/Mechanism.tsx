"use client";

import { motion } from "framer-motion";

const properties = [
  {
    title: "a floor that compounds, not dilutes",
    body:
      "most crypto assets weaken over time through emissions, unlocks, and sell pressure. ascend compounds its structural base through participation itself — every swap permanently reinforces the underlying liquidity layer rather than borrowing against future supply.",
    kicker: "the system becomes stronger as it is used.",
  },
  {
    title: "permanent liquidity, not mercenary capital",
    body:
      "traditional protocols rent liquidity, and when incentives disappear it leaves. ascend replaces mercenary LP behavior with protocol-native liquidity architecture: the market is structurally retained within the system, removing dependency on external capital providers.",
    kicker: "liquidity becomes infrastructure.",
  },
  {
    title: "no emissions, no reflexive inflation spiral",
    body:
      "no inflationary rewards. no dilution-driven growth model. participation reinforces value instead of extracting it. ascend breaks the emissions cycle entirely — every unit of attention adds to the structural base instead of borrowing against it.",
    kicker: "value compounds on use, not issuance.",
  },
  {
    title: "a structural redemption layer",
    body:
      "most assets are valued almost entirely by narrative and speculation. ascend introduces an embedded structural floor tied to the protocol's underlying liquidity density — as participation compounds, the backing per circulating unit increases over time, creating intrinsic reinforcement.",
    kicker: "a fundamentally different risk profile.",
  },
  {
    title: "the Ascension Grid · a novel economic surface",
    body:
      "ascend does not separate speculation from participation. the Ascension Grid embeds a cryptographic interaction layer directly into the economic flow. each epoch is a probabilistic expansion mechanism synchronized with protocol activity, transforming participation into an active surface rather than passive holding.",
    kicker: "not farming. not staking. a native market mechanic.",
  },
  {
    title: "ethereum-native from first principles",
    body:
      "ascend is not a copied primitive. it could only exist through Uniswap V4 architecture and programmable hooks. rather than building another token around old market structures, ascend rearchitects the market itself: liquidity becomes autonomous, participation compounds the floor, economic activity reinforces the protocol rather than draining it.",
    kicker: "a new market structure category on ethereum.",
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
          why ascend is structurally superior.
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed text-ash">
          emissions tokens dilute. mercenary LPs leave when incentives stop.
          narrative-only assets have no floor. ascend rebuilds each of these
          primitives from first principles — six structural reasons the
          protocol gets stronger the more it is used.
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
            <p className="relative mt-3 font-mono text-[11px] uppercase tracking-widest2 text-accent">
              {p.kicker}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
