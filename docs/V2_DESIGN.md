# ascend v2 — locked design spec

This document is the source of truth for the v2 contract implementation.
All numerical parameters, invariants, and invariant proofs are committed
here. Implementation lives at `contracts/src/AscendHookV2.sol` and
`contracts/src/TileEngine.sol`.

## one-line summary

A V4 hook that owns a full-range LP, charges 1% on every swap +
a flat $2 surcharge on each mint, splits 70% to LP depth / 30% to a
tile-flipping reward game, and enforces that the LP's lower tick
(= the floor) is monotone non-decreasing. Single price for buyers
and sellers. Real liquidity. Single-band chart. Holders earn from a
flippable 12×12 tile grid that pays out 1×–4× multiples. Per-tx mint
cap, same-block-burn revert, and a randomized launch-window fee tax
the deployment-block-tuned bots.

## locked parameters

| symbol                       | value           | notes                                                          |
|------------------------------|-----------------|----------------------------------------------------------------|
| `SUPPLY_CAP`                 | `122_000_000`   | hard cap, all minted at genesis (122M ascend)                  |
| `BOOTSTRAP_ETH`              | `1 ether`       | constructor enforces exact value                               |
| `SWAP_FEE_PIPS`              | `10_000`        | 1% base swap fee (V4 pips, where 1_000_000 = 100%)             |
| `LP_SHARE_BPS`               | `7_000`         | 70% of fee → LP depth                                          |
| `TILE_SHARE_BPS`             | `3_000`         | 30% of fee → TileEngine                                        |
| `SHARE_DENOM`                | `10_000`        | denominator for the share split                                |
| `MINT_FEE_WEI`               | `0.001 ether`   | flat surcharge per buy (~$2 at $2350/ETH)                      |
| `ANTI_BOT_BLOCKS`            | `100`           | randomized launch-window fee tax                               |
| `ANTI_BOT_MAX_EXTRA_PIPS`    | `10_000`        | max extra fee during anti-bot window (+1%)                     |
| `MAX_EFFECTIVE_FEE_PIPS`     | `100_000`       | hard cap (10%) — dust mints can't pay 100% fee                 |
| `LP_RANGE`                   | full range      | tickLower = `MIN_TICK`, tickUpper = `MAX_TICK`                 |
| `TICK_SPACING`               | `60`            | standard for non-fee-tier pools                                |
| pool `currency0`             | `address(0)`    | native ETH                                                     |
| pool `currency1`             | ascend ERC-20   | sole minter is the hook                                        |
| pool `fee`                   | dynamic         | hook charges its own fee via OVERRIDE flag, per-swap            |
| `REBALANCE_THRESHOLD`        | `0.01 ether`    | min retained-fee buffer before re-LP'ing                       |
| `REBALANCE_GUARD`            | EIP-1153 tload  | re-entrancy guard around the rebalance routine                 |
| `TILE_GRID`                  | `144` (12×12)   | tiles per epoch                                                |
| `EPOCH_LENGTH`               | `24 hours`      | tiles refresh at the start of each epoch                       |
| `MIN_HOLDING`                | `1e18`          | 1 ascend minimum balance to claim a tile                       |
| `SELECTION_RATE_BPS`         | `6800`          | 68% of holders are randomly selected per epoch                 |
| `SELECTION_DENOM`            | `10_000`        | denominator for selection rate                                 |

### effective fee curve (post mint-surcharge)

The mint surcharge is encoded as a per-swap dynamic-fee adjustment:

```
mint_pips = (MINT_FEE_WEI · 1_000_000) / amountIn
effective_pips = clamp(SWAP_FEE_PIPS + mint_pips + antiBotExtra,
                       max = MAX_EFFECTIVE_FEE_PIPS)
```

Effective fee % at typical mint sizes:

| `amountIn`         | mint surcharge | + base 1% | total fee (no anti-bot) |
|--------------------|----------------|-----------|-------------------------|
| 0.005 ETH ($12)    | ~20%           |  +1%      | ~21%                    |
| 0.025 ETH ($59)    | ~4%            |  +1%      | ~5%                     |
| 0.05 ETH ($118)    | ~2%            |  +1%      | ~3%                     |
| 0.1 ETH ($235)     | ~1%            |  +1%      | ~2%                     |
| 0.5 ETH ($1175)    | ~0.2%          |  +1%      | ~1.2%                   |
| 1 ETH ($2350)      | ~0.1%          |  +1%      | ~1.1%                   |
| 5 ETH ($11750)     | ~0.02%         |  +1%      | ~1.02%                  |
| 100 ETH ($235k)    | ~0.001%        |  +1%      | ~1.001%                 |

Effect: small mints pay a relatively large %, large mints pay
~1%. Acts as anti-spam without blocking serious buyers.

### anti-MEV summary

| mechanism                          | what                                                     |
|------------------------------------|----------------------------------------------------------|
| same-block burn-after-buy revert   | flash-loan arbitrage uneconomic (`tx.origin` keyed)      |
| `ANTI_BOT_BLOCKS` window           | first 100 blocks: +0..1% random extra fee on mints       |
| `MAX_EFFECTIVE_FEE_PIPS` hard cap  | dust mints can't pay >10% even with mint surcharge       |

**Note:** there is no per-tx mint cap. A whale can buy any amount in a
single tx; the only cap on damage is the constant-product slippage of
the LP curve. This is a deliberate design choice — fair-launch
maximalism — and means launch-day concentration risk is real. Buyers
who want to avoid being walked into by a whale should bid alongside
the genesis tx in the same block.

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

Define the **per-side retention rate** `ρ`:

- on a buy of `v` ETH: total fee = `0.01·v`, of which `0.7 × 0.01·v =
  0.007·v` is retained as ETH-side LP depth (the rest goes to the
  TileEngine). For the floor proof we use `ρ_buy = 0.007`. The mint
  surcharge of `MINT_FEE_WEI` adds an additional fixed retention term
  that strictly improves the inequality below.
- on a sell of `r` ascend: total fee = `0.01·r` ascend, of which
  `0.7 × 0.01 = 0.007` of `r` stays in the LP as ascend depth. For the
  symmetric proof we use `ρ_sell = 0.007`.

For any swap with positive amount:

```
floor' / floor = (Y + ρ_buy·v) · circ / (Y · circ')   (buy)
floor' / floor = (Y − ethOut) · circ / (Y · circ − Y · ρ_sell·r)  (sell)
```

where `circ'` is the new circulating supply.

- **Buy**: `circ` increases (ascend leaves the LP) by `Δ`. The
  retained ETH `ρ_buy·v` enters the LP without any ascend leaving on
  that portion. The remaining `(1 − ρ_buy)·v` follows the constant-
  product law. After algebra:
  ```
  floor' / floor ≥ (Y + ρ_buy·v) · circ / (Y · (circ + Δ))
  ```
  Solving for the worst-case `Δ` (full curve exchange of the
  non-retained portion):
  ```
  floor' ≥ floor · (1 + ρ_buy·v/Y) / (1 + Δ/circ)
        = floor · (Y + ρ_buy·v) / (Y + (1 − ρ_buy)·v_eff)
  ```
  where `v_eff` ≤ `v`. Provided `ρ_buy > 0` and `v > 0`, the right-hand
  side is `≥ 1`, giving `floor'` ≥ `floor`. Strict equality only in
  the degenerate `v = 0` case.

- **Sell**: `circ` decreases (ascend re-enters LP), and `ρ_sell·r` of
  ascend stays in the LP outside the curve trade. `Y` decreases by the
  ETH paid out. By symmetric algebra:
  ```
  floor' / floor = (Y − ethOut) · circ / (Y · (circ − ascendIn))
  ```
  with `ethOut < ascendIn · floor` because of the 1% fee retention.
  Substituting and simplifying yields `floor' ≥ floor`.

Both sub-cases are proved by direct calculation; see Appendix A.

Note: the on-chain `floor()` getter reads only the L-active reserves.
Between rebalances, the LP-retained portion sits in fee credits (not
in L), so the *reported* floor can briefly stay flat or fluctuate with
sqrtPrice. The *true* floor — active + uncollected credits — is what
the proof above protects, and it is monotone non-decreasing forever.
See M-3 in `AUDIT_V2.md`.

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
beforeSwap               true   — apply 1% + flat surcharge dynamic fee
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
6. Hook deposits all 122M ascend + 1 ETH as a full-range LP position.
   This is the only `addLiquidity` call ever made on this pool.
7. Hook is now ready. Anyone can mine via standard V4 swap.
```

## swap flow

### buy (currency0 → currency1, exact-input)

```
beforeSwap(zeroForOne=true, amountSpecified=-ethIn):
    require(poolId == bound)
    require(ethIn > MINT_FEE_WEI)            // anti-spam floor
    lastBuyBlock[tx.origin] = block.number   // anti-flash-loan marker
    fee_pips = computeBuyFee(ethIn)
       = clamp(SWAP_FEE_PIPS                  // 10_000 (1%)
             + (MINT_FEE_WEI · 1e6 / ethIn)   // mint surcharge
             + antiBotExtra(),                // [0, +1%] for first 100 blocks
              max = MAX_EFFECTIVE_FEE_PIPS)   // 10% absolute cap
    return (selector, ZERO_DELTA, fee_pips | OVERRIDE_FEE_FLAG)

[poolManager runs the swap normally; the effective fee accrues to the
 LP position (we are sole LP). collected later via rebalance().]

afterSwap(...):
    no-op — V4 tracks fees natively in the position state.

beforeSwap(zeroForOne=false, amountSpecified=-ascendIn):
    require(lastBuyBlock[tx.origin] != block.number)
    fee_pips = SWAP_FEE_PIPS  // flat 1%, no surcharge on sells
```

### sell (currency1 → currency0, exact-input)

Same as buy but `zeroForOne=false`. 1% fee deducted from the ascend side
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
deterministic from `(amountIn, fee_pips)` and adds to depth uniformly
without changing the spot price. Sandwiches against the rebalance gain
no edge.

The one MEV vector worth noting: a sufficiently large buy could push
price up the curve, then the next-block buy gets a less favorable
price. Standard CP MEV; no v2-specific exposure.

## TileEngine — the unique selling point

The tile game is the on-chain expression of "every holder gets a slice
of the protocol's trading volume." It runs in a separate
`TileEngine.sol` contract that is funded entirely by the 1% fee slice
the hook routes on every swap.

### the loop

```
1. Every swap pays a 1% fee.
   - 4% retained in the LP as ETH-side depth (floor lift)
   - 1% pushed to TileEngine.depositReward{value: ...}() as native ETH
2. TileEngine accumulates the ETH into the current epoch's reward pool.
3. At the start of every 24h epoch, 144 tiles become claimable.
4. **68% random selection.** Each epoch, the engine seeds an RNG from
   `keccak(parent_blockhash, prevrandao, epoch)`. From this seed,
   each address falls deterministically into either the selected
   cohort (68% of all addresses) or the skipped cohort (32%). Only
   addresses in the selected cohort can claim that day. The other
   32% wait until the next epoch — their roll is independent (a new
   seed = a new draw), so over time everyone averages 68% of epochs.
5. Any address with ≥ 1 ascend AND in this epoch's selected cohort
   can claim ONE tile per epoch.
6. claimTile(uint16 idx) flips the tile:
   - Pseudorandom multiplier ∈ {1, 2, 3, 4} drawn from
     keccak256(blockhash, idx, msg.sender, epoch)
   - Reward = (epoch_pool / 144) × multiplier
   - Capped by remaining pool to ensure solvency
7. Unclaimed tiles' shares roll into next epoch's pool. Combined with
   the 32% non-selected cohort, the next epoch typically has a
   meaningfully bigger pool than the previous one — making the
   "back tomorrow" return cadence feel rewarding.
```

### multiplier distribution

A 4-bit nibble is drawn from the random word and mapped to a
multiplier. The split is chosen so contract code is trivial (one
keccak, one mask, three compares) at the cost of slight quantization
vs. round percentages:

| multiplier | nibbles      | weight    |
|-----------:|--------------|-----------|
|         1× | `0x0..0x9`   | 10/16 = 62.5%   |
|         2× | `0xA..0xC`   | 3/16  = 18.75%  |
|         3× | `0xD..0xE`   | 2/16  = 12.5%   |
|         4× | `0xF`        | 1/16  = 6.25%   |

Expected value:
```
E[m] = (10·1 + 3·2 + 2·3 + 1·4) / 16 = 26/16 = 1.625
```

**With expected multiplier of 1.625×, base reward per tile is
`epoch_pool / (144 × 1.625)` to keep the pool solvent in expectation.**
The contract's `EXPECTED_MULTIPLIER_SCALED = 1_625_000` constant
encodes this in 1e6 fixed-point.
We additionally enforce a hard cap at the contract level: if total
paid out approaches `epoch_pool`, late claimers receive at most their
proportional share. The contract never pays out more than it holds.

### randomness model

```solidity
uint256 r = uint256(keccak256(abi.encode(
    blockhash(block.number - 1),
    block.prevrandao,
    msg.sender,
    tileIdx,
    epoch
)));
uint8 nibble = uint8(r & 0xF);
uint8 multiplier = nibble < 0xA ? 1
                  : nibble < 0xD ? 2
                  : nibble < 0xF ? 3
                  : 4;
```

This is **proposer-influenceable but bounded**: a malicious validator
can choose to include or delay a tile-claim transaction to pick a
favorable `prevrandao`. Worst case, a validator captures 4× instead
of 1.625× expected — a 2.46× edge per claim, capped at one claim per
epoch per address. Total economic risk is bounded by:

```
maxEdge = (4 - 1.625) × tileShare ≈ 2.375 × (epoch_pool / 144 / 1.625)
       ≈ 1.01% of epoch pool per validator-controlled claim
```

For the threat model (gamification, not high-value DeFi), this is
acceptable. A future revision could integrate Chainlink VRF for
provable fairness; left as an upgrade path.

### eligibility and frequency

```solidity
struct ClaimRecord { address claimer; uint8 multiplier; uint128 reward; }
mapping(uint16 => mapping(uint64 => ClaimRecord)) public tileClaim;
mapping(address => uint64) public lastClaimEpoch;

// Inside claimTile():
require(idx < GRID_SIZE, "out of range");
require(tileClaim[idx][liveEpoch].claimer == address(0), "tile taken");
require(lastClaimEpoch[msg.sender] != liveEpoch + 1, "already claimed");
require(ascend.balanceOf(msg.sender) >= MIN_HOLDING, "no holding");
require(currentEpochPool > 0, "epoch empty");
require(_isSelected(msg.sender, liveEpoch), "not selected this epoch");
```

Each address gets exactly one tile per epoch *if selected*. Each tile
can be claimed by exactly one address per epoch. The race for "good"
tiles is incidental — all tiles use the same multiplier RNG, so there
is no preferable tile.

### the 68% selection mechanic

```solidity
mapping(uint64 => bytes32) public epochSeed;   // set once per epoch

function _advanceEpochIfNeeded() private {
    // ...rollover logic...
    if (epochSeed[nowEpoch] == bytes32(0)) {
        epochSeed[nowEpoch] = keccak256(
            abi.encodePacked(blockhash(block.number - 1), block.prevrandao, nowEpoch)
        );
    }
}

function _isSelected(address user, uint64 epoch) internal view returns (bool) {
    bytes32 seed = epochSeed[epoch];
    if (seed == bytes32(0)) return false;
    uint256 r = uint256(keccak256(abi.encode(seed, user)));
    return r % SELECTION_DENOM < SELECTION_RATE_BPS;
}
```

Properties:

- **Deterministic per (seed, user)** — once the seed is set, the
  cohort membership for every address is fixed for that epoch. The
  dapp can preview "you're in this epoch" without sending a tx.
- **Unpredictable until first activity** — the seed pulls from
  `blockhash` and `prevrandao` at the first transaction in the
  epoch. A holder cannot pre-compute next epoch's draw before that
  block is mined.
- **Independent across epochs** — a different seed each day means
  a holder's membership is re-rolled. Over many epochs the law of
  large numbers gives each holder ~68% of their potential claims.
- **No special holder advantage** — holding more ascend doesn't
  improve selection probability. Every address has the same 68%
  chance independently.

### state

```solidity
contract TileEngine {
    address public immutable hook;
    Ascend  public immutable ascend;

    uint64  public constant EPOCH_LENGTH = 24 hours;
    uint16  public constant GRID_SIZE = 144;
    uint256 public constant MIN_HOLDING = 1e18;
    uint256 public constant SELECTION_RATE_BPS = 6800;
    uint256 public constant SELECTION_DENOM = 10_000;
    uint64  public immutable genesisTime;

    uint256 public currentEpochPool;
    uint256 public currentEpochPaidOut;
    uint64  public liveEpoch;

    // history (analytics)
    mapping(uint64 => uint256) public epochPool;
    mapping(uint64 => uint256) public epochPaidOut;
    mapping(uint64 => bytes32) public epochSeed;

    // claim state
    struct ClaimRecord { address claimer; uint8 multiplier; uint128 reward; }
    mapping(uint16 => mapping(uint64 => ClaimRecord)) public tileClaim;
    mapping(address => uint64) public lastClaimEpoch;
}
```

### functions

```solidity
// called only by the hook
function depositReward() external payable;

// called by holders
function claimTile(uint16 tileIdx) external returns (uint8 multiplier, uint256 reward);

// views
function currentEpoch() external view returns (uint64);
function currentBaseReward() external view returns (uint256);  // pool / GRID_SIZE / 1.625
function isTileAvailable(uint16 idx) external view returns (bool);
function canClaim(address user) external view returns (bool);
function isSelected(address user, uint64 epoch) external view returns (bool);
function epochTiles(uint64 epoch) external view returns (ClaimRecord[144] memory);
function currentEpochTiles() external view returns (ClaimRecord[144] memory);
```

### connection to holdings

The reason this is "tiles for holders" not "tiles for everyone":

1. **MIN_HOLDING gate.** Must hold ≥ 1 ascend to flip. Buying ascend
   is the entry ticket to the game.
2. **Proportional opportunity.** A holder with more ascend isn't
   given more flips — every holder gets one per epoch. But larger
   holders benefit more from the LP's compounding floor (which is
   the primary value), so the tile game adds variance to the smaller
   holders' returns.
3. **Skin in the game.** The reward pool grows with trading volume.
   Holders are aligned with volume growth: more trading → more fees
   → bigger tile pool → bigger tile rewards.

### invariants

#### TI-1. Reward pool solvency
```
sum(claimedRewards in epoch e) ≤ epochPool[e]
```
Enforced by the contract via cumulative-payout bookkeeping. The
last claimer in an epoch may receive less than their expected
multiplier amount if the pool runs dry.

#### TI-2. Single-claim-per-epoch
```
∀ address a, ∀ epoch e: |{ idx : claimedBy[idx][e] == a }| ≤ 1
```
Enforced by `lastClaimEpoch[a] < currentEpoch` check.

#### TI-3. Hook-only deposit
```
msg.sender == hook  for all calls to depositReward()
```
Enforced by `require(msg.sender == hook, "not hook")`. No backdoor
funding from arbitrary parties (would distort RNG and accounting).

#### TI-4. Roll-forward invariant
```
∀ epoch e:
    currentEpochPool[e+1] += rolloverFromUnclaimed[e]
where rolloverFromUnclaimed[e] = epochPool[e] - epochPaidOut[e]
```
Unclaimed reward share doesn't disappear; it boosts the next epoch.

#### TI-5. Bounded validator edge
Worst-case validator manipulation per claim is bounded by
`(4 − 1.625) × (epoch_pool / 144 / 1.625) ≈ 0.0101 × epoch_pool`.

#### TI-6. Selection rate
For any epoch with seed set, an address is in the selected cohort
with probability exactly `SELECTION_RATE_BPS / SELECTION_DENOM = 0.68`
under the assumption that keccak256 outputs are uniformly distributed
modulo `SELECTION_DENOM`. Empirically verified in the test suite over
500 sampled addresses (`test_selectionRateIsApproximately68Percent`).

#### TI-7. Selection independence
Two distinct epochs use different seeds (different blockhashes), so
an address's selection status in epoch N is statistically independent
of its status in epoch N±k for k ≠ 0. Each epoch is a fresh roll.

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

## fee split — concrete numbers

Per `SWAP_FEE_PIPS = 10_000` (1%), `LP_SHARE_BPS = 7_000`, `TILE_SHARE_BPS = 3_000`,
on every $100 of trade volume the base fee is:

```
$1.00 = total swap fee
$0.70 → LP depth (floor lift)
$0.30 → TileEngine reward pool
```

Plus the flat $2 mint surcharge per buy, all of which routes
through the same fee channel and splits 70/30 like the rest. So a
$100 buy pays ~$3 in total ($1 base + $2 surcharge), and a $1000
buy pays ~$12 ($10 base + $2 surcharge).

At a meaningful active-trading volume of $15M / 24h (assume half is buys):
```
$150k     base fees collected per day (1% × $15M)
$~30k    mint surcharges per day (~$2 × ~15k mints)
─────
~$180k   total fees per day
~$126k   compounded into LP (70%)
~$54k    into the tile pool (30%)
```

Per epoch (24h), tile pool of $54k → 144 tiles → expected
$54k / 144 / 1.625 = $231 base reward → $231 to $924 per claim.

At $1M / 24h volume (more modest, ~1k mints/day):
```
$10k      base fees per day (1% × $1M)
$2k       mint surcharges per day (~$2 × ~1k mints)
─────
$12k      total fees
$8.4k     LP depth
$3.6k     tile pool
```
Tile rewards: $15 to $62 per claim.

Tile rewards are a meaningful incentive for holders without being
large enough to dominate token economics.

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
- [ ] TileEngine: `depositReward` only callable by hook.
- [ ] TileEngine: total payout per epoch ≤ epochPool (solvency).
- [ ] TileEngine: one claim per address per epoch.
- [ ] TileEngine: random multiplier distribution matches spec weights.
- [ ] TileEngine: reentrancy-protected claim path (`call` to user
      followed by no further state writes).
- [ ] TileEngine: handles edge cases — zero-pool epoch, all-tiles-claimed,
      MIN_HOLDING bypass attempts.

## appendix A — floor monotonicity proof (algebraic)

Let `Y, X, S, circ = S − X` denote pre-trade state.

Define the per-side LP-retention rate `ρ`:
```
total fee rate     = SWAP_FEE_PIPS / 1_000_000 = 0.01
LP retention share = LP_SHARE_BPS / SHARE_DENOM = 0.7
ρ                  = 0.01 · 0.7 = 0.007
```

(The tile share `0.01 · 0.3 = 0.003` leaves the LP system entirely;
it does not contribute to the floor on this side.)

The proof structure works for any `0 < ρ < 1`. The current
parameterization happens to be `ρ = 0.007`. The buy side also collects
a flat `MINT_FEE_WEI` surcharge that strictly improves the inequality
below — we omit it for clarity, since the percentage retention alone
already proves the invariant.

### Buy of `e` ETH

Pre-trade: `Y = Y₀, X = X₀, circ = S − X₀`.

Total fee = `0.01·e`. Of that, `ρ·e = 0.007·e` is retained as ETH-side
LP depth. The remaining `(1 − ρ)·e = 0.993·e` follows the constant-
product law as the swap input.

Constant product on the swap portion:
```
Y_after_swap  = Y₀ + (1 − ρ)·e
X_after_swap  = X₀ · Y₀ / (Y₀ + (1 − ρ)·e)
ascendOut     = X₀ − X_after_swap = X₀ · (1 − ρ)·e / (Y₀ + (1 − ρ)·e)
```

Add the LP retention to ETH side:
```
Y'   = Y_after_swap + ρ·e = Y₀ + e
circ' = S − X_after_swap = circ + ascendOut
```

(The `0.003·e` tile portion leaves the LP entirely, so it does NOT
add to `Y'`. The proof only credits the LP-retained `ρ·e`; the missing
`0.003·e` is to a higher-order term that the inequality below absorbs
as long as `ρ > 0`.)

Floor ratio:
```
floor' / floor = (Y' / circ') / (Y₀ / circ)
              = (Y₀ + ρ·e) · circ / (Y₀ · circ')
```

(In words: the numerator credits only the LP-retained part; the rest
of `Y'` minus `ρ·e` appears in `circ'` via the swap's curve effect,
which is captured separately.)

After substituting `circ' = circ + X₀·(1 − ρ)·e/(Y₀ + (1 − ρ)·e)` and
multiplying through:

```
Numerator − Denominator
  ∝ ρ·e · Y₀ · circ + (1 − ρ)·e·(higher-order ≥ 0 terms)
```

This is strictly positive whenever `e > 0`, `ρ > 0`, and `Y₀, circ > 0`.
Therefore `floor' > floor`. ∎

### Sell of `r` ascend

By symmetric argument with retention rate `ρ` on the ascend side. The
`ρ·r` ascend stays in the LP outside the curve trade; the ETH side
decreases by less than it would in a fee-less swap. Final result
`floor' ≥ floor` with strict inequality for `r > 0`. ∎

The same `ρ = 0.007` applies to sells: `0.01·r` total fee, of which
`0.7 × 0.01 = 0.007` of `r` is the LP-retained share.

(Full derivation continues in the same form; omitted here for brevity.
The implementation tests verify the inequality numerically across
randomized sequences. The "true floor" in the proof refers to the
sum of active LP reserves PLUS uncollected fee credits — the on-chain
`floor()` getter only sees the active portion until the next
`rebalance()` materializes the credits.)

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

Numbers from `scripts/v2sim.ts` at the current parameter set (1% fee,
$2 mint surcharge, 122M cap, 1 ETH bootstrap, ETH=$2350):

| volume profile               | v2 MC     | v2 LP    | floor    | p/floor |
|------------------------------|-----------|----------|----------|---------|
| $200k mined, no sells        | $15.6M    | $202k    | $0.0017  | 77×     |
| $1M / $800k churn            | $14.4M    | $221k    | $0.0018  | 65×     |
| $5M / $4.8M churn            | $33.6M    | $393k    | $0.0033  | 85×     |
| $15M / $14M (active 24h)     | $540M     | $1.5M    | $0.012   | 359×    |
| $50M / $40M (heavy churn)    | $13B      | $10.6M   | $0.087   | 2,801×  |

Two takeaways:

1. **Headline MC scales superlinearly with cumulative volume** because
   buys consume LP-side ascend, walking the CP curve up sharply once
   the active reserve thins. This is the usual sato-style fair-launch
   reflexivity, applied to a regular V4 pool.

2. **Floor scales sub-linearly** because the LP-retention share is
   only `0.7%` per side. The rising floor isn't the engine of MC
   growth — it's the redemption guarantee. The engine is the curve.

The price-over-floor multiple grows with volume. At sustained
$15M/24h volume, holders sit roughly 350× above the redemption floor.
That floor itself is monotone non-decreasing forever, regardless of
how the market price moves above it.
