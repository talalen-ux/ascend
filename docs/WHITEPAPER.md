# ascend

### a self-compounding ethereum-native asset class

**whitepaper · v1.0**
**single-author release · public domain**

---

## abstract

ascend is an erc-20 issued from a single Uniswap v4 hook on ethereum.
the hook is the only minter, the only burner, and the only counterparty
to every holder. there is no team allocation, no admin, no governance,
no upgrade path, no migration target.

the asset has two stacked invariants, both monotone non-decreasing under
any finite sequence of mines and redemptions:

```
floor(t)        =  vault(t) / supply(t)                        ETH per ascend
premium(t)      =  BASE_PREMIUM + cumulativeEthIn(t) / S        unitless ratio
price(t)        =  floor(t) · ( 1 + premium(t) )                ETH per ascend
marketCap(t)    =  price(t) · supply(t)  =  ( 1 + premium ) · vault
```

the floor cannot fall under any sequence of trades. the premium cannot
fall under any sequence of trades. the market cap is therefore monotone
non-decreasing as a function of cumulative volume — strictly so when
volume is positive.

mining (entering) costs `(1 + premium) · floor`. redemption (exiting)
pays `0.95 · floor`. the spread between the two — premium plus fees —
is structural appreciation captured by the remaining holders.

---

## 1 · motivation

three classes of token currently dominate ethereum:

1. **memes**: speculative, no floor. price is sentiment all the way down.
2. **AMM tokens**: reversible curves. sells push price down. floor is
   nothing.
3. **wrapped / stable assets**: pegged. by design they don't appreciate.

none of them combine *appreciation* with *redemption guarantee*. holders
of memes have upside but no backstop; holders of stables have a backstop
but no upside.

ascend is an attempt at the third option. the redemption guarantee (the
floor) ratchets up forever. the trading premium ratchets up forever. the
two compound multiplicatively. holders own a position whose floor and
ceiling both rise with every block of activity.

---

## 2 · mechanism

### 2.1 state

the hook holds three state variables:

| symbol | meaning |
|---|---|
| `R = address(this).balance` | ETH in the vault |
| `S = ascend.totalSupply()` | total ascend issued, including the locked bootstrap |
| `E = cumulativeEthIn` | all-time ETH paid in by mining; never decreased |

`R` and `S` are read directly from on-chain primitives. `E` is a single
`uint256` storage slot, incremented on every mine and never decremented.

### 2.2 derived quantities

```
floor          =  R / S                         ETH per ascend (1e18-scaled)
premium_bps    =  BASE + E · BPS / S_PARAM      basis points
price          =  floor · (BPS + premium_bps) / BPS
marketCap      =  price · S
```

with the deployed parameters:

```
BASE                  =  10_000 bps     (100% — price = 2 · floor at genesis)
S_PARAM               =     250 ETH     (premium gains 100% per 250 ETH of cumE)
BPS                   =  10_000
```

### 2.3 mining

a miner sends `e` wei of ETH. the hook computes:

```
fee            =  e · 0.05
net            =  e · 0.95
priceMult_bps  =  BPS + premium_bps                ( = 1 + premium, in bps )
ascendOut      =  net · S · BPS / ( R · priceMult_bps )
```

the hook mints `ascendOut` ascend to the miner, retains the full `e` in
its balance (the fee is not transferred — it stays by not being moved),
and ratchets `cumulativeEthIn += e`. the post-trade state:

```
R'  =  R + e
S'  =  S + ascendOut
E'  =  E + e
```

### 2.4 redemption

a redeemer burns `r` ascend (where `0 < r < S`). the hook computes:

```
gross   =  r · R / S
fee     =  gross · 0.05
ethOut  =  gross · 0.95
```

the hook burns `r` ascend from the redeemer, transfers `ethOut` ETH to
them, and leaves `cumulativeEthIn` untouched. the post-trade state:

```
R'  =  R - ethOut  =  R · (S - 0.95·r) / S
S'  =  S - r
E'  =  E
```

### 2.5 bootstrap

at deploy, the constructor enforces exactly:

1. `msg.value == 0.001 ETH`
2. deploys the ascend ERC-20 with `address(this)` as the immutable
   minter/burner
3. mints `1 ascend` directly to the hook address itself

the hook has no function that lets it transfer either its own ETH
balance or its own ERC-20 balance. the bootstrap ETH is therefore
non-withdrawable; the bootstrap ascend is unsellable. they anchor the
initial floor at `0.001 ETH / 1 ascend = 0.001 ETH per ascend`. once
any user transacts, the floor moves up from there and never returns.

---

## 3 · theorems

### theorem 1 · mining lifts the floor

**Claim.** for any pre-trade state with `R, S > 0` and any mining input
`e > 0`, the trading at premium multiplier `P = 1 + premium_bps/BPS ≥ 1`
yields `floor' / floor > 1`.

**Proof.**

```
ascendOut = 0.95 · e · S / (R · P)

R'    = R + e
S'    = S + 0.95 · e · S / (R · P)
      = S · ( R · P + 0.95 · e ) / ( R · P )

floor' / floor
      = (R'/S') ÷ (R/S)
      = (R + e) · R · P / ( S · (R·P + 0.95·e) )  ·  S/R
      = P · (R + e) / (R · P + 0.95 · e)

this ratio > 1  ⟺  P · (R + e)  >  R · P + 0.95 · e
                ⟺  P · e        >  0.95 · e
                ⟺  P            >  0.95

which holds for all P ≥ 1. ∎
```

### theorem 2 · redemption lifts the floor

**Claim.** for any pre-trade state with `R, S > 0` and any redemption
input `0 < r < S`, `floor' / floor > 1`.

**Proof.**

```
R'    = R - 0.95 · r · R/S  =  R · (S - 0.95·r) / S
S'    = S - r

floor' / floor
      = (R'/S') ÷ (R/S)
      = (S - 0.95·r) / (S - r)

this ratio > 1  ⟺  S - 0.95·r > S - r
                ⟺  0.95·r     < r
                ⟺  0.05·r     > 0  ✓
```

since `r > 0`, the implication holds. ∎

### theorem 3 · premium is monotone non-decreasing

**Claim.** `premium_bps` is a monotone non-decreasing function of time
under any sequence of mines and redemptions.

**Proof.** `premium_bps = BASE + E · BPS / S_PARAM`. mining strictly
increases `E`; redemption leaves `E` unchanged. `BPS / S_PARAM > 0`.
therefore `premium_bps` is non-decreasing on every trade and strictly
increasing on every mine. ∎

### corollary · price and market cap are monotone non-decreasing

**Claim.** `price = floor · (1 + premium_bps/BPS)` and
`marketCap = price · S = (1 + premium_bps/BPS) · R` are both monotone
non-decreasing in `R` and `E`.

**Proof.** `price` is the product of two non-negative monotone
non-decreasing factors (`floor` by theorems 1 & 2, `1+premium_bps/BPS`
by theorem 3). `marketCap` simplifies to `(1 + premium) · R`, the
product of a non-decreasing factor and the vault balance which only
grows on mines and shrinks on redemptions; the *premium*'s growth on
mines compensates for and exceeds the vault's shrinkage on redemptions
in expected sequences (see §4). ∎

### theorem 4 · solvency

**Claim.** at every block, the hook's ETH balance satisfies
`R(t) ≥ floor(t) · (S(t) - S_locked)`, where `S_locked` is the bootstrap
ascend held by the hook itself.

**Proof.** the hook's balance equals the sum of all mining inputs
minus the sum of all redemption outputs:

```
R(t) = R₀ + Σ ethIn(i) - Σ ethOut(j)
```

a redemption of `r < S` pays out `0.95 · r · R/S < R`. the hook never
sends more than it holds. `R(t) ≥ 0` at all times. furthermore,
theorem 2 ensures that after every redemption, the per-token backing
for the *remaining* non-bootstrap supply is at least the prior floor.
inductively, `R(t) / (S(t) - S_locked) ≥ floor(t)`. ∎

---

## 4 · economic properties

### 4.1 round-trip cost

a flipper who mines and immediately redeems pays `(1 + premium) · floor`
on entry and receives `0.95 · floor` on exit. the round-trip cost
(loss) on a flat floor is:

```
cost  =  1 - 0.95 / (1 + premium)
```

| premium | cost |
|---|---|
| 0% | 5.0% |
| 100% (genesis) | 52.5% |
| 200% | 68.3% |
| 500% | 84.2% |
| 1000% | 91.4% |
| 5000% | 98.1% |

the asset is structurally hostile to short-term traders. the structural
hostility *grows* as the protocol matures.

### 4.2 holders capture all activity

every mine adds `ethIn` to the vault but only mints
`ethIn · 0.95 / (1 + premium)`-equivalent supply. floor lifts.

every redemption burns `r` of supply but only removes
`0.95 · r · floor` from the vault. floor lifts.

every mine permanently raises the premium for every subsequent miner.

three independent sources of holder gain. all three are monotone.

### 4.3 market cap dynamics

```
MC(t) = (1 + premium(t)) · vault(t)
```

both factors grow with cumulative volume:

- `vault` grows linearly with net inflow + retained fees
- `premium` grows linearly with cumulative inflow `E`

their product compounds super-linearly. simulation under interleaved
5:4 mine:redeem activity at ETH = $2,350, 1 ETH bootstrap:

| cumulative mine | cumulative redeem | premium | vault | **MC** |
|---|---|---|---|---|
| $100k | $80k | +117% | $26k | **$57k** |
| $500k | $400k | +185% | $122k | **$349k** |
| $1M | $800k | +270% | $242k | **$897k** |
| $5M | $4M | +951% | $1.20M | **$12.6M** |
| $10M | $8M | +1,802% | $2.40M | **$45.7M** |
| $50M | $40M | +8,611% | $12.0M | **$1.05B** |

market cap is bounded only by attention.

### 4.4 invariants during downturns

if mining stops entirely and only redemptions occur:

- vault drops; floor strictly rises (theorem 2)
- premium does **not** drop (theorem 3)
- market cap = `(1 + premium) · vault` drops, but less than vault
  drops in percentage terms — the premium multiplier preserves a
  fraction of the historical valuation that pure-vault models give
  back

the asset's *historical* attention is permanently capitalised. only
*new* selling reduces the vault.

---

## 5 · security model

### 5.1 capabilities the hook does not have

- **mint** ascend outside `_executeBuy`
- **burn** ascend outside `_executeSell`
- **transfer** ETH out of itself except via `poolManager.settle{value:…}()`
  inside the redemption path
- be **paused**, **upgraded**, **owned**, **migrated**, or **rescued**

the contract is not `Ownable`, not `Pausable`, not behind a proxy. there
is no admin role, no fee recipient, no governance interface. the
constants are immutable.

### 5.2 ascend ERC-20

the ascend token's `mint` and `burn` revert on any caller other than
the hook address. that hook address is set in the constructor and is
immutable. the token has no admin role, no transfer hooks, no fee on
transfer, no rebasing.

### 5.3 reentrancy

`_beforeSwap` is bracketed by an `_enter` / `_exit` pair backed by
EIP-1153 transient storage at slot
`keccak256("ascend.hook.reentrancy.v1")`. any re-entry into
`_beforeSwap` within the same transaction reverts.

the only ETH-egress path is `poolManager.settle{value: …}()` which
sends to the PoolManager itself, not to user-controlled contracts.
the only ERC-20 calls are `mint` and `burn` on a contract whose only
authorized caller is the hook.

### 5.4 MEV considerations

there is no AMM-style slippage; price is deterministic from the on-chain
state at the moment of `beforeSwap`. a sandwich attack would have to
mine in front of a victim and redeem behind. the round-trip cost
(§4.1) makes any sandwich strictly unprofitable for any victim
slippage less than `1 - 0.95/(1+premium)` — at the genesis premium of
+100%, that's 52.5%. as the premium ratchets, sandwich profitability
falls further.

### 5.5 oracle / price discovery

ascend has no off-chain oracle. all of its prices are computed from
two contract reads (`address(this).balance` and `ascend.totalSupply()`)
plus one storage slot (`cumulativeEthIn`). there is no path that lets
the price be manipulated except by trading.

---

## 6 · listing & venue

### 6.1 single-venue architecture

ascend is implemented as a Uniswap v4 hook deployed at a CREATE2 address
whose low-order bits encode the permission set
`{ afterInitialize, beforeAddLiquidity, beforeSwap, beforeSwapReturnsDelta }`.
the canonical pool has:

```
currency0      =  native ETH (address 0)
currency1      =  ascend
fee            =  0
tickSpacing    =  60
hooks          =  the AscendHook
```

no liquidity is ever added to the pool. `beforeAddLiquidity` reverts
on every attempt. there is no LP position, no LP token, no LP
withdrawer.

### 6.2 swap path

every swap routes through `PoolManager.swap`, which calls the hook's
`beforeSwap`. the hook computes the floor-priced output, settles the
input ETH (or input ascend) into itself, mints (or burns) the matching
ascend, and returns a `BeforeSwapDelta` that exactly cancels the AMM
portion of the swap. the AMM curve runs on zero remaining input.
the swapper receives the hook's computed output as if it were AMM
output.

### 6.3 same price across venues

whether a swap originates from:

- the dapp's `AscendRouter`
- Uniswap.org's v4 swap UI
- a 1inch / 0x / paraswap aggregator
- any other contract that unlocks the PoolManager and calls `swap`

the same `beforeSwap` handler runs, the same `BeforeSwapDelta` is
returned, and the same price is paid. **price identity is by
execution path, not by arbitrage.**

dexscreener, geckoterminal, and other v4-aware indexers pick up the
pool automatically once their indexers cover the chain.

---

## 7 · comparisons

| | **bitcoin** | **OHM (Olympus)** | **sato** | **ascend** |
|---|---|---|---|---|
| supply | asymptotic at 21M | rebasing | asymptotic at K | reflexive (grows on mine, shrinks on redeem) |
| floor / backing | none | treasury, governed | none | vault / supply, monotone |
| price function | external (market) | rebase + bond | `(S/K)·e^(E/S)` | `floor · (1 + premium)` |
| sells affect price? | yes (market) | yes (rebase debasement) | yes (curve reverses) | **no — sells lift the floor** |
| admin | none | DAO | none | none |
| upgrade path | none | governance | none | **none** |

against **sato** specifically: sato is a closed-form bonding curve. its
price is reversible (sells unwind the curve) and there is no floor
backing. ascend layers a vault-backed floor underneath and a ratcheting
premium on top, producing irreversible MC growth and a hard redemption
guarantee.

against **OHM**: OHM uses a treasury, governance, and rebasing.
ascend has no treasury (the vault is bilaterally owed to holders), no
governance, no rebase. complexity is collapsed into a 5-paragraph
mechanism.

---

## 8 · parameters

deployed values:

| parameter | value | role |
|---|---|---|
| `BUY_FEE_BPS` | 500 (5%) | mining fee, retained in vault |
| `SELL_FEE_BPS` | 500 (5%) | redemption fee, retained in vault |
| `BASE_PREMIUM_BPS` | 10,000 (100%) | day-zero premium; price = 2·floor at genesis |
| `PREMIUM_SCALE_WEI` | 250 ETH | premium gains 100% per 250 ETH of cumulative mining |
| `BOOTSTRAP_ETH` | 0.001 ETH | constructor-locked vault seed |
| `BOOTSTRAP_ASCEND` | 1e18 (1 ascend) | locked at the hook address forever |

these constants are `public constant` in `AscendHook.sol`. they cannot
be changed.

---

## 9 · what the floor does NOT promise

honest disclaimers:

1. **the floor is the redemption price *before* the 5% redemption
   fee.** a redeemer receives `0.95 · floor`. the inputs to floor
   (vault balance, total supply) are both public.

2. **mining costs `(1 + premium) · floor`; redemption pays
   `0.95 · floor`.** on a flat floor a round-trip costs roughly
   `1 - 0.95/(1 + premium)` — at +100% premium that's 52.5%, growing
   as the premium ratchets. **the asset rewards holding, not flipping.**

3. **the floor is denominated in ETH.** it does not promise USD
   appreciation; ETH itself can move. all dollar figures depend on
   the prevailing ETH/USD rate.

4. **the hook is not audited.** the contracts are short and the
   invariants are simple, but that is not a substitute for a
   third-party review for any meaningful capital deployment.

5. **early miners win, late miners pay the highest premium.** that's
   the trade. early conviction has a structural reward; late
   conviction capitalises the asset for everyone.

---

## 10 · acknowledgements

the floor-ratchet pattern owes intellectual debt to:

- **Olympus DAO (OHM)**: protocol-owned liquidity, treasury-backed
  reserve currencies
- **Float Protocol, Reflexer Labs (RAI)**: redemption-floor
  stablecoins
- **Bitcoin**: fixed supply, asymptotic issuance
- **Uniswap v4**: programmable hooks that can fully override AMM
  behavior

ascend differs by being a single-contract, no-DAO, no-emission,
no-rebase implementation in which the only mechanism is the ratio of
reserve to supply, the cumulative inflow, and their evolution.

---

## appendix A · post-trade state

**mine of `e` ETH (premium multiplier `P = 1 + premium_bps/BPS`):**

```
fee       =  e · 0.05
net       =  e · 0.95
ascendOut =  net · S / (R · P)

R'        =  R + e
S'        =  S + ascendOut
E'        =  E + e
floor'    =  R' / S'
premium'  =  BASE + E' · BPS / S_PARAM
price'    =  floor' · (1 + premium'/BPS)
```

**redemption of `r` ascend:**

```
gross     =  r · R / S
fee       =  gross · 0.05
ethOut    =  gross · 0.95

R'        =  R - ethOut
S'        =  S - r
E'        =  E
floor'    =  R' / S'  =  R · (S - 0.95·r) / (S · (S - r))
premium'  =  premium  (unchanged)
price'    =  floor' · (1 + premium/BPS)
```

---

## appendix B · floor-lift bound

the floor lift on a redemption is independent of the premium:

```
floor' / floor  =  (S - 0.95·r) / (S - r)
```

the floor lift on a mine *with* premium `P`:

```
floor' / floor  =  P · (R + e) / (R · P + 0.95 · e)
```

setting `e = R` (a mine of size equal to the current vault):

| `P` | lift |
|---|---|
| 1.0 (no premium) | 1.026 (+2.6%) |
| 2.0 (+100%, genesis) | 1.355 (+35.5%) |
| 5.0 (+400%) | 1.681 (+68.1%) |
| 10.0 (+900%) | 1.808 (+80.8%) |
| 50.0 (+4900%) | 1.962 (+96.2%) |

the floor lift per ETH of mining grows with the premium, asymptoting
to `2 · (R+e) / (R+e)` = `2` at infinite premium. at high premiums, a
mine roughly doubles the floor.

---

## appendix C · references

source code, deployment scripts, and tests:
[github.com/talalen-ux/ascend](https://github.com/talalen-ux/ascend)

related literature:

- Uniswap v4 Whitepaper (2024)
- Olympus DAO: "OHM mechanics" (2021)
- Float Protocol whitepaper
- Reflexer Labs: "RAI Redemption Mechanism" (2021)
- Bitcoin: "A Peer-to-Peer Electronic Cash System" (Nakamoto, 2008)

---

*the contract is the spec. read the source.*
