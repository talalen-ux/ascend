"use client";

import { motion } from "framer-motion";

const lines = [
  "a specter has returned to ethereum: the specter of code that runs without an operator. the contract that exists at block zero is the contract that will exist forever. this must be specifically arranged for. we have arranged for it.",
  "sato is an erc-20 on ethereum. its name and symbol are both lowercase, both sato. it has 18 decimals. it is an asset, not a campaign. it does not launch. it does not graduate. it does not migrate to a real pool when some threshold is hit, because there is no threshold and no other pool to migrate to. the contract that priced the first buy will price every buy after it, forever.",
  "there is one issuance contract, set as the sole minter at deployment and locked. it converts ether into newly issued sato at a deterministic price defined by the function p(eth) = (S/K) · e^(eth/S), where S = 500 ETH and K = 21,000,000. price depends only on cumulative ether ever paid in. it has no ceiling. it grows for as long as buyers exist.",
  "supply is the integral of that price. it follows minted(eth) = K · (1 − e^(−eth/S)), which approaches but never reaches K. there is no point at which the contract stops issuing or hands the market off to anyone else. it just keeps charging more for the next unit. the asymptote is a property of the function, not a finish line.",
  "sells use the same function in reverse. the issuer holds every wei of ether ever paid in and pays sellers from that pool at the current price. ether cannot leave by any other path. there is no team wallet, no vested allocation, no liquidity provider position to remove. the entire counterparty to every holder is the contract itself.",
  "a 0.3% fee is taken on both directions. it accumulates in the issuer contract permanently. nobody can withdraw it. it is not a treasury. it is a counterweight.",
  "two things keep the price function from being immediately gamed. each buy is capped at 5 ETH. selling in the same block as your last buy reverts. these are the only frictions. from genesis, the contract is fully deterministic.",
  "we did not pre-mint. we did not allocate to ourselves. we cannot pause, blacklist, upgrade, or refund. if everyone involved disappeared tonight, the contract would still run tomorrow at exactly the same prices, against exactly the same rules. that is the only feature.",
];

export function Manifesto() {
  return (
    <section id="manifesto" className="mt-24 max-w-2xl space-y-6">
      <motion.h2
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
        className="text-[10px] font-medium uppercase tracking-widest2 text-ash"
      >
        Manifesto
      </motion.h2>
      <div className="space-y-5">
        {lines.map((line, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5, delay: Math.min(0.04 * i, 0.2) }}
            className="text-[15px] leading-[1.7] text-bone/85"
          >
            {line}
          </motion.p>
        ))}
      </div>
      <p className="pt-4 text-[11px] text-ash">— sato</p>
    </section>
  );
}
