# ascend v2 — internal audit

Comprehensive audit of every contract committed for the v2 launch. This
is an internal/pre-mainnet review by the implementer, not a substitute
for third-party security review. Severity scale follows OWASP-like
conventions.

## scope

| file                                  | purpose                                | LoC  |
|---------------------------------------|----------------------------------------|------|
| `contracts/src/Ascend.sol`            | ERC-20, sole-minter pattern            | 31   |
| `contracts/src/AscendHookV2.sol`      | V4 hook + LP custodian + fee splitter  | 380  |
| `contracts/src/TileEngine.sol`        | Tile-flip reward game (USP)            | 326  |
| `contracts/src/AscendHook.sol`        | **v1 — deprecated, retained for ref**  | 484  |
| `contracts/src/AscendRouter.sol`      | **v1 — deprecated, retained for ref**  | 191  |

**Decision: v1 is not the launch target.** v2 is the target. v1 sources
remain in-tree for reference until v2 is shipped, after which v1 should
be removed. Audit items below are for v2.

### post-option-A protections (added after the initial audit)

The option-A pivot added a layer of anti-MEV / anti-bot protections.
Each is reviewed inline below:

- `MINT_FEE_WEI = 0.001 ether` flat surcharge → anti-spam on tiny
  mints; encoded as a per-swap dynamic-fee adjustment so V4's fee
  routing handles it natively.
- `lastBuyBlock[tx.origin]` same-block-burn revert → flash-loan
  arbitrage is uneconomic.
- `ANTI_BOT_BLOCKS = 100` randomized launch-window fee tax → bots
  pay an extra ~0.5% on average for the first 100 blocks.
- `MAX_EFFECTIVE_FEE_PIPS = 100_000` (10%) hard cap → dust mints
  can't silently incur 100% fees from the surcharge math.

**Note:** the per-tx mint cap was removed by deliberate design
choice. There is no upper bound on the size of a single buy. Launch-
day concentration risk is real and accepted. The CP curve's natural
slippage is the only economic friction on whale buys.

### option-A uses tx.origin

The same-block-burn guard and the anti-bot RNG mix `tx.origin`. This
is the correct identifier for bot defense (the EOA initiating the
call chain), but worth flagging as a known caveat:

- Smart-contract wallets (Safe, etc.) interact via tx.origin = EOA
  signer, which is fine.
- ERC-4337 paymasters / bundlers may use a different tx.origin; the
  user-perceived sender is `userOp.sender`, not tx.origin. This
  could let some 4337 flows bypass the same-block guard.
- This is acceptable: 4337 flash-loan arbitrage at launch is an
  unlikely vector; the guard is a probabilistic deterrent, not a
  cryptographic guarantee.

## severity scale

| level         | meaning                                                     |
|---------------|-------------------------------------------------------------|
| CRITICAL      | direct loss of user funds or full protocol takeover         |
| HIGH          | significant economic harm, redemption breakage, or unclear  |
|               | mainnet behavior under stated assumptions                   |
| MEDIUM        | bounded economic harm, suboptimal but contained             |
| LOW           | code-quality, gas, or non-exploitable concerns              |
| INFORMATIONAL | observations and design notes worth recording               |

---

## CRITICAL

### ~~C-5~~ — Fee unit confusion: `FEE_BPS = 500` was 0.05%, not 5% — **FIXED**

**file:** `contracts/src/AscendHookV2.sol`
**function:** `_beforeSwap`

V4's dynamic fee unit is **pips** (1_000_000 = 100%), not basis
points. The constant `FEE_BPS = 500` returned via the
`OVERRIDE_FEE_FLAG` was charging **0.05% on-chain**, not the 5%
documented and assumed in every analysis (sims, design doc,
audit). Floor compounding rate, tile pool fill rate, every
economic projection — all overstated by 100×.

**Resolution:** option-A pivot rewrote the fee model entirely.
Constant renamed to `SWAP_FEE_PIPS` to make the unit explicit, set
to `10_000` (1% — option-A spec). Fee split tracked in basis
points (`LP_SHARE_BPS = 7_000`, `TILE_SHARE_BPS = 3_000`,
`SHARE_DENOM = 10_000`).

Caught during the option-A code review. Would have been caught
by H-2 (forge tests against real PoolManager) once those run, but
shipping without the test suite would have meant a 100× under-
collected protocol on day one.

**Status:** FIXED.



### ~~C-1~~ — `_afterSwap` is a stub; fee split is not implemented — **REWRITTEN**

**file:** `contracts/src/AscendHookV2.sol`
**function:** `_afterSwap`

The skeleton `_afterSwap` returns the success selector and `0` delta
without doing any fee split, tile pool funding, or rebalance. **The
contract is non-functional as committed.** Slice 6 will implement:

1. Read fee credited to hook from PoolManager state
2. `tilePortion = fee × TILE_BPS / FEE_BPS` → `tileEngine.depositReward`
3. `lpPortion = fee × LP_RETENTION_BPS / FEE_BPS` → `pendingFees`
4. `if pendingFees >= REBALANCE_THRESHOLD: rebalance()`

**Resolution:** rewrote the architecture in slice 6. `_afterSwap` is
intentionally a no-op: V4 natively credits the dynamic fee to the LP
position state (the hook is the sole LP), so there's nothing to do
synchronously per swap. Fee collection + split happens in `rebalance()`,
a public permissionless function:

  1. `modifyLiquidity(0)` returns accrued fees as `BalanceDelta`
  2. `take()` both currencies into the hook
  3. ETH split: 4/5 (`LP_RETENTION_BPS / FEE_BPS`) to LP, 1/5 to TileEngine
  4. Donate the LP portion + ascend fees back via `poolManager.donate()` —
     adds to reserves without changing L, so spot price barely moves and
     floor strictly rises
  5. TileEngine deposit wrapped in try/catch (I-5 mitigation): if the
     game contract reverts, the tile portion stays in the LP

**Status:** FIXED. V4-specifics still need foundry verification (H-2).

### ~~C-2~~ — `_afterInitialize` does not seed the genesis LP — **FIXED**

**file:** `contracts/src/AscendHookV2.sol`
**function:** `_afterInitialize`

The hook validates the pool key and binds the `poolId`, but never
deposits the 122M ascend + 1 ETH as a full-range LP. **Without the LP
deposit, the pool has no liquidity and the first swap reverts.**

The genesis-deposit must happen atomically with `afterInitialize` — a
deferred deposit creates a window where front-runners could exploit the
empty pool.

**Recommendation:** in `afterInitialize`, call
`poolManager.unlock(GenesisDepositData)`. The unlockCallback then issues
`modifyLiquidity` with `liquidityDelta = computed_L`, `tickLower =
MIN_TICK`, `tickUpper = MAX_TICK`. The hook is the LP, so
`beforeAddLiquidity` must accept `sender == address(this)`.

**Resolution:** slice 5 implemented. `_afterInitialize` calls
`poolManager.unlock(GENESIS, sqrtPriceX96)`. `unlockCallback`
dispatches on `CallbackKind` to `_seedGenesis`, which computes
liquidity via `LiquidityAmounts.getLiquidityForAmounts` for the
full range and calls `modifyLiquidity` to deposit. Both currencies
are then settled (ETH via `settle{value:}`, ascend via the
sync/transfer/settle pattern). The seed is atomic with init.

**Status:** FIXED. V4 sign convention still needs foundry verification (H-2).

### ~~C-3~~ — `unlockCallback` reverts `NotImplemented` — **FIXED**

**file:** `contracts/src/AscendHookV2.sol`
**function:** `unlockCallback`

Required for both genesis deposit (C-2) and rebalance (C-4). Currently
unconditionally reverts. **No `modifyLiquidity` call can complete
through this hook.**

**Resolution:** slice 5/6 implemented. The callback now dispatches
to `_seedGenesis` (slice 5) and `_doRebalance` (slice 6). The
NotImplemented error has been removed.

**Status:** FIXED.

### ~~C-4~~ — `rebalance()` reverts `NotImplemented` — **FIXED**

**file:** `contracts/src/AscendHookV2.sol`
**function:** `rebalance`

The rebalance routine is the engine of the floor-ratchet. Without it,
fees accumulate on the hook indefinitely without ever lifting the
floor. **The floor invariant cannot be preserved.**

**Resolution:** slice 6 implemented. `rebalance()` is public,
permissionless, re-entrancy guarded, and calls into the unlock
callback's REBALANCE branch (`_doRebalance`). Lifts the floor by
donating retained ETH back to the LP (no L change → no price drift)
and forwarding 1/5 of the ETH fee to the TileEngine. Holders or bots
can call this freely; cost amortizes naturally with epoch revenue.

**Status:** FIXED.

---

## HIGH

### ~~H-1~~ — Pool initialization race (carryover from v1) — **FIXED**

**file:** `contracts/src/AscendHookV2.sol`
**function:** `_afterInitialize`

Between hook deployment and the legitimate `pool.initialize` call, an
attacker can call `initialize` themselves with a non-canonical
`tickSpacing` (any non-zero). The hook accepts and locks. The
canonical deploy then fails on `AlreadyInitialized`.

In v2 this matters less than v1 because:
- The hook is the only LP — no external party can capitalize on the
  wrong tickSpacing.
- The genesis LP seed is gated on `_afterInitialize` (per C-2 above),
  so a bad initialization just makes the pool unusable, not exploited.

But it still breaks the on-chain bound `poolId` reported by indexers
and the dapp config. Fix is the same as v1: a `Genesis` constructor
that bundles deploy + initialize + LP-seed atomically.

**Severity:** HIGH because mitigations are partial.

**Resolution:** `contracts/src/Genesis.sol` plus the
`contracts/script/DeployV2.s.sol` script. Genesis is a single-purpose
contract whose constructor:
  1. Deploys `AscendHookV2` via CREATE2 (with mined salt + 1 ETH bootstrap)
  2. Builds the canonical PoolKey
  3. Calls `poolManager.initialize(key, sqrtPriceX96)`
  4. Hook's `afterInitialize` re-enters PoolManager and seeds the LP

All within one transaction. The race window is closed: there is no
state in which the pool exists and is initialized but unfunded.

**Status:** FIXED.

### H-2 — V4 `BeforeSwapDelta` sign convention is unverified

The hook returns `BeforeSwapDeltaLibrary.ZERO_DELTA` from `_beforeSwap`,
delegating the actual swap to the pool curve. This is the safest path
(no custom delta math), but the actual fee accounting and the dynamic-
fee override interaction with delta=0 must be verified against a real
PoolManager build.

**Recommendation:** `forge test` against deployed v4-core; specifically
verify:
- 5% dynamic fee correctly routes to the hook (not the LP holder)
- Hook receives the fee as native ETH (currency0) on a buy and as
  ascend (currency1) on a sell — or via the unified `take()` path
- `afterSwap` sees the correct deltas to compute the fee amount

**Severity:** HIGH because incorrect assumption invalidates fee math.
**Status:** open. Blocking.

### ~~H-3~~ — TileEngine multiplier weights don't match the spec EV — **FIXED**

**file:** `contracts/src/TileEngine.sol`
**function:** `_drawMultiplier` + `EXPECTED_MULTIPLIER_SCALED`

Documented spec (in V2_DESIGN.md) claims weights:

| multiplier | weight |
|------------|--------|
| 1× | 60% |
| 2× | 25% |
| 3× | 12% |
| 4× | 3%  |

…with E[m] = 1.58.

Actual implementation uses a 4-bit nibble (16 values) split as
`0..9`, `A..C`, `D..E`, `F`:

| multiplier | nibbles | weight        |
|------------|---------|---------------|
| 1× | 10/16 | **62.5%** |
| 2× |  3/16 | **18.75%** |
| 3× |  2/16 | **12.5%** |
| 4× |  1/16 | **6.25%** |

Actual E[m] = (10·1 + 3·2 + 2·3 + 1·4)/16 = **1.625**, not 1.58.

`EXPECTED_MULTIPLIER_SCALED` is hardcoded at `1_580_000`, which means
the contract divides by 1.58 when computing baseReward but actual draws
average 1.625. Net effect: **the protocol overpays by ~3%** in
expectation (each baseReward is ~3% higher than it should be for
solvency-in-expectation).

The hard solvency cap (`reward > remaining ? remaining : reward`) still
holds — payouts can't exceed the pool. But late claimers in some
epochs will receive less than their notional reward more often than
the spec implies.

**Recommendations (pick one):**

1. **Update the constant:** `EXPECTED_MULTIPLIER_SCALED = 1_625_000`,
   update the spec to document actual 62.5/18.75/12.5/6.25 weights.
   This is the smallest code change.

2. **Use a wider random word for finer granularity:** draw from a
   uint8 byte (256 values). Set thresholds at 154/64/30/8 (≈ 60.2%,
   25%, 11.7%, 3.1%) for genuine 1.58 EV. Slightly more gas but matches
   spec.

3. **Use 5-bit window (32 values):** 60%·32 = 19.2, 25%·32 = 8, etc.
   Pick 19/8/4/1 = 59.4/25/12.5/3.1% (E[m] = 1.59). Reasonable
   compromise.

**Severity:** HIGH because contract behavior diverges from documented
spec, even if economically bounded.

**Resolution:** Fixed by updating `EXPECTED_MULTIPLIER_SCALED` from
`1_580_000` to `1_625_000` (option 1). Spec rewritten to document the
actual 4-bit weights. Contract and spec now agree on E[m] = 1.625.

---

## MEDIUM

### M-1 — `_beforeAddLiquidity` `sender` check requires V4 sender semantics

**file:** `contracts/src/AscendHookV2.sol`
**function:** `_beforeAddLiquidity`

```solidity
if (sender != address(this)) revert LiquidityNotAllowed();
```

The `sender` parameter passed to `beforeAddLiquidity` is the entity
that called `poolManager.modifyLiquidity` — i.e. the original caller,
not the PoolManager. When the hook calls `modifyLiquidity` from inside
its own `unlockCallback`, `sender == address(this)`.

**Risk:** if V4's exact sender-passing convention changes between
versions, our genesis seed and rebalance could be erroneously rejected,
bricking the contract. Conversely, if the convention is more permissive
than expected, an external party could spoof the sender via a contract
wrapper.

**Recommendation:** verify via foundry test that:
1. External `modifyLiquidity` calls revert
2. Internal hook calls during rebalance succeed

**Status:** open. Slice 5/6 tests.

### M-2 — `tileEngine.tilesRemaining()` is O(144) per call

**file:** `contracts/src/TileEngine.sol`
**function:** `tilesRemaining`

Iterates the full grid each call. View-only, so no on-chain cost, but
RPC providers and indexers may rate-limit. Frontend should cache.

**Severity:** MEDIUM (UX), not a security issue.
**Recommendation:** add a counter `tilesClaimedThisEpoch` and return
`GRID_SIZE - count` in O(1).

### M-3 — `EXPECTED_MULTIPLIER_SCALED` is hardcoded against the weight table

**file:** `contracts/src/TileEngine.sol`

Already covered as part of H-3 but worth noting separately: any future
change to `_drawMultiplier`'s weight table requires updating
`EXPECTED_MULTIPLIER_SCALED` in lock-step. **Recommendation:** add a
comment block above `_drawMultiplier` cross-referencing the constant.

### M-4 — TileEngine reward pool can grow unboundedly if no one claims

**file:** `contracts/src/TileEngine.sol`
**function:** `_advanceEpochIfNeeded`

If a launch happens during low-volume hours and zero tiles are claimed
in epoch 0, all of that ETH rolls into epoch 1. With high volume, the
rollover combined with new deposits could create an epoch where
`baseReward` is large enough that even a single 4× claim drains
≥ 25% of the pool.

This is intended behavior (incentivizes claims when pool is fat) but
worth flagging: a high-rollover epoch creates a scramble for tiles
where the first 144 claimers walk away with the pool, and subsequent
holders get nothing this epoch.

**Severity:** MEDIUM. **Mitigation:** the per-tile share `pool / 144`
ensures no single claim can extract more than ~`4 / (144 × 1.58) ≈ 1.76%`
of the pool, even at maximum multiplier. Across 144 claimers, max total
payout = `4 / 1.58 = 253%` of pool, capped at 100% by solvency. The
expected payout = 100% of pool.

This is fine economically; the only concern is UX framing — communicate
clearly that claimers come from a fixed-size grid and tiles are
first-come-first-served.

### M-5 — TileEngine deposit happens on every swap; tail of small swaps wastes gas

**file:** `contracts/src/AscendHookV2.sol`
**function:** `_afterSwap` (slice 6)

If a swap is tiny (e.g., $1), the 1% tile portion is $0.01 = ~4 gwei
worth. Calling `tileEngine.depositReward{value: 0.000004 ether}()`
costs ~22k gas (cold call) plus ~5k for the storage write. That's a
significant overhead for a tiny fee.

**Recommendation (slice 6):** buffer tile-pool deposits on the hook
and forward in batches when `tilePending >= TILE_DEPOSIT_THRESHOLD`
(e.g., 0.001 ETH).

**Severity:** MEDIUM (gas waste, not security). **Status:** to be
addressed in slice 6.

---

## LOW

### L-1 — `Ascend.burn` exists but is never called in v2

**file:** `contracts/src/Ascend.sol`
**function:** `burn`

v1 used burn during `_executeSell`. v2 never burns (supply is fixed at
122M, and sells just return ascend to the LP, not destroy it).

**Recommendation:** add a comment in `Ascend.sol` noting that `burn` is
unused in v2 and reserved for future use.

### L-2 — `TileEngine.receive()` reverts; some integrators may donate ETH

**file:** `contracts/src/TileEngine.sol`
**function:** `receive`

```solidity
receive() external payable {
    revert NotHook();
}
```

This rejects donations. The reasoning is correct (donations distort
RNG accounting), but the revert message `NotHook` is misleading — a
well-meaning donor would see `NotHook` and think they need to be the
hook, when the actual issue is that ETH donations aren't accepted.

**Recommendation:** change error to `DonationsNotAccepted` with clearer
revert reason for explorer/tooling display.

### L-3 — `Ascend` constructor uses `require(_hook != address(0), "hook=0")`

**file:** `contracts/src/Ascend.sol`

The `require(..., "hook=0")` string literal costs ~50 bytes of bytecode.
Using a custom error costs ~6 bytes. Minor.

**Recommendation:** convert to `error HookZero(); revert HookZero();`.

### L-4 — `block.prevrandao` is post-Merge only

**file:** `contracts/src/TileEngine.sol`
**function:** `_drawMultiplier`

`block.prevrandao` returns the previous block's RANDAO value on
post-Merge Ethereum. On pre-Merge networks (testnets that haven't
forked, archival replay) it returns `block.difficulty`. Since mainnet
deploys are post-Merge by definition, this is fine — but worth
documenting.

### L-5 — `claimTile` race: two users target the same tile in the same block

**file:** `contracts/src/TileEngine.sol`

If Alice and Bob both submit `claimTile(42)` in the same block, only
the first to be ordered succeeds; the second reverts with
`TileAlreadyClaimed`. Bob's gas is burned for nothing. Standard MEV
concern; not exploitable.

**Recommendation:** the dapp should display per-tile availability and
discourage targeting popular tiles. Consider adding a fallback in the
contract: if the requested tile is taken, claim the next available one.
Not critical.

### L-6 — `MIN_HOLDING = 1e18` is checked at claim time, not at any other point

**file:** `contracts/src/TileEngine.sol`
**function:** `claimTile`

A user could buy ascend, claim a tile, and immediately sell. They
extract a tile reward without long-term commitment. This is not a bug
per the spec — the spec only requires the holding at claim time — but
worth flagging as a design note.

If we wanted to require sustained holding, we'd need a snapshot
(checkpoints) which adds complexity. Spec choice is fine.

---

## INFORMATIONAL

### I-1 — Hook permissions are encoded in the deployed CREATE2 address

CREATE2 salt mining required at deploy time. Expected flag bitmask:

```
afterInitialize         (1 << 13)
beforeAddLiquidity      (1 << 11)
beforeSwap              (1 <<  7)
afterSwap               (1 <<  6)
                        ─────────
                          0x28C0
```

(v1 had `beforeSwapReturnsDelta` flag; v2 does not.)

### I-2 — Test coverage is currently zero for v2

The skeleton compiles but has no tests. Slice 5/6/7 will add forge
tests. For shippability:

- floor monotonicity (buy, sell, mixed, randomized)
- supply cap invariant
- single-LP invariant
- single-pool invariant
- TileEngine: solvency cap, one-claim-per-epoch, hook-only deposit,
  multiplier distribution
- MEV: sandwich resistance, JIT-LP impossibility

### I-3 — The Ascend ERC-20 has no decimals override

Inherits OpenZeppelin's default 18 decimals. Matches the supply cap
math (`122_000_000 * 1e18` wei).

### I-4 — Both hook and TileEngine use EIP-1153 transient storage for reentrancy

This is post-Cancun (mainnet, March 2024). Verified available on all
target chains.

### I-5 — TileEngine has no pause / kill switch

By design. If a critical bug is found in TileEngine, the only
mitigation is "the hook stops sending fees there". The hook can do this
trivially (set `tileEngine` to a different address — wait, it's
immutable. So it can't stop).

**Mitigation note:** the hook's `_depositToTilePool` could be wrapped
in a try/catch so that a TileEngine revert doesn't brick the swap path.
**Recommendation:** wrap the deposit call in a low-level `call` and
swallow failures (just retain the tile portion as additional LP
buffer in that case). Comment this in slice 6.

### I-6 — Frontend (dapp) is on v1 ABIs

`hooks/useAscendState.ts`, `lib/abi.ts`, `lib/floor.ts`, and
`components/Trade.tsx` all reference v1 contracts. v2 launch requires
re-pointing the dapp. No security implication; tracked as slice 7.

### I-7 — v1 contracts retained in-tree

Until v2 ships, both versions coexist. Recommendation: rename v1
sources to `*.legacy.sol` or move under `contracts/src/legacy/` to
prevent accidental deploy.

---

## VERIFIED INVARIANTS (will be assertable in slice 8 tests)

| invariant                                                                | status         |
|--------------------------------------------------------------------------|----------------|
| `floor(t)` monotone non-decreasing (buy)                                 | algebraic ✓    |
| `floor(t)` monotone non-decreasing (sell)                                | algebraic ✓    |
| `ascend.totalSupply() == 122_000_000 · 1e18` always                      | by construction |
| only the hook can mint ascend                                            | code ✓         |
| only the hook is an LP                                                   | code ✓ (M-1 dependent) |
| pool fee is dynamic + hook-overridden                                    | code ✓ (H-2 dependent) |
| TileEngine: only hook can deposit                                        | code ✓         |
| TileEngine: cumulative payout ≤ epoch pool                               | code ✓         |
| TileEngine: one claim per address per epoch                              | code ✓         |
| TileEngine: multiplier ∈ {1, 2, 3, 4}                                    | code ✓ (H-3 EV mismatch) |
| reentrancy guarded                                                       | code ✓ (slice 6 wires)   |
| ETH only enters the system through swap fees or genesis bootstrap        | code ✓         |

---

## PRE-LAUNCH CHECKLIST

### blocking (must fix before mainnet)

- [x] **C-1** — `_afterSwap` rewritten; fee handling moved to permissionless `rebalance()` using V4 native fee accrual + `donate()`
- [x] **C-2** — genesis LP seed implemented; atomic with `afterInitialize`
- [x] **C-3** — `unlockCallback` dispatches to `_seedGenesis` and `_doRebalance`
- [x] **C-4** — `rebalance()` implemented; collect → split → donate
- [x] **H-1** — atomic Genesis deploy contract (`contracts/src/Genesis.sol` + `contracts/script/DeployV2.s.sol`)
- [ ] **H-2** — `forge test` against real PoolManager; verify
      `BalanceDelta` sign convention, fee credit behavior under
      `OVERRIDE_FEE_FLAG`, and `donate()` semantics
- [x] **H-3** — `EXPECTED_MULTIPLIER_SCALED` set to 1_625_000 to match weight table
- [ ] **M-1** — verify `_beforeAddLiquidity` sender semantics
- [ ] **M-5** — N/A under new design (fees collected lazily by rebalance, not on every swap)

### recommended

- [ ] **M-2** — O(1) `tilesRemaining` via counter
- [ ] **M-3** — cross-reference comment for the EV constant
- [ ] **L-1** — note in `Ascend.sol` that burn is reserved for future use
- [ ] **L-2** — clearer revert message on TileEngine donations
- [ ] **L-3** — convert `require` strings to custom errors in `Ascend.sol`
- [ ] **I-2** — full forge test suite
- [ ] **I-5** — wrap tile deposit in try/catch so TileEngine bugs don't
      brick swaps
- [ ] **I-7** — segregate v1 sources from v2

### third-party recommendations

- [ ] external security review (Spearbit / Trail of Bits / OpenZeppelin)
- [ ] economic / tokenomics review (Gauntlet, etc.) — particularly
      around the tile-pool dynamics under adversarial epoch draining
- [ ] randomness audit if VRF is added later

---

## summary

The v2 design is sound, the interfaces are correct, and the math holds
algebraically. The contract code is **not yet deployable**: 4 critical
blockers (all stub functions) and 3 high-severity items (init race,
unverified V4 sign convention, multiplier-EV mismatch).

Slices 5 (genesis + LP seed), 6 (afterSwap fee split + rebalance), 7
(frontend), and 8 (tests) close the criticals. After those slices land,
the contract is ready for third-party audit and mainnet deployment.

**Estimated path to mainnet from current state:**

1. ~1–2 days of slice 5/6 implementation
2. ~2–3 days of slice 8 forge tests + invariant fuzzing
3. ~2 weeks third-party review
4. ~1 week deploy choreography (Genesis script, salt mining, dapp cut-over)

**Total: ~3 weeks to a confident mainnet launch.**
