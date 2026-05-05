# ascend — audit pass v1

internal review by the author. not a substitute for a third-party audit.
findings ordered by severity.

## CRITICAL

### C-1 — router settle order breaks beforeSwap

**`contracts/src/AscendRouter.sol`** — `_doBuy` and `_doSell` call
`poolManager.swap(...)` *before* settling the input. But the hook's
`beforeSwap` calls `poolManager.take(currency0, hook, ethIn)` (or the
ascend equivalent for sells), which *physically transfers* the input
out of the PoolManager to the hook.

At swap time, the PoolManager doesn't have the input yet — the router
hasn't settled. `take` reverts with insufficient balance. **Every buy
and every sell through the router fails.**

Resolution: in the router, settle the input *before* calling swap.

```solidity
// _doBuy:
poolManager.settle{value: cb.amountIn}();   // ① pre-settle ETH to PM
BalanceDelta delta = poolManager.swap(...); // ② swap; hook can now take
poolManager.take(currency1, recipient, …);  // ③ take ascend output

// _doSell:
poolManager.sync(currency1);
ascend.transfer(address(poolManager), cb.amountIn);
poolManager.settle();                       // ① pre-settle ascend to PM
BalanceDelta delta = poolManager.swap(...); // ② swap
poolManager.take(currency0, recipient, …);  // ③ take ETH output
```

Fixed in this revision.

## HIGH

### H-1 — front-run race on pool initialization

The hook's `_afterInitialize` validates currencies and fee but binds to
*whatever pool* calls `initialize` first. A front-runner who watches the
hook deployment can call `PoolManager.initialize` with a non-canonical
`tickSpacing` (anything ≠ 60) before the legitimate deploy script gets
to it. The hook accepts it, sets `isInitialized = true`, and the canonical
deploy reverts.

Effect is mostly cosmetic — the hook overrides all swaps so tickSpacing
has no pricing effect. But the pool ID printed by the deploy script no
longer matches what's bound, breaking dapp config and Dexscreener URLs.

Mitigations (pick one):

1. **Constructor binds the tickSpacing.** Pass `expectedTickSpacing` to
   the constructor and reject non-matching keys in `_afterInitialize`.
2. **Atomic deploy + initialize.** Wrap the two ops in a single `Genesis`
   contract that, in its constructor, deploys the hook with `CREATE2` and
   immediately calls `PoolManager.initialize`. No human-front-runnable
   gap.

Recommendation: option 2. Adds one contract; gap closes.

## MEDIUM

### M-1 — exact-output swap path through `PoolManager` returns a misleading error

The hook's `_beforeSwap` has `if (params.amountSpecified > 0) revert
ExactOutputUnsupported();`. Good. But a sophisticated caller can split
an exact-output intent into multiple exact-input segments and binary-search
the input. Not an exploit — just a UX note: the hook genuinely doesn't
support "give me exactly X ascend" semantics. Documented in the whitepaper.

### M-2 — bootstrap ascend held by hook is included in `quoteSell`'s supply

`quoteSell` checks `ascendIn < supply`, where supply is the full ERC-20
total (including the 1 ascend locked in the hook itself). So a sell of
exactly `S - 1e18` is allowed, which would attempt to redeem all
non-bootstrap supply. After such a sell, the new floor would be
`reserve_remaining / 1e18`, which spikes upward — by design, since
the bootstrap is unsellable. No correctness issue, but the hook should
log a clearer error in the test path.

### M-3 — lost precision on tiny first buys

`ascendOut = (net * supply) / reserve`. With the bootstrap state
(`reserve = 0.001 ETH = 1e15 wei`, `supply = 1 ascend = 1e18 wei`), a
buy of 1 wei net with 1e15 reserve yields `(1 * 1e18) / 1e15 = 1000`
wei of ascend. Tiny but correct. Smaller bootstraps would round to
zero on tiny buys. If launching at a different bootstrap, verify the
minimum-buy resolution.

## LOW

### L-1 — `Currency.isAddressZero()` API stability

`_afterInitialize` uses `key.currency0.isAddressZero()`. Verify this
exists in the deployed v4-core version; if not, replace with
`Currency.unwrap(key.currency0) == address(0)`.

### L-2 — receive() reverts ETH from any sender other than PoolManager

Defensive, but it means an EOA can't accidentally fund the reserve. If
that's intended, fine — and it is, because such a donation would dilute
the per-token backing for the immediate buyer rather than for everyone.
But document it.

### L-3 — router has no slippage tolerance for the rare floor change between quote and execute

In our model the floor is monotone, so a quote followed by an execute
either matches exactly (no other trade in between) or the user receives
*more* ascend (someone else lifted the floor in between, which means
the user's effective price improved? — no, wait. floor up means ETH
per ascend goes up, which means ascendOut for fixed ETH goes *down*).

So a higher floor at execute time means *fewer* ascend out. The router
exposes `minOut` for the user to clamp this; the dapp passes `0` because
in practice the floor barely moves on a single block. Document clearly.

## INFORMATIONAL

### I-1 — `sqrtPriceLimitX96` choice in router

The router passes `MIN_SQRT_PRICE + 1` for buys and `MAX_SQRT_PRICE - 1`
for sells. The AMM never executes (amountToSwap = 0), so this is a
no-op, but using the boundary values protects against any future change
to V4 that runs the AMM curve when amountToSwap is small but non-zero.

### I-2 — gas cost of the read-then-mint pattern

In `_executeBuy`, the hook reads `ascend.totalSupply()` and writes via
`ascend.mint(...)` — two external calls per buy. Could be inlined if
the hook *was* the ERC-20 (single contract). I kept them separate for
audit-isolation: the ERC-20 has zero logic, the hook has all the math.
The ~5k gas overhead is acceptable.

### I-3 — no events for floor lift

`Buy`/`Sell` already include `newFloor`, so off-chain indexers can
trace the floor curve from event logs alone. No separate `FloorLifted`
event needed.

## VERIFIED INVARIANTS

These are asserted by the test harness under randomized 30–40 trade
sequences:

- **monotone floor**: `floor(t+1) ≥ floor(t)` after every buy or sell
- **solvency**: `reserve(t) ≥ floor(t) · (totalSupply − bootstrapSupply)`
- **fee math**: `quoteBuy/quoteSell` outputs equal the actual swap output
- **path independence**: direct PoolManager swap output equals router
  swap output, given the same pre-state

## ITEMS PUNTED TO MAINNET ENGAGEMENT

- A 3rd-party security audit on the V4 delta sign convention specifically.
  Sign errors here are silent until tested against real PoolManager.
  The test suite catches them, but only when run.
- Gas profiling with `forge snapshot` against a target deployment chain.
- Mainnet `POOL_MANAGER` address verification at deploy time.
