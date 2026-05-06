import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ascend — whitepaper",
  description:
    "ascend: a self-compounding ethereum-native asset whose price floor is monotone non-decreasing under any sequence of trades.",
};

export default function Whitepaper() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 md:py-20">
      <header className="mb-12">
        <p className="text-[10px] font-medium uppercase tracking-widest2 text-ash">whitepaper · v1.0</p>
        <h1 className="mt-3 text-4xl font-medium leading-[1.1] tracking-tight text-bone md:text-[52px]">
          ascend — a self-compounding asset on ethereum.
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
          ascend is an erc-20 issued from a single uniswap v4 hook on
          ethereum. the hook is the only minter, the only burner, and the
          only source of liquidity. the trading price is{" "}
          <code>floor · (1 + premium)</code>, where the premium ratchets up
          deterministically with all-time mining inflow:{" "}
          <code>premium = 100% + cumulativeEthIn / 500 ETH × 100%</code>.
          mining retains 5% of input and redemption retains 15% of gross —
          both flows, plus the premium itself, stay in the vault permanently
          and deepen the backing for every remaining holder. floor and
          premium are both monotone non-decreasing forever. market cap =
          price · supply = <code>(1 + premium) · vault</code> compounds
          super-linearly with cumulative volume. there is no admin, no
          upgrade, no migration, no withdraw.
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
          <code>R</code> and the ascend{" "}
          <code>totalSupply()</code>{" "}
          <code>S</code>. both are public on-chain.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.2 mining</h3>
        <p>
          a miner transmits <code>e</code> wei. the hook computes
          <code className="ml-2"> fee = e · 0.05</code>,
          <code className="ml-2"> net = e · 0.95</code>,
          <code className="ml-2"> floor₀ = R / S</code>, and mints
          <code className="ml-2"> ascendOut = net / floor₀</code> ascend to the
          caller. the entire <code>e</code> remains in the vault.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.3 redemption</h3>
        <p>
          a redeemer submits <code>r</code> ascend to burn. the hook computes
          <code className="ml-2"> floor₀ = R / S</code>,
          <code className="ml-2"> gross = r · floor₀</code>,
          <code className="ml-2"> fee = gross · 0.15</code>,
          <code className="ml-2"> ethOut = gross · 0.85</code>; burns
          <code className="ml-2"> r</code> ascend from the caller; transfers
          <code className="ml-2"> ethOut</code> to the caller. the
          <code className="mx-1">fee</code> remains in the vault.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.4 bootstrap</h3>
        <p>
          at deploy, the engine constructor enforces a one-shot bootstrap of
          exactly <code>0.001 ETH</code> from the deployer and mints
          <code className="mx-1">1 ascend</code> directly to the engine address
          itself. the engine has no path to spend its own balance, so this
          ascend is unsellable; the bootstrap ETH is non-withdrawable. these
          two values anchor the initial floor at exactly{" "}
          <code>0.001 ETH per ascend</code>. once any user transacts, the floor
          moves up from there.
        </p>
      </Section>

      <Section title="3 · proofs">
        <h3 className="mt-6 text-[14px] font-medium text-bone">theorem 1 · mining lifts the floor</h3>
        <p>
          let <code>R, S {">"} 0</code>, let <code>P = 2</code> be the price
          multiplier (1 + 100% premium), and let <code>e {">"} 0</code> be the
          ETH input of a mine. mining at price <code>P · floor</code> with a
          5% fee yields:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          R&rsquo; = R + e
          <br />
          S&rsquo; = S + (0.95 · e) / (P · R/S) = S · (1 + 0.475 · e/R)
          <br />
          floor&rsquo; / floor = (R + e) / (R + 0.475 · e) &gt; 1 ∎
        </p>
        <p className="mt-3">
          the floor lifts ~10× harder per unit of ETH than under fees alone,
          because the premium half of the input deepens the vault without
          minting matching supply.
        </p>

        <h3 className="mt-8 text-[14px] font-medium text-bone">theorem 2 · redemption lifts the floor</h3>
        <p>
          let <code>R, S {">"} 0</code> and let{" "}
          <code>0 &lt; r &lt; S</code> be the ascend input of a redemption.
          then{" "}
          <code>floor&rsquo; / floor &gt; 1</code>.
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          R&rsquo; = R − 0.85 · r · (R/S) = R · (S − 0.85·r) / S
          <br />
          S&rsquo; = S − r
          <br />
          floor&rsquo; / floor = (S − 0.85·r) / (S − r) &gt; 1
          <br />
          since 0.85·r &lt; r ⟹ S − 0.85·r &gt; S − r ∎
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
          the hook is solvent against the floor at every block: its ETH
          balance is always at least <code>floor · (S − S_locked)</code>,
          where <code>S_locked</code> is the bootstrap ascend held by the
          hook itself. proof: the hook&rsquo;s balance equals every wei
          ever paid in by mining minus every wei ever paid out as redemption.
          a redemption of <code>r &lt; S</code> pays out{" "}
          <code>0.85 · r · R / S &lt; R</code>. so balance never goes
          negative, and after any redemption the balance per non-bootstrap
          ascend is at least the prior floor (by theorem 2). ∎
        </p>
      </Section>

      <Section title="5 · security model">
        <h3 className="mt-6 text-[14px] font-medium text-bone">5.1 capabilities</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>the engine cannot mint ascend outside <code>buy()</code>.</li>
          <li>the engine cannot burn ascend outside <code>sell()</code>.</li>
          <li>the engine has no function that transfers ETH out except the seller payment in <code>sell()</code>.</li>
          <li>the engine is not <em>Ownable</em>, <em>Pausable</em>, or upgradeable. there is no proxy.</li>
          <li>the ascend token has no admin role. its sole minter is the immutable engine address; its sole burner is the same.</li>
        </ul>
        <h3 className="mt-6 text-[14px] font-medium text-bone">5.2 mev considerations</h3>
        <p>
          the hook has no slippage in the AMM sense — mining and redemption
          prices are both pinned to the on-chain <code>floor</code>. a
          sandwich attack would require the attacker to mine in front of the
          victim and redeem behind, but the round-trip 20% friction (5%
          mining + 15% redemption) makes any sandwich strictly unprofitable
          for slippage gains less than 20%, and no single mine on this hook
          creates slippage in excess of 20%.
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">5.3 reentrancy</h3>
        <p>
          the hook&rsquo;s <code>beforeSwap</code> is bracketed by an{" "}
          <code>_enter</code>/<code>_exit</code> pair backed by EIP-1153
          transient storage at slot{" "}
          <code>keccak256(&quot;ascend.hook.reentrancy.v1&quot;)</code>. any
          re-entry into <code>beforeSwap</code> within the same transaction
          reverts. the only path that pushes ETH out is{" "}
          <code>poolManager.settle</code>{`{value: …}`}, which sends to the
          PoolManager itself, not to user-controlled contracts. token
          transfers are restricted to <code>mint</code>/<code>burn</code>{" "}
          on the ascend contract whose only authorized caller is the hook.
        </p>
      </Section>

      <Section title="6 · single-venue price discovery via uniswap v4">
        <p>
          ascend is implemented as a uniswap v4 hook, deployed at a CREATE2
          address whose low-order bits encode the permission set{" "}
          <code>{"{afterInitialize, beforeAddLiquidity, beforeSwap, beforeSwapReturnsDelta}"}</code>.
          the canonical pool has{" "}
          <code>currency0 = native ETH</code>,{" "}
          <code>currency1 = ascend</code>, and zero AMM fee. no liquidity
          is ever added to the pool;{" "}
          <code>beforeAddLiquidity</code> reverts on any attempt.
        </p>
        <p>
          every swap routes through{" "}
          <code>PoolManager.swap</code>, which calls the hook&rsquo;s{" "}
          <code>beforeSwap</code>. the hook computes the floor-priced output,
          settles the input ETH (or input ascend) into itself, mints (or
          burns) the matching ascend, and returns a{" "}
          <code>BeforeSwapDelta</code> that exactly cancels the AMM portion of
          the swap. the AMM curve runs on zero remaining input. the swapper
          receives the hook&rsquo;s computed output as if it were AMM output.
        </p>
        <p>
          consequently, the hook is the only price-discovery surface and the
          only liquidity venue. whether a swap originates from the dapp&rsquo;s{" "}
          <code>AscendRouter</code>, from Uniswap&rsquo;s v4 swap UI, from a
          1inch or 0x aggregator, or from any other contract that unlocks
          the PoolManager and calls <code>swap</code>, the same{" "}
          <code>beforeSwap</code> handler runs, the same delta is returned,
          and the same price is paid. the price is identical across venues
          by execution path, not by arbitrage.
        </p>
        <p>
          listing on dexscreener and geckoterminal is automatic once their
          indexers cover uniswap v4 on the deployed chain — the pool ID is
          the public identifier.
        </p>
      </Section>

      <Section title="7 · what the floor does not promise">
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            the floor is the redemption price <em>before</em> the 15%
            redemption fee. a redeemer receives <code>0.85 · floor</code>.
            the floor itself is the contract&rsquo;s internal accounting
            datum and the inputs to it (vault balance, total supply) are
            both public.
          </li>
          <li>
            a round-trip from mine to redeem costs ~20% on a flat floor.
            break-even requires the floor to compound by ~20% (driven by
            other holders&rsquo; volume) during your hold. the asset
            rewards holding, not flipping.
          </li>
          <li>
            the floor is denominated in ETH. it does not promise USD
            appreciation; ETH itself can move.
          </li>
          <li>
            the hook is not audited. read the source. the source is the
            contract.
          </li>
        </ul>
      </Section>

      <Section title="8 · acknowledgements">
        <p>
          the floor-ratchet pattern owes intellectual debt to early
          DeFi experiments in protocol-owned liquidity (Olympus, Tokemak)
          and to redemption-floor tokens (Float, Reflexer). ascend differs
          by being a single-contract, no-DAO, no-emission, no-rebase
          implementation in which the only mechanism is the ratio of
          reserve to supply and the only state is its evolution.
        </p>
      </Section>

      <footer className="mt-16 border-t border-edge pt-6 text-[11px] text-ash">
        ascend — v1.0 — released to the public domain. the contract is the spec.
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
