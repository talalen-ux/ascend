"use client";

import { motion } from "framer-motion";

const steps = [
  {
    n: "01",
    title: "buy at the floor",
    body: "you send ETH. 1% stays in the contract as more backing for everyone. you mint ascend at the current floor price.",
  },
  {
    n: "02",
    title: "sell at the floor",
    body: "you burn ascend. 3% of your gross stays in the contract as more backing for everyone. you receive ETH at the current floor price.",
  },
  {
    n: "03",
    title: "the floor lifts",
    body: "every trade leaves more ETH per remaining ascend in the contract. that ratio — reserve ÷ supply — is the floor. by construction it can only go up.",
  },
];

const promises = [
  "no team allocation. no presale. no vesting.",
  "no admin. no pause. no upgrade. no withdraw.",
  "no off-chain price. no oracle. no migration.",
  "the contract is its own counterparty.",
];

export function HowItWorks() {
  return (
    <section id="how" className="mt-24 space-y-10">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
          how it works
        </p>
        <h2 className="mt-3 max-w-xl text-2xl font-medium leading-tight text-bone md:text-3xl">
          three steps. grade-school math. nothing else.
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className="panel p-6"
          >
            <div className="font-mono text-[11px] text-ash">{s.n}</div>
            <h3 className="mt-3 text-[16px] font-medium text-bone">{s.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ash">{s.body}</p>
          </motion.div>
        ))}
      </div>

      <div className="panel p-6 md:p-8">
        <p className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          the promises
        </p>
        <ul className="mt-4 space-y-2">
          {promises.map((p) => (
            <li
              key={p}
              className="flex items-start gap-3 text-[14px] leading-relaxed text-bone/85"
            >
              <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
