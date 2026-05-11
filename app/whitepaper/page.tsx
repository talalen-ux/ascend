import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ascend — whitepaper",
  description:
    "ascend v3: a Sato-style bonding-curve asset with smooth block-age penalty, reserve-aware bonus, and tile-routed buybacks. no team, no admin, no presale.",
};

export default function Whitepaper() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 md:py-20">
      <header className="mb-12">
        <p className="text-[10px] font-medium uppercase tracking-widest2 text-ash">whitepaper · v3.0</p>
        <h1 className="mt-3 text-4xl font-medium leading-[1.1] tracking-tight text-bone md:text-[52px]">
          ascend — a Sato-style asset that rewards patience.
        </h1>
        <p className="mt-5 text-[14px] leading-relaxed text-ash">
          ascend issues against a Sato exponential bonding curve via a Uniswap
          v4 hook. every mint over-collateralizes the reserve by 3%; every
          burn pays a smooth block-age penalty that asymptotes to zero past
          ~1.7 hours of holding. the penalty pool funds bonuses for long-term
          holders. flippers structurally fund diamond hands. no team
          allocation, no presale, no admin path.
        </p>
      </header>

      <Section title="1 · abstract">
        <p>
          ascend is an erc-20 minted by a single Uniswap v4 hook. there is no
          LP position, no liquidity provider, no admin role. the hook is the
          sole minter and burner. supply follows a Sato curve{" "}
          <code>q(e) = K · (1 − e^(−e/S))</code> with{" "}
          <code>K = 21,000,000</code> and <code>S = 0.3 ETH</code> on testnet
          (or a higher S on mainnet for slower price discovery). the curve
          asymptotes at <code>K</code> — it is a soft cap, never a hard wall.
        </p>
        <p>
          the protocol layers four structural rules onto the bare bonding
          curve, each designed to bias outcomes toward long-term participation:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>a 3% surplus take on every mint that grows a permanent over-collateralization reserve;</li>
          <li>a smooth exponential burn-age penalty that ramps from 10% (instant) to 0% (~1.7 hrs);</li>
          <li>a reserve-aware burn bonus that activates once surplus exceeds 10% of curve-owed reserves;</li>
          <li>a 12×12 cryptographic tile grid funded by 30% of every fee, where rewards are routed back through the curve as fresh mints.</li>
        </ul>
        <p>
          there is no team allocation, no presale, no upgrade path, no pause
          switch. every constant is hard-coded in the constructor. when the
          original deployers walk away, the contract keeps running on the
          same rules.
        </p>
      </Section>

      <Section title="2 · curve">
        <h3 className="mt-6 text-[14px] font-medium text-bone">2.1 issuance function</h3>
        <p>
          let <code>e</code> be the cumulative ETH ever routed to the curve
          (frozen on burns). the supply at curve position <code>e</code> is
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          q(e) = K · (1 − e^(−e/S))
        </p>
        <p>
          marginal mint price (forward derivative):
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          p(e) = dq/de⁻¹ = (S/K) · e^(e/S)
        </p>
        <p>
          starting at genesis (<code>e = 0</code>), the marginal mint price
          equals <code>S/K = 0.3 / 21,000,000 ≈ 1.43×10⁻⁸ ETH/ascend</code>.
          the price doubles roughly every <code>S · ln(2) ≈ 0.21 ETH</code>
          {" "}of cumulative inflow.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">2.2 mint mechanics</h3>
        <p>
          a miner submits <code>ethIn</code>. the hook decomposes it:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          totalFee     = ethIn · 0.007    (0.7% protocol fee)
          <br />
          tileShare    = ethIn · 0.002    (0.2% tile-engine portion of fee)
          <br />
          surplusTake  = (ethIn − totalFee) · 0.03    (3% post-fee)
          <br />
          ethToCurve   = ethIn − totalFee − surplusTake
          <br />
          mintAmount   = q(ethCum + ethToCurve) − q(ethCum)
        </p>
        <p>
          the curve advances by <code>ethToCurve</code> (~96.3% of input).
          <code>mintedFair</code> (the cumulative stepwise sum of all
          mintAmount values) and <code>currentSupply</code> both grow by{" "}
          <code>mintAmount</code>. the protocol records{" "}
          <code>lastMintBlock[user] = block.number</code> as the anti-flash-loan
          check, and updates the user&rsquo;s{" "}
          <code>weightedReceiveBlock</code> for the new tokens.
        </p>
        <p>
          per-tx limit <code>MAX_MINT_PER_TX = 5 ETH</code> caps the curve
          advance any single caller can produce, preventing vacuum minting.
          to mint more, split across multiple transactions.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">2.3 burn mechanics</h3>
        <p>
          a burner submits <code>satoIn</code> ascend. the hook decomposes:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          satoBurnFee   = satoIn · 0.01    (1% token-side destroyed)
          <br />
          satoToCurve   = satoIn − satoBurnFee
          <br />
          deltaE        = S · ln((K − mF + satoToCurve) / (K − mF))
          <br />
          totalFee      = deltaE · 0.007    (0.7% on the ETH leg)
          <br />
          basePayout    = deltaE − totalFee
          <br />
          payoutMult    = penaltyMultBps(holdAge) / 10000
          <br />
          grossPayout   = basePayout · payoutMult
          <br />
          bonus         = grossPayout · bonusBps / 10000
          <br />
          ethOut        = grossPayout + bonus
        </p>
        <p>
          <code>mintedFair</code> is{" "}
          <strong>frozen on burns</strong> — only <code>currentSupply</code>{" "}
          shrinks. this is the Sato-style monotone-floor convention. burns
          revert if invoked in the same block as the burner&rsquo;s last mint
          (anti-flash-loan), or if the implied <code>ethOut</code> exceeds the
          hook&rsquo;s actual ETH balance.
        </p>
      </Section>

      <Section title="3 · block-age penalty">
        <h3 className="mt-6 text-[14px] font-medium text-bone">3.1 smooth exponential decay</h3>
        <p>
          the burn payout multiplier is a continuously differentiable function
          of hold-age (blocks since the burner&rsquo;s weighted-average receive
          block):
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          payout(b) = FLOOR + (CEIL − FLOOR) · (1 − e^(−b/TAU))
          <br />
          FLOOR = 9000 bps (90%)    CEIL = 10000 bps (100%)
          <br />
          TAU = 100 blocks          CAP = 1000 blocks (hard cap → CEIL)
        </p>
        <p>
          there are no tier cliffs. every additional block aged moves the
          payout up by a fixed, continuously decreasing amount. milestones:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li><code>b = 0</code> blocks: 90.00% payout (10% penalty)</li>
          <li><code>b = 10</code> blocks (~2 min @12s): 90.95%</li>
          <li><code>b = 50</code>: 93.93%</li>
          <li><code>b = 100</code> (~20 min): 96.32%</li>
          <li><code>b ≈ 69</code>: 95% (one half-life)</li>
          <li><code>b ≈ 230</code>: 99%</li>
          <li><code>b ≈ 461</code> (~1.5 hr): 99.9%</li>
          <li><code>b ≥ 1000</code>: 100% (hard cap, gas optimization)</li>
        </ul>

        <h3 className="mt-6 text-[14px] font-medium text-bone">3.2 transfer-bypass protection</h3>
        <p>
          hold-age is tracked per-holder via{" "}
          <code>weightedReceiveBlock[user]</code>, a weighted-average updated
          on every erc-20 receive (not just mint). when a wallet receives{" "}
          <code>v</code> ascend in addition to an existing balance{" "}
          <code>B</code>:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          wrb&rsquo; = (B · wrb + v · block.number) / (B + v)
        </p>
        <p>
          this closes the naive transfer-bypass exploit: sending tokens to a
          fresh wallet before burning would otherwise reset hold-age to{" "}
          <code>∞</code> on the receiving side. with weighted-average tracking,
          the receiving wallet&rsquo;s wrb is{" "}
          <code>block.number</code> at receive time — tier-1 penalty applies
          immediately. the test{" "}
          <code>test_transferBypassIsClosed</code> proves the invariant.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">3.3 where the penalty goes</h3>
        <p>
          the &ldquo;stolen&rdquo; portion of the gross payout (<code>basePayout − grossPayout</code>)
          is added to <code>surplusReserve</code>. it never leaves the
          protocol — it gets recycled to the same long-term holders the
          penalty was designed to subsidize.
        </p>
      </Section>

      <Section title="4 · surplus and reserve-aware bonus">
        <h3 className="mt-6 text-[14px] font-medium text-bone">4.1 over-collateralization</h3>
        <p>
          every mint takes 3% of the post-fee amount and adds it to{" "}
          <code>surplusReserve</code>, a permanent accounting counter that
          never advances the curve. the actual ETH stays in the hook&rsquo;s
          reserve balance, so the protocol mechanically grows{" "}
          <strong>more solvent</strong> than the curve would predict, at a
          structural rate proportional to mint volume.
        </p>
        <p>
          define the surplus ratio:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          surplusRatioBps = (surplusReserve · 10000) / cumulativeEthIn
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">4.2 bonus activation</h3>
        <p>
          once <code>surplusRatioBps</code> exceeds the trigger (10%), every
          burn earns a bonus paid out of the surplus pool. the bonus linearly
          ramps from 0% at the trigger to a maximum cap:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          bonusBps = max(0, (surplusRatioBps − 1000) / 5)
          <br />
          bonusBps ← min(bonusBps, 500)    (capped at 5%)
        </p>
        <p>
          the slope <code>1/5</code> means a 1% over-trigger increase in
          surplus ratio adds 20 bps to the bonus. the cap of 500 bps is
          reached at <code>surplusRatioBps = 3500</code> (35% over-collat).
          past that, additional surplus accrues but the bonus payout stays
          flat — protecting the protocol from over-paying in cycles of high
          inflow.
        </p>
        <p>
          the &ldquo;stolen&rdquo; portion from block-age penalties also feeds
          surplus, so flippers — by mathematical construction — fund the
          bonus that patient holders eventually receive.
        </p>
      </Section>

      <Section title="5 · tile rewards (Ascension Grid)">
        <h3 className="mt-6 text-[14px] font-medium text-bone">5.1 funding</h3>
        <p>
          30% of every fee (the <code>TILE_FEE_BPS = 20</code> portion of the
          0.7% mint/burn fee, i.e. ~0.2% of swap volume) accrues to the
          TileEngine. accrual is flushed to the engine by anyone calling{" "}
          <code>sweep()</code> on the hook. the engine&rsquo;s
          <code className="mx-1">currentEpochPool</code> grows monotonically
          within each 24-hour epoch.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">5.2 selection</h3>
        <p>
          at the start of each epoch, the first on-chain action locks a seed:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          epochSeed[e] = keccak256(blockhash(n-1), prevrandao, e)
        </p>
        <p>
          a wallet is selected for epoch <code>e</code> iff
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          keccak256(epochSeed[e], wallet) mod 10000 &lt; SELECTION_RATE_BPS
        </p>
        <p>
          with <code>SELECTION_RATE_BPS = 6800</code>, 68% of holders are
          eligible to claim a tile each epoch. selected wallets must also
          hold at least <code>MIN_HOLDING = 1 ascend</code> and must not have
          already claimed in the current epoch.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">5.3 multiplier distribution</h3>
        <p>
          the 12×12 grid contains 144 claimable tiles per epoch. on claim, the
          hook draws a pseudorandom multiplier from a locked distribution:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          nibble = keccak256(blockhash(n-1), prevrandao, sender, idx, epoch) mod 16
          <br />
          nibble &lt; 10   → ×1  (62.50%)
          <br />
          nibble &lt; 13   → ×2  (18.75%)
          <br />
          nibble &lt; 15   → ×3  (12.50%)
          <br />
          nibble == 15   → ×4  ( 6.25%)
        </p>
        <p>
          the expected multiplier is <code>E[m] = 0.625·1 + 0.1875·2 + 0.125·3 + 0.0625·4 = 1.625</code>.
          the base reward is pool-sized so that average payout equals exactly
          <code className="mx-1">pool / 144</code>:
        </p>
        <p className="mt-3 font-mono text-[12px] text-bone/80">
          baseReward = (pool · 10⁶) / 144 / 1,625,000
          <br />
          reward     = baseReward · multiplier
          <br />
          reward     ← min(reward, pool − paidOut)    (solvency cap)
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">5.4 claim-as-buy</h3>
        <p>
          rewards are <strong>not paid in ETH</strong>. the TileEngine calls{" "}
          <code>hook.claimReward(recipient)</code> with the reward as{" "}
          <code>msg.value</code>; the hook treats this exactly like a mint:
          the ETH advances <code>cumulativeEthIn</code>, the curve produces a
          fresh <code>mintAmount</code> of ascend, and that ascend is minted
          directly to the claimer&rsquo;s wallet. this means every tile claim:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>lifts the marginal mint price for everyone (curve advances);</li>
          <li>increases <code>mintedFair</code> for everyone (lifts the monotone floor);</li>
          <li>distributes new ascend to a holder, rather than ETH that exits to a wallet.</li>
        </ul>
        <p>
          tile rewards are therefore protocol-backed buybacks. the &ldquo;source&rdquo;
          of the buyback is the original fee revenue — a recycling loop, not a
          subsidy.
        </p>
      </Section>

      <Section title="6 · invariants">
        <h3 className="mt-6 text-[14px] font-medium text-bone">6.1 floor never drops</h3>
        <p>
          the displayed monotone floor is the per-token Sato aggregate{" "}
          <code>(S / (K − mF)) · (mF / supply) · (1 − burnFee)</code>. it
          only depends on <code>mintedFair</code> (which only grows on mints,
          frozen on burns) and <code>currentSupply</code> (which only grows on
          mints, shrinks on burns). therefore:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>under any mint: mF grows, supply grows proportionally — floor grows.</li>
          <li>under any burn: mF stays, supply shrinks — floor grows.</li>
          <li>idle blocks: floor stays.</li>
        </ul>
        <p>
          the floor is therefore monotone non-decreasing forever. tests{" "}
          <code>test_floorIncreasesMonotonically_mintOnly</code> and{" "}
          <code>test_floorNeverDropsUnderBurns</code> prove the invariant
          under random sequences.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">6.2 cycling is unprofitable</h3>
        <p>
          a round-trip mint-then-burn pays out{" "}
          <code>(1 − tokenFee)(1 − protocolFee)(payoutMult)(1 + bonusBps)</code>{" "}
          of the curve-equivalent ETH. at tier-1 (b=0), this is
          approximately <code>0.99 × 0.993 × 0.9 × 1 ≈ 0.885</code> — a
          structural 11.5% loss per cycle. the protocol retains the
          remainder. test <code>test_cyclingIsUnprofitable</code> verifies
          this under fuzz inputs.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">6.3 solvency</h3>
        <p>
          the hook&rsquo;s ETH balance equals every wei ever paid in by mints
          and tile claims, minus every wei paid out by burns. the burn
          payout per-tx is reserve-bounded:{" "}
          <code>if (ethOut &gt; reserveEthInternal()) revert InsufficientReserve()</code>.
          combined with the structural retention of fees and the 3% surplus,
          the reserve always grows faster than the curve&rsquo;s redemption
          obligation. at no finite time can a redemption fail because the
          protocol is &ldquo;underwater&rdquo; — at worst, a redemption that
          would exceed reserve simply reverts and the caller tries a smaller
          burn.
        </p>
      </Section>

      <Section title="7 · uniswap v4 integration">
        <p>
          ascend is implemented as a v4 hook deployed at a CREATE2 address
          whose low-order bits encode the permission set{" "}
          <code>{"{afterInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap, beforeSwapReturnsDelta}"}</code>.
          the canonical pool has{" "}
          <code>currency0 = native ETH</code>,{" "}
          <code>currency1 = ascend</code>, dynamic fee enabled, and{" "}
          <strong>no liquidity</strong>. add-liquidity and remove-liquidity
          both revert; the hook is the sole pricing and settlement surface.
        </p>
        <p>
          every swap routes through{" "}
          <code>PoolManager.swap</code>, which calls{" "}
          <code>beforeSwap</code>. the hook reads{" "}
          <code>params.zeroForOne</code> to determine direction: ETH→ascend
          dispatches to <code>_doMint</code>, ascend→ETH to{" "}
          <code>_doBurn</code>. each path computes the curve math, settles
          the input into ERC-6909 claim tokens, and returns a{" "}
          <code>BeforeSwapDelta</code> that cancels the AMM math. the AMM
          curve runs on zero remaining input. the swapper receives the
          hook&rsquo;s computed output as if it were AMM output.
        </p>
        <p>
          the hook is therefore the only price-discovery surface. trades
          originating from the dapp, from Uniswap&rsquo;s v4 swap UI, from a
          1inch or 0x aggregator, or from any contract that unlocks the
          PoolManager and calls <code>swap</code> all execute against the
          same <code>beforeSwap</code> handler. the price is identical across
          venues by construction, not by arbitrage.
        </p>
      </Section>

      <Section title="8 · security model">
        <h3 className="mt-6 text-[14px] font-medium text-bone">8.1 capabilities</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>the hook is the sole minter and burner of ascend (immutable, set in token constructor).</li>
          <li>the hook is not <em>Ownable</em>, <em>Pausable</em>, or upgradeable. no proxy.</li>
          <li>the only path that pushes ETH out is the burn payout in <code>_doBurn</code> and the tile-engine deposit in <code>sweep</code>.</li>
          <li>the TileEngine&rsquo;s only ETH inflow is hook-initiated (<code>onlyHook</code> on <code>depositReward</code>); third parties cannot seed the pool.</li>
        </ul>

        <h3 className="mt-6 text-[14px] font-medium text-bone">8.2 reentrancy</h3>
        <p>
          both <code>beforeSwap</code> and <code>claimTile</code> are
          bracketed by an <code>_enter</code>/<code>_exit</code> pair backed
          by EIP-1153 transient storage. any re-entry within the same
          transaction reverts. the ascend ERC-20 has no admin role and no
          arbitrary mint surface — the only authorized minter is the hook
          address fixed at construction.
        </p>

        <h3 className="mt-6 text-[14px] font-medium text-bone">8.3 MEV considerations</h3>
        <p>
          the hook&rsquo;s pricing is deterministic from on-chain state — no
          AMM slippage, no oracle dependency. a sandwich attack would have to
          mine in front of a victim and burn behind, but each cycle costs
          ~11.5% to fees and tier-1 penalty (assuming a fresh wallet).
          same-block burn-after-mint always reverts via the{" "}
          <code>lastMintBlock</code> check, so the sandwich must span at
          least two blocks — and by then the front-run mint&rsquo;s curve
          advance has already been priced into the victim&rsquo;s mint.
        </p>
      </Section>

      <Section title="9 · what the protocol does not promise">
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            <strong>USD appreciation.</strong> all prices are denominated in
            ETH. the curve guarantees ETH-denominated floor monotonicity, not
            dollar appreciation.
          </li>
          <li>
            <strong>Liquid exit at the marginal price.</strong> the displayed
            mint price is the cost of the <em>next infinitesimal</em> token. a
            real mint or burn traverses the curve, so the average price you
            pay/receive differs from the displayed marginal. burns also incur
            the 1% token fee + 0.7% protocol fee + block-age penalty.
          </li>
          <li>
            <strong>Predictable mint-to-burn pricing.</strong> the round-trip
            cost depends on hold-age and current surplus ratio. flippers face
            ~11.5% loss; patient holders past 1000 blocks face ~1.7% (fees
            only). there is no &ldquo;guaranteed buyback&rdquo; price.
          </li>
          <li>
            <strong>Tile claim certainty.</strong> 32% of holders are not
            selected in any given epoch. multipliers are pseudorandom.
            rewards are capped by the epoch pool; the last claimers may
            receive less than nominal if the pool is depleted.
          </li>
          <li>
            <strong>Audit certification.</strong> the hook is not audited.
            the source is the contract. test coverage includes the floor
            monotonicity, cycling-unprofitability, transfer-bypass, and the
            full tile claim flow (26 passing tests as of v3.0).
          </li>
        </ul>
      </Section>

      <Section title="10 · parameters reference">
        <p>the following constants are hardcoded in the v3 hook constructor and cannot be changed post-deploy.</p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">curve</h3>
        <p className="mt-2 font-mono text-[12px] text-bone/80">
          K   = 21,000,000 ascend    (asymptotic cap)
          <br />
          S   = 0.3 ETH (testnet)    (curve scale)
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">fees</h3>
        <p className="mt-2 font-mono text-[12px] text-bone/80">
          MINT_FEE_BPS         = 70    (0.7% on mint)
          <br />
          BURN_FEE_BPS         = 70    (0.7% on burn ETH leg)
          <br />
          BURN_TOKEN_FEE_BPS   = 100   (1% on burn ascend leg, destroyed)
          <br />
          TILE_FEE_BPS         = 20    (0.2% portion of fee → TileEngine)
          <br />
          SURPLUS_BPS          = 300   (3% of post-fee mint → surplusReserve)
          <br />
          MAX_MINT_PER_TX      = 5 ETH
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">penalty</h3>
        <p className="mt-2 font-mono text-[12px] text-bone/80">
          PENALTY_FLOOR_BPS    = 9000   (90% payout at b=0)
          <br />
          PENALTY_CEIL_BPS     = 10000  (100% asymptote)
          <br />
          PENALTY_TAU_BLOCKS   = 100    (exponential decay constant)
          <br />
          PENALTY_CAP_BLOCKS   = 1000   (hard cap past asymptote)
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">bonus</h3>
        <p className="mt-2 font-mono text-[12px] text-bone/80">
          BONUS_TRIGGER_BPS    = 1000   (surplus ratio gate, 10%)
          <br />
          BONUS_SLOPE_DIVISOR  = 5
          <br />
          MAX_BONUS_BPS        = 500    (5% cap on bonus)
        </p>
        <h3 className="mt-6 text-[14px] font-medium text-bone">tile engine</h3>
        <p className="mt-2 font-mono text-[12px] text-bone/80">
          GRID_SIZE            = 144     (12×12 tiles per epoch)
          <br />
          EPOCH_LENGTH         = 24 hours
          <br />
          SELECTION_RATE_BPS   = 6800    (68% of holders selected/epoch)
          <br />
          MIN_HOLDING          = 1 ascend
          <br />
          MULT_DISTRIBUTION    = 62.5/18.75/12.5/6.25 (×1/×2/×3/×4)
          <br />
          E[multiplier]        = 1.625
        </p>
      </Section>

      <footer className="mt-16 border-t border-edge pt-6 text-[11px] text-ash">
        ascend — v3.0 — released to the public domain. the contract is the spec.
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
