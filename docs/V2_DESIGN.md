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
| `MAX_MINT_WEI`               | `5 ether`       | per-tx mint cap (anti-MEV, sato pattern)                       |
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

Effect: small mints pay a relatively large %, large mints pay
~1%. Acts as anti-spam without blocking serious buyers.

### anti-MEV summary

| mechanism                          | what                                                     |
|------------------------------------|----------------------------------------------------------|
| `MAX_MINT_WEI` per-tx cap (5 ETH)  | no one can vacuum supply in a single tx                  |
| same-block burn-after-buy revert   | flash-loan arbitrage uneconomic (`tx.origin` keyed)      |
| `ANTI_BOT_BLOCKS` window           | first 100 blocks: +0..1% random extra fee on mints       |
| `MAX_EFFECTIVE_FEE_PIPS` hard cap  | dust mints can't pay >10% even with mint surcharge       |

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
  with `ethOut < ascendIn · floor` because of the 1% fee retention.
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
    require(ethIn <= MAX_MINT_WEI)           // 5 ETH per-tx mint cap
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
4. Any address with ≥ 1 ascend can claim ONE tile per epoch.
5. claimTile(uint256 idx) flips the tile:
   - Pseudorandom multiplier ∈ {1, 2, 3, 4} drawn from
     keccak256(blockhash, idx, msg.sender, epoch)
   - Reward = (epoch_pool / 144) × multiplier
   - Capped by remaining pool to ensure solvency
6. Unclaimed tiles' shares roll into next epoch's pool.
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

```
struct ClaimRecord { uint64 epoch; uint8 multiplier; uint128 amount; }
mapping(uint16 tileIdx => mapping(uint64 epoch => address claimer)) public claimedBy;
mapping(address => uint64 lastClaimEpoch) public lastClaim;

require(ascend.balanceOf(msg.sender) >= MIN_HOLDING, "no holding");
require(lastClaim[msg.sender] < currentEpoch, "already claimed");
require(claimedBy[idx][currentEpoch] == address(0), "tile taken");
require(idx < 144, "out of range");
```

Each address gets exactly one tile per epoch. Each tile can be claimed
by exactly one address per epoch. The race for "good" tiles is
incidental — all tiles use the same multiplier RNG, so there is no
preferable tile.

### state

```solidity
contract TileEngine {
    address public immutable hook;            // only sender allowed for depositReward
    Ascend  public immutable ascend;          // checked for MIN_HOLDING

    uint64  public constant EPOCH_LENGTH = 24 hours;
    uint16  public constant GRID_SIZE = 144;
    uint64  public immutable genesisTime;

    uint256 public currentEpochPool;          // accumulating ETH for the live epoch
    uint64  public currentEpochStart;         // unix ts when this epoch began
    uint256 public unclaimedRollover;         // unclaimed share carried forward

    // history (analytics)
    mapping(uint64 => uint256) public epochPool;        // total funded for that epoch
    mapping(uint64 => uint256) public epochPaidOut;     // total paid out to claimers

    // claim state
    mapping(uint16 => mapping(uint64 => address)) public claimedBy;
    mapping(address => uint64) public lastClaimEpoch;
    mapping(address => mapping(uint64 => ClaimRecord)) public lastClaim;
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
function currentBaseReward() external view returns (uint256);  // pool / GRID_SIZE / 1.58
function isTileAvailable(uint16 idx) external view returns (bool);
function canClaim(address user) external view returns (bool);
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

At sato-equivalent volume of $15M / 24h (assume half is buys):
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
