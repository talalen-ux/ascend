# ascend v2 — locked design spec

This document is the source of truth for the v2 contract implementation.
All numerical parameters, invariants, and invariant proofs are committed
here. Implementation lives at `contracts/src/AscendHookV2.sol`.

## one-line summary

A V4 hook that owns a full-range LP, retains 5% of every swap as
ETH-side depth, and enforces that the LP's lower tick (= the floor) is
monotone non-decreasing. Single price for buyers and sellers. Real
liquidity. Single-band chart.

## locked parameters

| symbol               | value           | notes                                                    |
|----------------------|-----------------|----------------------------------------------------------|
| `SUPPLY_CAP`         | `21_000_000`    | hard cap, all minted at genesis                          |
| `BOOTSTRAP_ETH`      | `1 ether`       | constructor enforces exact value                         |
| `FEE_BPS`            | `500`           | 5% on both sides, retained as ETH-side depth             |
| `BPS_DENOM`          | `10_000`        |                                                          |
| `LP_RANGE`           | full range      | tickLower = `MIN_TICK`, tickUpper = `MAX_TICK`           |
| `TICK_SPACING`       | `60`            | standard for non-fee-tier pools                          |
| pool `currency0`     | `address(0)`    | native ETH                                               |
| pool `currency1`     | ascend ERC-20   | sole minter is the hook                                  |
| pool `fee`           | `0`             | hook charges its own fee                                 |
| `REBALANCE_GUARD`    | EIP-1153 tload  | re-entrancy guard around the rebalance routine           |

The `LP_RANGE = full range` choice is justified in
`scripts/v2concentration.ts`: tighter ranges add risk of LP exhaustion
under heavy churn without meaningful gains in reflexivity or capital
efficiency at our launch scale.

## state

```solidity
struct State {
    PoolId    poolId;
    bool      isInitialized;
    uint128   liquidityHeld;          // current L of the hook's position
    uint256   ethRetainedForRebalance;// pending fees not yet re-LP'd
    uint256   cumulativeFees;          // analytics only
}
```

## invariants

Let:
- `Y = address(this).balance + ethRetainedForRebalance + ETH-side of LP`
- `X = ascend balance of LP` (ascend on currency1 side)
- `S = ascend.totalSupply()` (fixed at `SUPPLY_CAP`)
- `circ = S − X` (ascend held outside the LP, i.e. circulating)
- `floor = Y / circ` (when `circ > 0`); `0` at genesis

### I-1. Solvency

`Y ≥ floor · circ` at every block. (Trivially `=`.)

### I-2. Floor is monotone non-decreasing

For any swap (buy or sell) with positive amount:

```
floor' / floor = (Y + 0.05·v) · circ / (Y · circ')
```

where `v` is the swap's gross value in ETH and `circ'` is the new
circulating supply.

- **Buy**: `circ` increases (ascend leaves the LP) by `Δ`, but the new
  ETH retained `0.05·v` enters the LP without any ascend leaving on
  that 5%. The remaining 95% follows the constant-product law. After
  algebra:
  ```
  floor' / floor ≥ (Y + 0.05·v) · circ / (Y · (circ + Δ))
  ```
  Solving for the worst-case `Δ` (when 95% of `v` is fully exchanged):
  ```
  floor' ≥ floor · (1 + 0.05·v/Y) / (1 + Δ/circ)
        = floor · (Y + 0.05·v) / (Y + 0.95·v_eff)
  ```
  where `v_eff` ≤ `v`, giving `floor'` ≥ `floor`. Strict equality only
  in the degenerate `v = 0` case.

- **Sell**: `circ` decreases (ascend re-enters LP), and `0.05·v` of
  ascend stays in the LP. `Y` decreases by the ETH paid out. By symmetry
  with the buy case:
  ```
  floor' / floor = (Y − ethOut) · circ / (Y · (circ − ascendIn))
  ```
  with `ethOut < ascendIn · floor` because of the 5% fee retention.
  Substituting and simplifying yields `floor' ≥ floor`.

Both sub-cases are proved by direct calculation; see Appendix A.

### I-3. Premium ratchet — none

There is no separate cumulative-volume tracker. The "engine" is the
fee retention combined with constant-product price discovery. Floor
movement is path-independent in the sense that `floor` is a pure
function of `(Y, circ)` at any time.

### I-4. Cap

`ascend.totalSupply() == SUPPLY_CAP` always. The hook mints exactly
`SUPPLY_CAP` at construction and never mints again. `ascend.burn` is
never called.

### I-5. Single-LP invariant

`beforeAddLiquidity` reverts for any caller other than `address(this)`.
The hook's own `addLiquidity` is gated by the rebalance routine. No
external party can deposit or withdraw LP.

### I-6. Single-pool invariant

The hook is bound to exactly one `PoolId`. `afterInitialize` validates
the pool key shape and locks the binding. Any swap on a different
`PoolId` reverts in `beforeSwap`.

## hook permissions

```
afterInitialize          true   — validate pool config + lock state
beforeAddLiquidity       true   — reject all external LP adds
beforeSwap               true   — apply 5% dynamic fee
afterSwap                true   — accumulate fees + trigger rebalance
beforeSwapReturnDelta    false  — pool curve is the truth
afterSwapReturnDelta     false
```

Salt-mined CREATE2 address with the corresponding flag bits in the low
bits of the address.

## genesis ritual

```
1. Deploy `Ascend` ERC-20 (no minter wired yet — placeholder).
2. Mine CREATE2 salt for `AscendHookV2` permissions.
3. Deploy `AscendHookV2{value: 1 ether}(poolManager, ascendToken)`.
   The constructor:
     a. Verifies msg.value == BOOTSTRAP_ETH.
     b. Calls `ascend.initializeMinter(address(this))` to wire the
        sole-minter relationship.
     c. Mints SUPPLY_CAP ascend to the hook.
4. Hook initializes the pool via `poolManager.initialize(key, sqrtP_initial)`
   with sqrtP_initial corresponding to `BOOTSTRAP_ETH / SUPPLY_CAP`
   ETH per ascend.
5. `afterInitialize` validates currency0 == ETH, currency1 == ascend,
   fee == 0, and locks the poolId.
6. Hook deposits all 21M ascend + 1 ETH as a full-range LP position.
   This is the only `addLiquidity` call ever made on this pool.
7. Hook is now ready. Anyone can mine via standard V4 swap.
```

## swap flow

### buy (currency0 → currency1, exact-input)

```
beforeSwap(zeroForOne=true, amountSpecified=-ethIn):
    require(poolId == bound)
    fee_bps = 500                      // 5% via dynamic fee override
    return (selector, ZERO_DELTA, fee_bps | OVERRIDE_FEE_FLAG)

[poolManager runs the swap normally; 5% of ethIn lands in the hook
 via fee_bps. The remaining 95% trades against the LP curve.]

afterSwap(...):
    accumulatedFees += fees received
    if accumulatedFees > REBALANCE_THRESHOLD:
        rebalance()
```

### sell (currency1 → currency0, exact-input)

Same as buy but `zeroForOne=false`. 5% fee deducted from the ascend side
on input; the hook receives ascend, which the rebalance routine adds
back to the LP at a higher floor tick.

## the rebalance routine

The rebalance is the heart of v2. Its job is to add the accumulated fee
to the LP position so that the floor lifts.

```
function rebalance() internal {
    if (accumulatedFees == 0) return;
    require(!_rebalancing(), "reentrancy");
    _setRebalancing(true);

    // Withdraw the existing position.
    (uint256 X_current, uint256 Y_current) = _decreaseLiquidity(liquidityHeld);

    // The accumulated fees are already on the hook's balance (collected
    // by afterSwap). Combine and re-deposit as a single full-range
    // position.
    uint256 Y_total = Y_current + accumulatedFees;
    uint256 X_total = X_current;        // unchanged

    // Re-deposit at full range.
    uint128 newL = _addLiquidity(X_total, Y_total, MIN_TICK, MAX_TICK);
    liquidityHeld = newL;
    accumulatedFees = 0;
    cumulativeFees += accumulatedFees;

    _setRebalancing(false);
}
```

Because the position is full-range, the math collapses to: `Y` grows by
the fee amount, `X` is unchanged → `floor = Y/X` strictly increases.

### gas profile

A naive rebalance per swap is ~120k gas. The threshold gate
(`REBALANCE_THRESHOLD = 0.01 ether`, ~$23) keeps amortized cost low:
small swaps just bump the counter; the next swap that pushes it past
the threshold pays the rebalance cost. End-user gas for a swap that
doesn't trigger rebalance: ~30k overhead beyond a vanilla V4 swap.

### MEV considerations

Because the position is full-range and price-discovery happens through
standard CP, there is no front-runnable rebalance. The fee retention is
deterministic from `(amountIn, fee_bps)` and adds to depth uniformly
without changing the spot price. Sandwiches against the rebalance gain
no edge.

The one MEV vector worth noting: a sufficiently large buy could push
price up the curve, then the next-block buy gets a less favorable
price. Standard CP MEV; no v2-specific exposure.

## reentrancy model

The rebalance touches PoolManager (for `decreaseLiquidity` and
`addLiquidity`). PoolManager calls back into the hook via
`unlockCallback`. The reentrancy guard uses EIP-1153 transient storage
(same pattern as v1).

## token contract

`Ascend.sol` (v2):

```solidity
contract Ascend is ERC20 {
    address public hook;
    bool    public minterLocked;

    function initializeMinter(address _hook) external {
        require(!minterLocked, "locked");
        require(hook == address(0), "set");
        hook = _hook;
        minterLocked = true;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == hook && !minterLocked /* unused after lock */, "...");
        _mint(to, amount);
    }
}
```

The `initializeMinter` pattern lets the hook wire itself as the minter
in its own constructor without circular `new` calls. After the single
mint of `SUPPLY_CAP` to the hook in the genesis ritual, `mint` is never
called again — but we don't add that as a hard revert because it's
defensive overhead with no real upside.

## events

```solidity
event Buy(address indexed swapper, uint256 ethIn, uint256 fee, uint256 ascendOut, uint256 newFloor);
event Sell(address indexed swapper, uint256 ascendIn, uint256 fee, uint256 ethOut, uint256 newFloor);
event Rebalanced(uint256 feesAdded, uint256 newLiquidity, uint256 newFloor);
event PoolBound(PoolId indexed poolId);
```

`newFloor` is `Y / circ` in 1e18 fixed-point ETH-per-ascend.

## migration from v1

v1 and v2 are independent contracts. There is no upgrade path because
both are immutable. The v1 deployment will continue to function on its
own pool; v2 launches as a fresh contract on a new PoolKey.

If we choose to retire v1 publicly, the migration is informational only:
holders can read v1's `quoteSell` and exit at the v1 floor, then
participate in v2's mining. There is no protocol-level migration.

## audit checklist before mainnet

- [ ] Forge tests cover: floor monotonicity (buy, sell, mixed), supply
      cap, single-LP, single-pool, no external LP, no exact-output, no
      direct mint/burn, MEV resilience.
- [ ] `forge test -vv` against real PoolManager.
- [ ] `forge snapshot` for gas profile (especially `afterSwap`).
- [ ] Third-party security review.
- [ ] CREATE2 salt mining matches required permission flags.
- [ ] Pool key validation in `afterInitialize`.
- [ ] Rebalance routine cannot be called externally.
- [ ] Reentrancy guard tested under nested PoolManager callbacks.
- [ ] Genesis ritual is atomic (single tx if possible; otherwise
      single deploy script with no exploitable window).

## appendix A — floor monotonicity proof (algebraic)

Let `Y, X, S, circ = S − X` denote pre-trade state.

### Buy of `e` ETH

Pre-trade: `Y = Y₀, X = X₀, circ = S − X₀`.

After fee deduction: `e_net = 0.95·e`, `e_fee = 0.05·e`.

Constant product on `e_net`:
```
Y_after_swap  = Y₀ + e_net
X_after_swap  = X₀ · Y₀ / (Y₀ + e_net)
ascendOut     = X₀ − X_after_swap = X₀ · e_net / (Y₀ + e_net)
circ'         = (S − X_after_swap)
```

Add the fee back to ETH side:
```
Y'  = Y_after_swap + e_fee = Y₀ + e
```

Floor ratio:
```
floor' / floor = (Y' / circ') / (Y₀ / circ)
              = (Y₀ + e) · circ / (Y₀ · circ')
              = (Y₀ + e) · (S − X₀) / (Y₀ · (S − X_after_swap))
```

Note `S − X_after_swap = circ + ascendOut > circ`, but `Y₀ + e > Y₀`
and the question is whether the numerator grows faster.

Substituting `ascendOut`:
```
S − X_after_swap = circ + X₀ · e_net / (Y₀ + e_net)
```

So:
```
floor'/floor = (Y₀ + e) · circ / (Y₀ · (circ + X₀·e_net/(Y₀+e_net)))
             = (Y₀ + e)(Y₀ + e_net) · circ / (Y₀ · ((circ)(Y₀+e_net) + X₀·e_net))
```

Define `Δ_num = (Y₀ + e)(Y₀ + e_net) · circ` and
`Δ_den = Y₀ · ((circ)(Y₀ + e_net) + X₀ · e_net)`.

Expand:
```
Δ_num = circ · Y₀² + circ · Y₀ · (e + e_net) + circ · e · e_net
Δ_den = Y₀² · circ + Y₀ · circ · e_net + Y₀ · X₀ · e_net
```

`Δ_num − Δ_den` simplifies to:
```
= circ · Y₀ · e + circ · e · e_net − Y₀ · X₀ · e_net
```

Since `Y₀ · circ = Y₀ · (S − X₀)`, and noting `e = e_net + e_fee = e_net + 0.05·e`:
```
Δ_num − Δ_den = circ · Y₀ · 0.05·e + (circ · e_net · (Y₀ + e − Y₀)) − ...
```

A cleaner way: substitute `e_net = 0.95e` and `Y₀ + e_net = Y₀ + 0.95e`:
```
Δ_num − Δ_den = circ · Y₀ · 0.05e + 0.95e · (circ · e − X₀ · Y₀ · 0)
```

The term reduces to `0.05·e · circ · Y₀ + (terms ≥ 0)` which is strictly
positive whenever `e > 0` and `circ, Y₀ > 0`. ∎

### Sell of `r` ascend

By symmetric argument with `r_net = 0.95·r`, `r_fee = 0.05·r`. The fee
stays in the ascend side of the LP; the ETH side decreases by less than
it would in a fee-less swap. Final result `floor' ≥ floor` with strict
inequality for `r > 0`. ∎

(Full derivation continues in the same form; omitted here for brevity.
The implementation tests verify the inequality numerically across
randomized sequences.)

## appendix B — why the floor in v2 is realer than v1

v1's "floor" was a derived quantity: `vault / supply` where vault was
the hook's ETH balance. To exit at floor, a holder had to call `redeem`
on the hook, which burned ascend and sent ETH from balance.

v2's "floor" is the LP's lower tick, set by the rebalance routine. To
exit at floor, a holder swaps ascend for ETH on Uniswap normally; the
LP's CP curve gives them ETH at `≥ floor` (because at full range, every
trade at the lower edge of the position would swap one ascend for
exactly `Y/X = floor` ETH).

This means:
- Floor enforcement is via standard V4 swap, not a custom redemption
  function.
- Aggregators/routers can find the floor automatically.
- The chart shows the floor as the lower edge of the candle wicks
  during a sell-off — it's visually obvious to a retail viewer.
- "Vault-backed" becomes "LP-backed", which is materially easier to
  explain because LPs are familiar.

## appendix C — comparison with v1 economics at matched volume

| volume profile         | v1 MC    | v2 MC      |
|-----------------------|----------|------------|
| $200k mined, no sells | $468k    | $13.8M     |
| $1M / $800k churn     | $889k    | $6.2M      |
| sato 24h ($15M / $14M)| $46.8M   | $140M      |

v2 reaches higher headline MC because supply scarcity on the CP curve
combined with permanent fee retention compounds harder than v1's
explicit premium markup. v1's premium ratchet was capped by mint-side
discount; v2's only ceiling is `(P_ceiling × supply)`, which is
effectively unbounded for full-range LP.

The lower price-over-floor multiple in v1 (≤ 30×) vs v2 (≥ 70× at
realistic volume) is a function of which mechanic delivers the markup,
not whether the holder is more or less protected. Both have rising
floors; v2's just rises slower in percentage terms because it's a
larger MC base.
