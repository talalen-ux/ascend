import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "rise — whitepaper",
  description:
    "rise: a self-compounding ethereum-native asset whose price floor is monotone non-decreasing under any sequence of trades.",
};

export default function Whitepaper() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 md:py-20">
      <header className="mb-12">
        <p className="text-[10px] font-medium uppercase tracking-widest2 text-ash">whitepaper · v1.0</p>
        <h1 className="mt-3 text-4xl font-medium leading-[1.1] tracking-tight text-bone md:text-[52px]">
          rise — a self-compounding asset on ethereum.
        </h1>
        <p className="mt-5 text-[14px] leading-relaxed text-ash">
          a single contract holds every wei ever paid in. its public ratio
          <span className="mx-1 font-mono text-bone/80">reserve / supply</span>
          defines the price floor, and the contract is engineered such that
          this ratio is monotonically non-decreasing under any finite sequence
          of buys and sells. holders are paid by traders.
        </p>
      </header>

      <Section title="1 · abstract">
        <p>
          rise is an erc-20 issued from a single contract on ethereum (the
          engine). the engine is the only minter, the only burner, and the
          only source of liquidity. buys mint rise at the current floor and
          retain 1% of input as additional reserve; sells burn rise at the
          current floor and retain 3% of output as additional reserve. both
          retentions stay in the contract permanently and back the floor for
          all remaining holders. there is no admin, no upgrade, and no
          withdraw function.
        </p>
        <p>
          the floor is defined as{" "}
          <code>floor = reserve / supply</code>. theorems 1 and 2 below show
          this quantity is strictly increasing on every buy with positive
          input and on every sell with positive input less than total supply.
          the engine is therefore a one-way ratchet: trading volume in any
          direction lifts the floor; idle periods leave it flat; nothing
          lowers it.
        </p>
      </Section>

      <Section title="2 · mechanism">
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.1 state</h3>
        <p>
          the engine&rsquo;s only state is its ETH balance{" "}
          <code>R</code> and the rise{" "}
          <code>totalSupply()</code>{" "}
          <code>S</code>. both are public on-chain.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.2 buy</h3>
        <p>
          a buyer transmits <code>e</code> wei. the engine computes
          <code className="ml-2"> fee = e · 0.01</code>,
          <code className="ml-2"> net = e · 0.99</code>,
          <code className="ml-2"> floor₀ = R / S</code>, and mints
          <code className="ml-2"> riseOut = net / floor₀</code> rise to the
          caller. the entire <code>e</code> remains in the contract.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.3 sell</h3>
        <p>
          a seller submits <code>r</code> rise to burn. the engine computes
          <code className="ml-2"> floor₀ = R / S</code>,
          <code className="ml-2"> gross = r · floor₀</code>,
          <code className="ml-2"> fee = gross · 0.03</code>,
          <code className="ml-2"> ethOut = gross · 0.97</code>; burns
          <code className="ml-2"> r</code> rise from the caller; transfers
          <code className="ml-2"> ethOut</code> to the caller. the
          <code className="mx-1">fee</code> remains in the contract.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.4 bootstrap</h3>
        <p>
          at deploy, the engine constructor enforces a one-shot bootstrap of
          exactly <code>0.001 ETH</code> from the deployer and mints
          <code className="mx-1">1 rise</code> directly to the engine address
          itself. the engine has no path to spend its own balance, so this
          rise is unsellable; the bootstrap ETH is non-withdrawable. these
          two values anchor the initial floor at exactly{" "}
          <code>0.001 ETH per rise</code>. once any user transacts, the floor
          moves up from there.
        </p>
      </Section>

      <Section title="3 · proofs">
        <h3 className="mt-6 text-[14px] font-medium text-bone">theorem 1 · buys lift the floor</h3>
        <p>
          let <code>R, S {">"} 0</code> and let <code>e {">"} 0</code> be the
          ETH input of a buy. then{" "}
          <code>floor&rsquo; / floor &gt; 1</code>.
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          R&rsquo; = R + e
          <br />
          S&rsquo; = S + (0.99 · e) / (R / S) = S + 0.99 · e · S / R
          <br />
          floor&rsquo; = R&rsquo; / S&rsquo; = R(R + e) / (S(R + 0.99 · e))
          <br />
          floor&rsquo; / floor = (R + e) / (R + 0.99 · e) &gt; 1 ∎
        </p>

        <h3 className="mt-8 text-[14px] font-medium text-bone">theorem 2 · sells lift the floor</h3>
        <p>
          let <code>R, S {">"} 0</code> and let{" "}
          <code>0 &lt; r &lt; S</code> be the rise input of a sell. then{" "}
          <code>floor&rsquo; / floor &gt; 1</code>.
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          R&rsquo; = R − 0.97 · r · (R/S) = R · (S − 0.97·r) / S
          <br />
          S&rsquo; = S − r
          <br />
          floor&rsquo; / floor = (S − 0.97·r) / (S − r) &gt; 1
          <br />
          since 0.97·r &lt; r ⟹ S − 0.97·r &gt; S − r ∎
        </p>

        <h3 className="mt-8 text-[14px] font-medium text-bone">corollary · monotone non-decreasing under any sequence</h3>
        <p>
          for any finite sequence of buys with positive input and sells with
          input strictly less than the prevailing supply, the floor at the
          end of the sequence is at least the floor at the start. equality
          holds iff the sequence is empty. ∎
        </p>
      </Section>

      <Section title="4 · solvency">
        <p>
          the engine is solvent against the floor at every block: its ETH
          balance is always at least <code>floor · (S − S_locked)</code>,
          where <code>S_locked</code> is the bootstrap rise held by the
          engine itself. proof: the engine&rsquo;s balance equals every wei
          ever paid in by buys minus every wei ever paid out by sells. a sell
          of <code>r &lt; S</code> pays out{" "}
          <code>0.97 · r · R / S &lt; R</code>. so balance never goes
          negative, and after any sell the balance per non-bootstrap rise is
          at least the prior floor (by theorem 2). ∎
        </p>
      </Section>

      <Section title="5 · security model">
        <h3 className="mt-6 text-[14px] font-medium text-bone">5.1 capabilities</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>the engine cannot mint rise outside <code>buy()</code>.</li>
          <li>the engine cannot burn rise outside <code>sell()</code>.</li>
          <li>the engine has no function that transfers ETH out except the seller payment in <code>sell()</code>.</li>
          <li>the engine is not <em>Ownable</em>, <em>Pausable</em>, or upgradeable. there is no proxy.</li>
          <li>the rise token has no admin role. its sole minter is the immutable engine address; its sole burner is the same.</li>
        </ul>
        <h3 className="mt-6 text-[14px] font-medium text-bone">5.2 mev considerations</h3>
        <p>
          the engine has no slippage in the AMM sense — buy and sell prices
          are both equal to the on-chain <code>floor</code>. a sandwich
          attack on a buy would require the attacker to buy in front of the
          victim and sell behind, but the round-trip 4% friction (1% buy +
          3% sell) makes any sandwich strictly unprofitable for slippage
          gains less than 4%, and no buy on this engine creates slippage in
          excess of 4%.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">5.3 reentrancy</h3>
        <p>
          <code>sell()</code> follows checks-effects-interactions: state
          mutations precede the ETH transfer. a malicious receiver re-entering{" "}
          <code>buy()</code> or <code>sell()</code> would observe the
          updated floor and would not be able to withdraw more than is owed
          to it. nevertheless the contract should ship with a transient
          reentrancy guard for defence in depth.
        </p>
      </Section>

      <Section title="6 · listing & price discovery">
        <p>
          the primary venue is the engine itself. for compatibility with
          third-party indexers (Dexscreener, GeckoTerminal, etc.) a small
          uniswap v2 pool of rise/WETH may be seeded post-deploy with the
          LP tokens permanently locked. the pool acts as a shadow listing:
          arbitrageurs maintain a soft peg between the uniswap mid-price and
          the engine floor (within the 4% round-trip band), which gives
          trackers a price feed while preserving the engine as the venue
          where the floor mechanic actually compounds.
        </p>
      </Section>

      <Section title="7 · what the floor does not promise">
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            the floor is the redemption price <em>before</em> the 3% sell
            fee. a seller receives <code>0.97 · floor</code>. the floor
            itself is the contract&rsquo;s internal accounting datum.
          </li>
          <li>
            a round-trip from buy to sell costs ~4% on a flat floor. break-even
            requires the floor to lift by ~4% (compounded by trade volume)
            during your hold.
          </li>
          <li>
            the floor is denominated in ETH. it does not promise USD
            appreciation; ETH itself can move.
          </li>
          <li>
            the engine is not audited. read the source. the source is the
            contract.
          </li>
        </ul>
      </Section>

      <Section title="8 · acknowledgements">
        <p>
          the floor-ratchet pattern owes intellectual debt to early
          DeFi experiments in protocol-owned liquidity (Olympus, Tokemak)
          and to redemption-floor tokens (Float, Reflexer). rise differs
          by being a single-contract, no-DAO, no-emission, no-rebase
          implementation in which the only mechanism is the ratio of
          reserve to supply and the only state is its evolution.
        </p>
      </Section>

      <footer className="mt-16 border-t border-edge pt-6 text-[11px] text-ash">
        rise — v1.0 — released to the public domain. the contract is the spec.
      </footer>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 space-y-3 text-[14px] leading-[1.7] text-bone/85">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-widest2 text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}
