"use client";

import { motion } from "framer-motion";

const properties = [
  {
    title: "Born deterministic",
    body:
      "ascend is a single contract on Ethereum. it was constructed at one block, with one initial state, and runs against the same rules every block since. there is no governance, no admin, no upgrade path, no migration.",
  },
  {
    title: "Premium ratchets with volume",
    body:
      "miners pay a premium over the floor — starting at 100% (price = 2 × floor) and climbing 100 percentage points for every 250 ETH of cumulative mining. the premium never resets. early miners benefit; late miners capitalise the asset for everyone.",
  },
  {
    title: "Redemption stays cheap",
    body:
      "exits pay only 5% — same as entry. holders aren't trapped. the 5% retention still compounds the floor for everyone who keeps holding, but the heavy lifting on price appreciation is the premium ratchet, not the exit fee.",
  },
  {
    title: "Floor is the law",
    body:
      "the floor is the asset's redemption price — vault ÷ issued. the contract guarantees, by construction, that this ratio is monotone non-decreasing under any sequence of mints and redemptions. it cannot fall.",
  },
  {
    title: "Self-custodial counterparty",
    body:
      "the vault is the only counterparty to every holder. no liquidity provider, no market maker, no team treasury, no DAO. the contract is its own market.",
  },
  {
    title: "Verifiable on-chain",
    body:
      "the floor is two public reads — the contract's ETH balance and the ERC-20 total supply. anyone can compute it. anyone can verify it. anyone can mine it. anyone can redeem it.",
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
          a new asset class on ethereum.
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed text-ash">
          ascend is the first ethereum-native asset whose floor is encoded
          directly in the contract that issues it. it has no off-chain
          oracle, no off-chain price, no off-chain liquidity. it is mined
          into existence by ETH, redeemed by ETH, and priced by ETH.
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
