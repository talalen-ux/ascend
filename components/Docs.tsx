"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

export function Docs() {
  return (
    <section id="docs" className="mt-20 space-y-10">
      <header className="flex items-baseline justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          Docs
        </h2>
        <span className="text-[11px] text-ash">How Ascent works, in plain words</span>
      </header>

      <Pitch />

      <Pillars />

      <HowItWorks />

      <Faq />

      <Technical />
    </section>
  );
}

function Pitch() {
  return (
    <div className="panel p-8 md:p-10">
      <p className="text-[12px] font-medium uppercase tracking-widest2 text-accent">
        The thesis
      </p>
      <p className="mt-4 max-w-2xl text-[18px] leading-relaxed text-bone md:text-[22px]">
        Ascent is a <span className="text-accent">store of value</span> that
        remembers. Every buy makes the next buyer pay a little more. Every
        quiet moment lets that premium fade. Hold through the noise and the
        market itself pays you to exit when the next wave arrives.
      </p>
      <p className="mt-5 max-w-2xl text-[13px] leading-relaxed text-ash">
        It is a single token in a single Uniswap v4 pool. There is no
        staking, no lockup, no governance. Patience is rewarded automatically
        by the AMM.
      </p>
    </div>
  );
}

function Pillars() {
  const items = [
    {
      title: "It punishes hype",
      body: "When everyone is buying at once, the price for buyers rises faster than fair value. The faster the rush, the steeper the premium.",
    },
    {
      title: "It rewards patience",
      body: "Every block of calm pulls the premium back down. The market reverts to fair value on its own — no team intervention.",
    },
    {
      title: "It pays exits during peaks",
      body: "Sellers don't just receive fair price during a rush — they receive a bonus on top, funded by the premiums that earlier buyers paid.",
    },
    {
      title: "Always solvent, always on",
      body: "Bonuses come from a holder reserve that fills up during rushes and drains during calm. Math guarantees it can never owe more than it holds.",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((it, i) => (
        <motion.div
          key={it.title}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: i * 0.04 }}
          className="panel p-6"
        >
          <h3 className="text-[14px] font-medium text-bone">{it.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-ash">{it.body}</p>
        </motion.div>
      ))}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Buy",
      body: "You pay a small premium over fair price. The size of the premium depends on how much buying has happened recently. The premium goes into the holder reserve — not to a team wallet.",
    },
    {
      num: "02",
      title: "Hold",
      body: "Every block, the memory of recent buying fades a little. The premium shrinks. Long, steady holders deepen the market's conviction, which lowers the premium for everyone.",
    },
    {
      num: "03",
      title: "Sell",
      body: "If the market is calm, you sell at fair price. If the market is hot, you sell above fair price — the holder reserve tops up your exit. Patience compounds into a real cash bonus.",
    },
  ];

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
        Three actions
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.num} className="panel p-6">
            <div className="font-mono text-[11px] text-ash">{s.num}</div>
            <h3 className="mt-3 text-[16px] font-medium text-bone">{s.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ash">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Faq() {
  const faqs = [
    {
      q: "Is this a meme coin?",
      a: "No. There is no inflation, no team unlock schedule, no marketing emissions. The token only exists in one Uniswap v4 pool, and the rules of trading are encoded into the AMM itself. It behaves like a store of value, not a casino chip.",
    },
    {
      q: "Where does the sell bonus come from?",
      a: "From the buyers who came before you. When the market gets hot, buyers pay above fair price; that excess fills a holder reserve. When sellers exit, they draw from that reserve. It's a redistribution from impatient capital to patient capital — built into the protocol.",
    },
    {
      q: "Can the bonus run out?",
      a: "The bonus is always capped at what's in the holder reserve. The contract can never promise more than it holds. If the reserve is empty, sellers simply receive fair price — they are never blocked from exiting.",
    },
    {
      q: "What stops a whale from draining the reserve?",
      a: "A bonus is only ever paid out proportional to the current premium. To drain the reserve, the premium has to be high — and the premium is only high right after heavy buying that filled the reserve in the first place. The math is symmetric: you can only take out what comparable buyers put in.",
    },
    {
      q: "How is this different from a normal token?",
      a: "A normal AMM has no memory. It treats the 1000th buyer of the day exactly like the first. Ascent's AMM remembers — it raises the cost of chasing and discounts the cost of waiting. Time becomes a price input.",
    },
    {
      q: "Do I need to do anything to earn the bonus?",
      a: "No staking, no signing, no claiming. You just hold. When you decide to sell, the bonus (if any) is included in the swap automatically.",
    },
  ];

  const [open, setOpen] = useState<number | null>(0);

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
        Questions
      </p>
      <div className="mt-5 panel divide-y divide-edge">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-white/[0.015]"
              >
                <span className="text-[14px] font-medium text-bone">{f.q}</span>
                <span
                  className={clsx(
                    "font-mono text-[11px] text-ash transition",
                    isOpen && "rotate-45 text-accent",
                  )}
                >
                  +
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-6 text-[13px] leading-relaxed text-ash">
                      {f.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Technical() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel p-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            For the curious
          </p>
          <p className="mt-1 text-[14px] text-bone">The math, in one paragraph</p>
        </div>
        <span
          className={clsx(
            "font-mono text-[11px] text-ash transition",
            open && "rotate-45 text-accent",
          )}
        >
          +
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="hairline my-5" />
            <p className="text-[13px] leading-relaxed text-ash">
              The AMM tracks four numbers per pool: cumulative net buying
              (F), a fast-moving "recent rush" velocity (V), a slow-moving
              "holder base" depth (D), and a "sell pressure" term (C). They
              decay every block, so memory fades naturally without any
              keeper. They combine into a single demand premium{" "}
              <span className="font-mono text-bone/80">m = exp(α · tanh(z))</span>{" "}
              where{" "}
              <span className="font-mono text-bone/80">
                z = (F + γV)/S<sub>F</sub> + θ ln(1 + D/S<sub>D</sub>) − φ (C/S<sub>C</sub>)<sup>p</sup>
              </span>
              . Buyers receive base output divided by m; sellers receive
              base output plus the same percentage as a bonus, capped by
              the holder reserve. Because m is symmetric and the bonus is
              capped at what's in the reserve, the contract is provably
              solvent under every trade path.
            </p>
            <p className="mt-3 text-[12px] text-ash">
              Full derivation, parameter choices, and the proof sketch live
              in <span className="font-mono text-bone/70">docs/ARCHITECTURE.md</span>.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
