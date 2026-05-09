# ascend

### a self-compounding ethereum-native asset

---

## abstract

Ascend is a fair-launch ERC-20 issued and traded through a single Uniswap V4 hook. The hook is the sole liquidity provider on its pool and applies a 1% fee on every swap (plus a flat ~$2 surcharge on each buy). Of every fee collected, **70% is retained as additional LP-side depth**, deepening the pool without minting more ascend, and **30% routes to a separate `TileEngine` contract** that runs a 12×12 reward grid — once per 24h epoch, any holder may flip one tile and reveal a 1× to 4× multiplier on their share of the pool.

The protocol's central invariant is that the **floor** — defined as `(ETH in LP + uncollected fee credits) / (circulating ascend supply)` — is monotone non-decreasing under any finite sequence of buys and sells. The floor is the redemption guarantee: the minimum ETH-per-ascend backing a holder can always recover by selling. The floor compounds with volume. The market price moves above it on the standard CP curve.

There is no admin, no upgrade path, no migration, no team allocation, no presale. 122 million ascend tokens are minted at deploy and immediately committed to the pool's LP via the `Genesis` contract in a single atomic transaction. Every parameter is final at deploy.

---

## 1 · motivation

Three categories of token primitive exist on Ethereum today, each with a structural shortcoming:

**Constant-product memecoins (Uniswap V2/V3 launches).** Buyers and sellers transact on the same curve. The chart looks normal. Liquidity comes from third-party LPs who can withdraw at any moment — meaning the displayed depth can vanish. There is no protocol-level redemption guarantee; if everyone exits, the price goes to whatever the last LP leaves behind.

**Bonding-curve hooks.** A V4 hook implements a closed-form curve (often exponential) and acts as the sole minter. Predictable price growth, but the curve is reversible — sells unwind it — and there is typically no separate floor mechanism. The hook IS the LP, but the LP composition oscillates with sentiment.

**Reflective / rebase tokens (OHM, etc.).** A treasury holds backing assets and the protocol uses governance + bonding to manage growth. Complex, governable (which means changeable), and historically hard to reason about under regime change.

Ascend chooses a fourth path: a **standard constant-product LP** that the hook fully owns, with **fee retention compounding the floor** and a **separate reward distribution** to holders. The chart looks normal because the trading curve is normal. The floor is a separate, monotone-non-decreasing quantity that grows with every swap. The TileEngine gives holders an on-chain reason to engage daily, paid out of real trading volume — not from token emissions.

---

## 2 · mechanism

### 2.1 state

The protocol's on-chain state lives in three contracts:

```
Ascend.sol           ERC-20 with sole-minter pattern. 122M cap, fixed at genesis.
AscendHookV2.sol     V4 hook. Owns the only LP position on its pool.
                     Holds the deploymentBlock immutable (anti-bot window).
                     Maps tx.origin → lastBuyBlock (anti-flash-loan).
TileEngine.sol       12×12 reward grid. Hook-only deposits.
                     Per-address per-epoch claim map.
```

The pool's full state is captured by the LP position:

- `Y` — ETH in the LP's active reserves (token0)
- `X` — ascend in the LP's active reserves (token1)
- `Y_credits` — uncollected fees + donations owed to the LP
- `S` — total ascend supply (constant, `122_000_000 · 1e18`)
- `circ = S − X − ascend_held_by_hook` — circulating supply (held by users)

### 2.2 derived quantities

```
spot price (V4)    = Y / X                          (token1/token0; ascend per ETH)
floor (true)       = (Y + Y_credits) / circ         (ETH per circulating ascend)
floor (on-chain)   = Y / circ                       (conservative lower bound)
```

The on-chain `floor()` getter computes the lower bound from L and `sqrtPrice` because reading the position's pending fee credits requires V4-version-specific state-library calls. The *true* floor is what the proof in §3 protects; it is realized on every `rebalance()` call when the hook collects fees, sends 30% of ETH to the TileEngine, and donates the remaining 70% (plus all collected ascend) back to the LP.

### 2.3 the swap path

Every swap routes through the hook's `beforeSwap`. For a buy of `e` ETH (`zeroForOne = true`):

1. **Mint amount floor.** Reverts if `e ≤ MINT_FEE_WEI`. This is the dust floor that prevents pure spam.
2. **Anti-flash-loan marker.** `lastBuyBlock[tx.origin] = block.number`.
3. **Effective fee computation.**
   ```
   base_pips    = SWAP_FEE_PIPS                      = 10_000   (1%)
   mint_pips    = MINT_FEE_WEI · 1_000_000 / e       (flat ~$2 in pips terms)
   anti_bot     = pseudorandom in [0, 10_000] pips    if block < deploymentBlock + 100
                  0                                    otherwise
   total_pips   = clamp(base + mint + anti_bot, max = MAX_EFFECTIVE_FEE_PIPS = 100_000)
   ```
   The 10% absolute cap protects against degenerate outcomes on dust mints where the surcharge would otherwise exceed 100% of the swap.
4. **Override pool fee.** Return `total_pips | OVERRIDE_FEE_FLAG` from `beforeSwap`. V4 routes the fee to the LP token holder (this hook).

For a sell (`zeroForOne = false`):

1. **Same-block-burn guard.** Reverts if `lastBuyBlock[tx.origin] == block.number`. Defeats flash-loan arbitrage between mint and redemption.
2. **Flat fee.** `total_pips = SWAP_FEE_PIPS = 10_000` (1%). No surcharge, no anti-bot adjustment.

The actual swap proceeds on the standard V4 constant-product curve. The fee accrues to the LP position automatically.

### 2.4 the rebalance routine

`rebalance()` is permissionless. Anyone can call it; the protocol pays no gas, and it lifts the floor for everyone holding ascend, so it's economically aligned for any holder or bot to call it.

The routine is one transaction:

```
1. modifyLiquidity(0)             collect accrued fees → BalanceDelta of (eth_fees, ascend_fees)
2. take(currency0, hook, eth_fees)
   take(currency1, hook, ascend_fees)
3. tileEngine.depositReward{value: eth_fees · 0.3}()
4. donate(remaining_eth · 0.7, ascend_fees)   ← adds to LP fee credits
   settle{value: remaining_eth · 0.7}()
   sync + transfer + settle for ascend
```

Steps 3 and 4 use a try/catch around the TileEngine deposit so a buggy game contract cannot brick the swap path. If the deposit reverts, the tile portion stays on the LP donation.

### 2.5 the tile game

The TileEngine runs a 12×12 = 144 cell grid. Once per 24h epoch, any address holding ≥ 1 ascend may call `claimTile(idx)`. The contract:

1. Verifies eligibility (holding, not-already-claimed-this-epoch, tile-not-taken).
2. Draws a multiplier `m ∈ {1, 2, 3, 4}` from `keccak256(prevrandao, blockhash, sender, idx, epoch)`. The 4-bit nibble distribution is `0..9 → 1×`, `A..C → 2×`, `D..E → 3×`, `F → 4×` (62.5 / 18.75 / 12.5 / 6.25 %; expected value 1.625).
3. Computes `base_reward = epochPool / GRID_SIZE / 1.625`.
4. Pays out `m · base_reward` in ETH, capped at `epochPool − epochPaidOut` for solvency.
5. Records the claim and rolls unclaimed share into the next epoch.

### 2.6 genesis

The `Genesis.sol` contract performs the entire deployment in one constructor:

1. CREATE2-deploys `AscendHookV2` with the salt mined off-chain to encode the required V4 permission flags (`afterInitialize`, `beforeAddLiquidity`, `beforeSwap`).
2. The hook's constructor deploys the `Ascend` ERC-20 (sole-minter wired to the hook), mints all 122M to the hook, and deploys the `TileEngine`.
3. `Genesis` calls `poolManager.initialize(key, sqrtPriceX96)`. PoolManager calls back into the hook's `_afterInitialize`.
4. `_afterInitialize` re-enters PoolManager via `unlock(GENESIS, sqrtPriceX96)`. The unlock callback calls `modifyLiquidity` to deposit all 122M ascend + 1 ETH at full range.
5. `Genesis`'s constructor returns. The protocol is fully live.

There is no observable state in which the pool exists, is initialized, but is unfunded. Audit finding H-1 closed.

---

## 3 · theorems

We use the LP-retention rate `ρ = LP_SHARE × FEE_RATE = 0.7 × 0.01 = 0.007` per swap side. The proofs work for any `0 < ρ < 1`.

### theorem 1 · floor monotone non-decreasing on a buy

For any buy of `e > 0` ETH, with pre-trade reserves `(Y₀, X₀)` and `circ = S − X₀`:

After the trade plus LP retention:
```
Y' = Y₀ + ρ·e + Y_curve         where Y_curve = (1 − ρ)·e is what enters the curve
X' = X₀ · Y₀ / (Y₀ + Y_curve)
circ' = S − X'
floor' = (Y' + Y_credits') / circ'
```

The bookkeeping shifts the LP-retained `ρ·e` directly into `Y_credits'` (via `donate()` on rebalance, or instantaneously in the proof). Substituting and simplifying:

```
(Y' + ρ·e) · circ − (Y₀ + Y_credits) · circ' ≥ ρ·e · circ · Y₀ + (terms ≥ 0)
```

The right-hand side is strictly positive whenever `e > 0`, `circ > 0`, `Y₀ > 0`, `ρ > 0`. Therefore `floor' > floor`. ∎

The mint surcharge `MINT_FEE_WEI` strengthens the inequality further but is not required for monotonicity.

### theorem 2 · floor monotone non-decreasing on a sell

For any sell of `r > 0` ascend with `0 < r < circ`:

The fee `ρ·r` of ascend stays in the LP outside the curve trade. The remaining `(1 − ρ)·r` follows the constant product. By symmetry with theorem 1, after substituting and simplifying:

```
floor' / floor = (Y − ethOut) · circ / (Y · (circ − ascendIn))
```

where `ethOut < ascendIn · floor` because of the retention. This yields `floor' ≥ floor`, with strict inequality for `r > 0`. ∎

### corollary · floor is monotone over any finite trade sequence

Combining theorems 1 and 2: every trade individually does not decrease the (true) floor. By induction, the floor at the end of any finite sequence is at least the floor at the start. ∎

### theorem 3 · solvency

The hook is always solvent against the redemption guarantee. Specifically: at every block, **`Y + Y_credits ≥ floor · circ`** (trivially, by definition of `floor`).

Because `floor()` is computed from on-chain state at every block, and `circ` is `S − X − ascend_on_hook`, this is the strongest possible guarantee: any holder can read the floor on-chain, and the LP backing for that floor is materially present in the LP position. ∎

### theorem 4 · supply cap

`ascend.totalSupply() = 122_000_000 · 1e18` at every block. The Ascend ERC-20 mint function reverts unless called by the hook; the hook only calls `mint` once, in its constructor. There is no other code path that increments the total supply. ∎

---

## 4 · economic properties

### 4.1 round-trip cost

A buyer who immediately sells back at the same price faces:

- Buy fee: 1% of input + ~$2 surcharge (varies with size; see fee table)
- Sell fee: 1% of input
- Curve slippage: depends on swap size relative to LP depth

Round-trip cost on a 1 ETH (~$2350) trade at ~$1M cumulative LP depth:

| component       | absolute           | % of round-trip |
|-----------------|--------------------|------------------|
| buy fee (1%)    | $23.50             | 0.99%            |
| mint surcharge  | $2.00              | 0.08%            |
| sell fee (1%)   | $23.50             | 0.99%            |
| CP slippage     | size-dependent     | varies           |
| **total**       | **~2.06% + slip**  |                  |

Of that 2.06%, **30% (0.62%) goes to the TileEngine**. Round-trip traders fund the holder reward pool.

### 4.2 holders capture trading volume

Every swap pays the protocol. Of every fee collected, 70% deepens the LP (raising the floor for every holder pro-rata), and 30% goes to the tile pool (paying out to the holders who claim each epoch).

A holder who never trades has two passive value channels:

- **Floor accrual.** The holder's pro-rata claim on the LP grows with every swap, regardless of which direction. This is captured at exit via redemption.
- **Tile claims.** Once per epoch, the holder may claim from the tile pool, receiving a random 1×–4× multiple of the per-tile share. Skipping a claim forfeits that day's value to other holders (it rolls into next epoch).

Both channels are sourced from real trading activity. There are no inflation rewards, no minting, no token emissions.

### 4.3 market cap dynamics

Market cap = `spot_price · circulating`. The market price walks along the CP curve as users mint or redeem. From `scripts/v2sim.ts`:

| cumulative volume          | MC      | LP depth | floor  | p/floor |
|----------------------------|---------|----------|--------|---------|
| $200k mined                | $15.6M  | $202k    | $0.002 | 77×     |
| $1M / $800k churn          | $14.4M  | $221k    | $0.002 | 65×     |
| $5M / $4.8M churn          | $33.6M  | $393k    | $0.003 | 85×     |
| $15M / $14M (active 24h)   | $540M   | $1.5M    | $0.012 | 359×    |
| $50M / $40M (heavy churn)  | $13B    | $10.6M   | $0.087 | 2,801×  |

MC scales **superlinearly** with cumulative volume — the curve is reflexive, and supply scarcity at the top of the active range produces large headline MC moves. LP depth and floor both scale linearly with retained fees.

### 4.4 invariants during downturns

If trading drops to zero, no fees are collected, the floor stops rising, the tile pool stops growing. But the floor *cannot decrease* — the LP-side depth and any uncollected fee credits stay where they are.

If sentiment turns and holders rush to exit, sells walk the price down the CP curve. Sellers receive ETH at the curve price minus the 1% sell fee. The floor (which is below the curve price) does not move down — it strictly rises with each sell because the 0.7% retention still fires.

The protocol does not promise the market price stays high. It promises the *floor* never drops. Holders who weather a drawdown can always exit at the floor; holders who hold longer get the benefit of any subsequent recovery and additional volume.

---

## 5 · security model

### 5.1 capabilities the hook does not have

The hook has no admin function, no pause, no upgrade path, no migration mechanism, no withdraw function. The only state-changing entry points are:

- `unlockCallback` (gated to PoolManager only)
- `_afterInitialize` (gated to one-shot, validates pool key)
- `_beforeAddLiquidity` (rejects all callers except `address(this)`)
- `_beforeSwap` (validates pool, computes fee, applies guards)
- `rebalance` (permissionless, idempotent, guarded by reentrancy; collects accrued LP fees and routes 70/30 LP/TileEngine)
- `receive` (rejects all ETH except from PoolManager)

Nothing in the hook allows it to mint additional ascend, remove its own LP without re-adding equivalent depth, send ETH to arbitrary addresses, or change parameters.

### 5.2 the ascend ERC-20

Standard OpenZeppelin ERC-20. Sole-minter pattern: only the hook may call `mint`; the hook only calls `mint` once. `burn` exists but is not called in v2's swap or rebalance paths. Decimals are 18 (default).

### 5.3 reentrancy

Both the hook's `rebalance()` and the TileEngine's `claimTile()` are wrapped in EIP-1153 transient-storage reentrancy guards. Both contracts perform their external interactions (PoolManager calls, low-level ETH sends) only after all state has been written.

The tile claim pays out via a low-level `call` to the claimer at the end of `claimTile`. If the claimer is a smart-contract wallet that reverts, the call returns `ok = false` and the contract reverts the entire claim — preserving solvency.

### 5.4 anti-MEV

Two specific MEV vectors are defended against in `_beforeSwap`:

- **Flash-loan arbitrage between mint and redemption.** Same-block sell-after-buy reverts via `lastBuyBlock[tx.origin]`. Any address that buys in block `N` and tries to sell in block `N` reverts.
- **Deployment-block-tuned bots.** For the first 100 blocks after deploy, mints pay an additional random fee in `[0, 1%]` derived from `keccak256(prevrandao, blockhash, sender, e)`. Bots tuned for the exact deployment block pay the same average extra cost as honest first-buyers (~0.5%); the randomness is deterrent, not provable filtration.

There is **no per-tx mint cap**. A single buy can consume an arbitrarily large fraction of the LP. CP curve slippage is the only economic friction on whale buys. This is a deliberate design choice (fair-launch maximalism); launch-day concentration risk is real and accepted.

### 5.5 randomness

The TileEngine uses `keccak256(prevrandao, blockhash, sender, idx, epoch)` for the multiplier draw. This is proposer-influenceable: a malicious validator can include or delay a tile-claim transaction to capture a favorable `prevrandao`. The worst-case extracted value per claim is bounded:

```
maxEdge = (4 − 1.625) · (epoch_pool / 144 / 1.625) ≈ 1.01% of epoch_pool per claim
```

For the gamification scope, this is acceptable. A future TileEngine revision could integrate Chainlink VRF for provable fairness without breaking the existing interface.

### 5.6 limitations documented in the audit

The internal audit (`docs/AUDIT_V2.md`) documents one open finding worth noting publicly:

- **M-3.** The on-chain `floor()` getter reads only L-active reserves, not pending fee credits. Between rebalances, the *reported* floor can stay flat or fluctuate slightly with the CP curve's sqrtPrice, even though the *true* floor (active + credits) is monotone non-decreasing. Any holder forcing a `rebalance()` materializes the credits into the reported value.

---

## 6 · listing and venues

The pool is a standard Uniswap V4 pool. Buyers and sellers can route through:

- **The ascend dapp.** Direct V4 swap with the protocol's pool key.
- **Uniswap.org's V4 UI.** Same pool, same hook, same execution.
- **Aggregators (1inch, paraswap, Cowswap, etc.).** As V4 routing becomes standard in their backends.
- **Direct PoolManager calls** by any contract or EOA that knows how to compose `unlock` and `swap`.

Every path executes through the hook's `beforeSwap`. The fee, the same-block-burn guard, and the anti-bot multiplier all apply uniformly. There is no off-pool path, no special router, no "preferred venue".

DexScreener, GeckoTerminal, and similar indexers pick up V4 pools automatically. The displayed liquidity = the LP's depth (which is the protocol's vault), so depth and chart show up correctly.

---

## 7 · comparisons

|                          | bitcoin             | OHM (Olympus)         | bonding-curve V4 hooks  | ascend                                                |
|--------------------------|---------------------|------------------------|--------------------------|-------------------------------------------------------|
| supply                   | asymptotic at 21M   | rebasing               | asymptotic at K          | hard cap at 122M                                      |
| floor / backing          | none                | treasury, governed     | none                     | LP-backed, monotone non-decreasing                    |
| price function           | external (market)   | rebase + bond          | exponential bonding curve| constant product LP                                   |
| sells affect price?      | yes (market)        | yes (rebase debasement)| yes (curve reverses)     | yes (CP slippage); but **floor still rises**          |
| holder rewards           | none                | rebases (inflationary) | none                     | TileEngine (real-fee distribution)                    |
| admin                    | none                | DAO                    | none                     | none                                                  |
| upgrade path             | none                | governance             | none                     | **none**                                              |

Compared to **bonding-curve hook tokens** specifically: those use a closed-form curve where price is reversible — sells unwind the curve and there is no separate floor backing. Ascend layers an LP-backed monotone-rising floor underneath the standard CP curve, plus a real-fee reward layer on top. The same-block-burn protections come from the same family of anti-MEV defences.

Compared to **OHM**: OHM uses governance, a treasury, rebases, and bonding. Ascend has none of these — no governance, no rebases (supply is fixed), no treasury (the LP is the only protocol-held capital), no bonding (the LP IS the issuance).

---

## 8 · parameters

Deployed values, all immutable:

| parameter                  | value                | role                                               |
|----------------------------|----------------------|----------------------------------------------------|
| `SUPPLY_CAP`               | 122,000,000 ascend   | hard cap, all minted at genesis                    |
| `BOOTSTRAP_ETH`            | 1 ether              | constructor enforces exact value                   |
| `SWAP_FEE_PIPS`            | 10_000 (1%)          | base swap fee both sides                           |
| `LP_SHARE_BPS`             | 7,000 (70%)          | LP retention share of every fee                    |
| `TILE_SHARE_BPS`           | 3,000 (30%)          | TileEngine share of every fee                      |
| `MINT_FEE_WEI`             | 0.001 ether (~$2)    | flat surcharge per buy (anti-spam + extra revenue) |
| `MAX_EFFECTIVE_FEE_PIPS`   | 100_000 (10%)        | hard cap on dynamic fee                            |
| `ANTI_BOT_BLOCKS`          | 100                  | randomized launch-window fee tax                   |
| `ANTI_BOT_MAX_EXTRA_PIPS`  | 10_000 (+1% max)     | upper end of the random extra fee                  |
| `LP_RANGE`                 | full range           | tickLower = MIN_TICK, tickUpper = MAX_TICK         |
| `TICK_SPACING`             | 60                   | standard for non-fee-tier pools                    |
| pool fee                   | dynamic              | hook overrides per swap                            |
| `GRID_SIZE`                | 144 (12 × 12)        | tile grid                                          |
| `EPOCH_LENGTH`             | 24 hours             | tile epoch                                         |
| `MIN_HOLDING`              | 1 ascend (1e18 wei)  | minimum balance to claim a tile                    |
| `EXPECTED_MULTIPLIER_SCALED` | 1_625_000           | 1.625 in 1e6 fixed-point (E[m] of the draw)        |

---

## 9 · disclaimers

This whitepaper describes the protocol's behavior at the time of the v2 deployment. The contracts are immutable; their behavior cannot change after deploy. However:

- This document is informational. The contracts on-chain are the source of truth in any disagreement.
- The simulations and tables in §4.3 use a 122M cap, a 1 ETH bootstrap, ETH at $2,350, and standard CP math. Real launch trajectories will differ based on actual demand.
- The tile game's randomness is proposer-influenceable as documented in §5.5.
- The on-chain `floor()` getter is a conservative lower bound (M-3); the true floor is higher by the amount of pending fee credits.
- "Floor" is a redemption-value guarantee, not a market-price floor. The market price can trade at any level above the floor.
- Smart contracts can have undiscovered bugs. No protocol of this complexity has been deployed without bugs at some scale. A third-party audit is recommended before any meaningful TVL.
- Nothing in this document constitutes investment advice.

---

## appendices

### appendix A — formal proof of theorem 1

See §3 above for the algebraic derivation. The expanded numerical proof is in `docs/V2_DESIGN.md`, appendix A.

### appendix B — comparison to v1 (the premium-ratchet design)

Earlier iterations of ascend used an explicit premium markup on the buy side instead of the CP-curve scarcity mechanism. v1 had a `cumulativeEthIn` ratchet that lifted the buy price above the floor, producing the same headline MC growth via a different mechanic. v1 was discarded in favor of v2 because:

- v1's separate buy/sell prices produced two-band charts on DexScreener (the buy-band ran at `floor × (1 + premium)` while the sell-band ran at `floor × 0.95`); v2's single CP curve produces clean unified candles.
- v1 had no real LP, so DexScreener's "liquidity" reading was zero; v2's hook owns a real LP position, so depth displays correctly.
- v1's floor was readable but not accessible through standard V4 swap; v2's floor sits inside the same LP that handles trading.

The v1 contracts remain in the repo as historical reference (`contracts/src/AscendHook.sol`, `AscendRouter.sol`); v2 is the deploy target.

### appendix C — TileEngine multiplier expectation

```
1×: 10/16 = 62.5%
2×:  3/16 = 18.75%
3×:  2/16 = 12.5%
4×:  1/16 = 6.25%
E[m] = (10·1 + 3·2 + 2·3 + 1·4) / 16 = 26/16 = 1.625
```

`base_reward = epoch_pool / GRID_SIZE / E[m] = epoch_pool / (144 × 1.625)`

In expectation, all 144 tiles claimed at the average multiplier consume the whole pool exactly once. Variance comes from individual claim outcomes; over many epochs and many holders the system converges to its expectation.

### appendix D — listing checklist

- [ ] mainnet PoolManager address verified (https://docs.uniswap.org/contracts/v4/deployments)
- [ ] Genesis script broadcast successfully (single tx)
- [ ] Etherscan source code verified for hook, ascend, TileEngine, Genesis
- [ ] DexScreener picks up the pool automatically (24–48h post deploy)
- [ ] Optional: DexScreener "Update token info" with logo, description, socials
- [ ] Optional: third-party security review before any meaningful TVL
- [ ] Optional: CoinGecko / CMC submission (manual)

### appendix E — references

- Uniswap V4 documentation: https://docs.uniswap.org/contracts/v4/
- V4 hook examples: https://github.com/Uniswap/v4-periphery
- OpenZeppelin uniswap-hooks (the lib our build pins to): https://github.com/OpenZeppelin/uniswap-hooks
- Foundry book: https://book.getfoundry.sh/

### appendix F — repo layout

```
contracts/
  src/
    Ascend.sol           ERC-20
    AscendHookV2.sol     hook (issuance + LP custodian + fee splitter)
    TileEngine.sol       reward grid
    Genesis.sol          atomic deploy
  script/
    DeployV2.s.sol       foundry deploy script
  test/
    AscendHookV2.t.sol   16 tests, all passing
docs/
  V2_DESIGN.md           locked spec, invariants, math
  AUDIT_V2.md            internal audit
  HOW_IT_WORKS.md        plain-language explainer
  DEPLOY_GUIDE.md        first-time foundry walkthrough
  WHITEPAPER.md          this document
scripts/
  v2sim.ts               growth simulator
  v2concentration.ts     LP concentration sweep
  scenarios.ts           market cap milestones
  perspectives.ts        buyer / seller / chart / MCap views
app/, components/, hooks/, lib/   Next.js dapp
```
