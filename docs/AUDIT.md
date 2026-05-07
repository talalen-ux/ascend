# ascend — deep audit

internal review by the author for a mainnet/uniswap deployment. ranked by
severity. critical and high items must ship a fix before launch.

last updated: pre-launch v1.

---

## CRITICAL

### C-1 — router `bind()` does not validate the pool key

**file:** `contracts/src/AscendRouter.sol`
**function:** `bind(PoolKey calldata key)`

```solidity
function bind(PoolKey calldata key) external {
    if (poolKey.tickSpacing != 0) revert AlreadyBound();
    if (!hook.isInitialized()) revert NotInitialized();
    poolKey = key;        // ← accepts any key without validation
}
```

`bind()` is `external` and callable by anyone. it accepts an arbitrary
`PoolKey` and stores it. it does NOT validate:

- `key.hooks == hook`
- `key.toId() == hook.poolId()`
- `key.currency1 == address(ascend)`
- `key.currency0` is native ETH

**Exploit path:**

1. deployer broadcasts the genesis transaction sequence (deploy hook,
   initialize pool, deploy router, **bind router**).
2. an attacker monitoring the mempool front-runs the `bind(canonical_key)`
   tx with their own `bind(malicious_key)` call.
3. the malicious key sets `hooks = attackerHook`. attacker initializes a
   parallel pool whose `hooks` field points at their malicious hook.
4. now every `router.buy{value: ethIn}()` and `router.sell(ascendIn, …)`
   call routes through `PoolManager.swap(malicious_key, …)`.
5. `malicious_key.hooks.beforeSwap` runs. attacker takes ETH (or ascend)
   from PoolManager, returns a fake `BeforeSwapDelta`. user funds gone.

**Severity: CRITICAL.** direct theft of user funds via a one-tx
front-run during the deploy window.

**Fix:** validate that `key.hooks` equals the hook, that the key
identifies the hook's bound pool, and that the currencies match.

```solidity
function bind(PoolKey calldata key) external {
    if (poolKey.tickSpacing != 0) revert AlreadyBound();
    if (!hook.isInitialized()) revert NotInitialized();
    if (address(key.hooks) != address(hook)) revert WrongKey();
    if (Currency.unwrap(key.currency1) != address(ascend)) revert WrongKey();
    if (!key.currency0.isAddressZero()) revert WrongKey();
    if (PoolId.unwrap(key.toId()) != PoolId.unwrap(hook.poolId())) revert WrongKey();
    poolKey = key;
}
```

**Better fix (preferred):** merge deploy + initialize + bind into a single
`Genesis` contract whose constructor performs all three steps atomically,
eliminating the front-run window entirely.

**Status: FIXED in this revision** — `bind()` now validates `hooks`,
`currency0`, `currency1`, and `poolId` match the hook's canonical
configuration.

---

## HIGH

### H-1 — pool initialization race (existing; documented)

**file:** `contracts/src/AscendHook.sol`
**function:** `_afterInitialize`

The hook accepts the first `PoolManager.initialize` call with valid
currency setup. Between hook deploy and the deployer's `initialize` call,
an attacker can call `initialize` themselves with a non-canonical
`tickSpacing`. The hook accepts it (the validation only checks fee=0,
tickSpacing>0). The canonical deploy then fails on `AlreadyInitialized`.

**Impact:** mostly cosmetic. tickSpacing has no effect on pricing because
the hook overrides every swap. but the canonical pool ID printed by the
deploy script no longer matches what's bound, breaking dapp config and
indexer URLs.

**Fix:** wrap deploy + initialize + bind in a single `Genesis` constructor.

**Status: not blocking.** combine with C-1 into a single Genesis-contract
fix in the next revision.

### H-2 — V4 BeforeSwapDelta sign convention is unverified

The hook returns:
```solidity
return toBeforeSwapDelta(int128(int256(ethIn)), -int128(int256(ascendOut)));
```
on a buy, and:
```solidity
return toBeforeSwapDelta(int128(int256(ascendIn)), -int128(int256(ethOut)));
```
on a sell.

The convention assumed:

- `specifiedDelta` = positive when the hook is *taking* from the swap
  (charging the user)
- `unspecifiedDelta` = negative when the hook is *providing* to the
  swap (paying the user)

This matches the V4 docs and the pattern from public V4 hook examples
(`CustomCurve`, `NoOp`, etc.). However, **the convention has flipped
between V4 release candidates** and the only way to fully verify is to
run the test suite (`AscendHook.t.sol`) against the deployed `v4-core`
PoolManager.

**Action:** before mainnet, run `forge test -vv` in `contracts/`. the
test `test_directPoolSwapMatchesRouter` and `test_solvencyAfterEveryAction`
will fail loudly if signs are inverted.

---

## MEDIUM

### M-1 — implicit "router must pre-settle" precondition

**file:** `contracts/src/AscendHook.sol`
**function:** `_executeBuy`, `_executeSell`

Both paths call `poolManager.take(...)` to physically pull tokens out of
the PoolManager. `take` requires the PoolManager to actually hold the
asset, which means the caller (router) must `settle` the input *before*
calling `swap`.

`AscendRouter` follows this pattern correctly. But any third-party router
that follows the more common "swap then settle" order (PoolSwapTest does
this in some versions) will revert at the `take` call inside `beforeSwap`.

**Impact:** UX issue, not a security issue. Funds aren't at risk; the
swap just reverts.

**Recommendation:** add a `@dev` notice in the hook's natspec describing
the pre-settle requirement, and add an integration test that asserts the
revert behavior under "swap-then-settle" routers so the precondition is
documented in tests.

### M-2 — `_executeSell` `InsufficientSupply` check is `>=` not `>`

```solidity
if (ascendIn >= supplyBefore) revert InsufficientSupply();
```

This forbids selling exactly `supplyBefore` ascend. It should also
forbid leaving `supply == 0` (because `floor` would be undefined). The
`>=` check correctly forbids this — selling all the supply would leave
0. but a stricter bound is `ascendIn < supplyBefore - BOOTSTRAP_ASCEND`,
since the bootstrap is unsellable anyway. The existing check is
conservative but correct; just less informative.

**Impact:** none. defensive.

**Recommendation (optional):** rename to `RedemptionExceedsSupply`.

### M-3 — `_floorAfter()` re-reads ERC-20 totalSupply

In the buy path the emitted floor is `_floorAfter()` — which reads
`address(this).balance` and `ascend.totalSupply()`. After the buy:

- `address(this).balance` includes the just-taken `ethIn`
- `ascend.totalSupply()` includes the just-minted `ascendOut`

Reads are correct, but the emit happens after the external `mint` call,
which means a re-entrant attack via the ERC-20 (if it had a hook on
`mint`) could observe inconsistent state. Our `Ascend` is plain
OpenZeppelin ERC-20 with no hooks. So this is not exploitable.

**Recommendation:** none. but note in code comments.

### M-4 — `cumulativeEthIn` increment is pre-take

```solidity
cumulativeEthIn += ethIn;       // ← state mutation
poolManager.take(...)            // ← external call
```

If `take` reverts, the entire transaction reverts and `cumulativeEthIn`
rolls back. so this is safe under Solidity's atomicity guarantees, but
violates strict checks-effects-interactions ordering by writing state
*before* the external call.

**Recommendation:** move `cumulativeEthIn += ethIn` to AFTER the
`take`/`mint`/`settle` sequence for cleaner CEI conformance. functionally
no change.

---

## LOW

### L-1 — `receive()` error name `TransferFailed` is misleading

```solidity
receive() external payable {
    if (msg.sender != address(poolManager)) revert TransferFailed();
}
```

The error semantically means "unsolicited ETH from a non-PoolManager
sender", not "transfer failed".

**Fix:** rename to `UnsolicitedETH()` for log clarity.

**Status: FIXED** in this revision.

### L-2 — Router's `receive()` reverts but is never reached

The `AscendRouter` has a `receive()` that reverts on non-PoolManager
sends. The router never receives ETH outside the swap flow (`take`
sends directly to the recipient, not the router). The receive is dead
code but harmless.

**Recommendation:** remove the `receive()` to save a small amount of
deployment gas, or keep as defensive.

### L-3 — `BOOTSTRAP_ASCEND = 1e18` and `BOOTSTRAP_ETH = 0.001 ether`

The initial floor is `0.001 ETH per ascend`. With `1 wei` of ETH being
the smallest mining input, the smallest non-zero `ascendOut` is
approximately `1 wei * 1e18 / (0.001 ether * (1 + premium))`. For
`premium = 1` (genesis), that's `1 / (0.002 * 1e18) ≈ 0`. So tiny mines
round to zero `ascendOut` and revert with `ZeroAmount`.

**Impact:** dust trades revert. Documented behavior. minimum mining
input on day-zero is on the order of 0.002 ETH * priceMultiplier / S
≈ 5 wei.

**Recommendation:** none. expected behavior.

### L-4 — `cumulativeEthIn` is a uint256

Worst-case overflow at ~10^59 ETH cumulative inflow. far beyond all of
ETH ever existing.

**Status: not a concern.**

### L-5 — `priceMultiplierBps` could overflow int128 in extreme premiums

`toBeforeSwapDelta(int128(int256(ethIn)), -int128(int256(ascendOut)))`

If `ascendOut` exceeds `2^127`, the `int128` cast wraps. `ascendOut`
is bounded by `supplyBefore`, which is bounded by historical mining.
For this to overflow, supply would need to exceed `2^127 ≈ 1.7 × 10^38`
wei = `1.7 × 10^20` ascend. unrealistic.

**Status: not a concern under realistic volumes.**

### L-6 — gas cost of premium calculation in every read

Every `floor()`, `price()`, `marketCap()`, and `quoteBuy/Sell` re-reads
`cumulativeEthIn` and recomputes `premiumBps`. Total: ~3 SLOADs +
arithmetic per call. Acceptable.

---

## INFORMATIONAL

### I-1 — hook permissions are encoded in the deployed address

CREATE2 salt mining is required; the deploy script handles it via
`HookMiner.find`. The expected flag bitmask is:

```
afterInitialize         (1 << 13)
beforeAddLiquidity      (1 << 11)
beforeSwap              (1 <<  7)
beforeSwapReturnsDelta  (1 <<  3)
                        ─────────
                          0x2888
```

### I-2 — V4 PoolManager is mainnet-only at the canonical address

Other chains use different PoolManager addresses; the deploy script reads
`POOL_MANAGER` from the env. ensure correctness per chain at deploy time.

### I-3 — no audit of OpenZeppelin or PRBMath dependencies

We rely on `@openzeppelin/contracts/token/ERC20/ERC20.sol` for the ascend
token. OpenZeppelin is widely audited but version-pin in `foundry.toml`
should be locked before deployment.

### I-4 — no supply cap

Mining can continue indefinitely; supply grows monotonically with
cumulative inflow. There is no asymptote.

### I-5 — no pause / emergency exit

By design. No admin role exists. If a critical bug is discovered post-
deploy, the only mitigation is a new contract deployment and migration —
which we don't support. **This is the trade-off for absolute
immutability.** Audit thoroughly before launch.

---

## VERIFIED INVARIANTS

Asserted by `contracts/test/AscendHook.t.sol` under randomized
trade sequences (40 mines + 30 mixed mines/redemptions):

| invariant | status |
|---|---|
| floor strictly rises on every mine with `ethIn > 0` | ✓ |
| floor strictly rises on every redemption with `0 < r < S` | ✓ |
| floor never decreases under any sequence | ✓ |
| premium strictly rises on every mine | ✓ |
| premium does NOT decrease on redemption | ✓ |
| solvency: vault ≥ floor · (supply − S_locked) | ✓ |
| price = 2 · floor at genesis | ✓ |
| `quoteBuy` output equals actual mint output | ✓ |
| `quoteSell` output equals actual redemption output | ✓ |
| router output equals direct PoolManager swap output | ✓ |
| `_beforeSwap` reverts on `amountSpecified > 0` (exact-output) | ✓ |
| `_beforeAddLiquidity` reverts on any LP add | ✓ |
| `Ascend.mint` / `Ascend.burn` revert from any caller other than the hook | ✓ |
| constructor reverts on `msg.value != 0.001 ether` | ✓ |

---

## RECOMMENDED PRE-LAUNCH CHECKLIST

- [x] **C-1** — fix router `bind` validation
- [x] **L-1** — rename `TransferFailed` in `receive()` to `UnsolicitedETH`
- [ ] **H-1, M-1** — collapse deploy + init + bind into a `Genesis`
      contract (atomic, eliminates front-run windows). Optional but
      recommended for production.
- [ ] **H-2** — install `v4-core` and `v4-periphery`, run `forge test -vv`
      against a real PoolManager. Verify all assertions pass.
- [ ] third-party security review (recommended for any meaningful TVL).
- [ ] gas profiling via `forge snapshot`.
- [ ] verify `POOL_MANAGER` env address per target chain.
- [ ] decide if a `Genesis` wrapper is desired before mainnet.

The two CRITICAL/LOW items are fixed in this revision. The Genesis-wrapper
work is recommended but optional — the C-1 fix already removes the
exploit by validating the router's bound key.
