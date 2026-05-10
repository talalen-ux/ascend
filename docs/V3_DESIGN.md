# ascend v3 — sato-style bonding curve

> a specter has returned to ethereum: the specter of code that runs without an operator.

v3 replaces the v2 fixed-supply / sole-LP design with a sato-style bonding curve. supply starts at zero. mints and burns happen against a deterministic exponential curve. the hook is the issuer; there is no LP, no genesis pre-mint, no bootstrap.

## the core property

every circulating ascend exists because someone paid ETH for it. the protocol's reserve is the proof. if every holder burned their ascend, every wei they paid in (less the protocol fee) flows back out via the inverse curve.

there is no premine, no team allocation, no foundation cut, no admin key, no upgrade path, no migration plan. the only path the supply can change is the curve.

## the math

| symbol | value | meaning |
|---|---|---|
| `K` | 21,000,000 ascend | asymptotic supply cap (curve becomes uneconomic past this) |
| `S` | 500 ETH | curve scale factor |
| `e` | `cumulativeEthIn` | net ETH ever minted with (after fees) |
| `q(e)` | `K · (1 − e^(−e/S))` | minted supply at curve position `e` |
| `Δe(q, b)` | `S · ln((K − q + b) / (K − q))` | ETH owed on burning `b` from supply `q` |

the curve is asymptotic at `K`. effective reachable supply is bounded near 20.5M; minting past that costs more ETH per token than secondary markets would pay.

## fees

| fee | rate | destination |
|---|---|---|
| mint fee (total) | 0.7% of `ethIn` | split below |
| burn fee (total) | 0.7% of `Δe` | split below |
| reserve share | 0.5% (5/7 of fee) | retained as reserve, raises burn floor |
| tile share | 0.2% (2/7 of fee) | accrues to TileEngine on every `sweep()` |

reserve share never leaves the protocol. tile share funds the 12×12 tile-flip game.

## anti-MEV

- **`MAX_MINT_PER_TX = 5 ETH`** — single-tx vacuum cap.
- **same-block burn-after-mint reverts** — `lastMintBlock[tx.origin] == block.number` on burn → revert. (anti-flash-loan; see `SameBlockBurnAfterMint`.)

## V4 plumbing

the curve is a uniswap v4 pool with a hook attached. the pool is initialized with a sentinel `sqrtPriceX96 = 2^96` and **never receives liquidity**. every swap is intercepted in `_beforeSwap` which:

1. computes the curve forward (mint) or inverse (burn)
2. mints new ascend directly to the PoolManager (mint case) or burns ascend claim tokens (burn case, deferred to `sweep()`)
3. returns a `BeforeSwapDelta` that nets the AMM swap to zero

the hook holds the protocol's reserve as ERC-6909 currency0 (ETH) **claim tokens** with the PoolManager. these are IOUs that are 1:1 backed by ETH actually held by the PoolManager. `reserveEth()` reads the claim balance.

burned ascend accumulates as currency1 claim tokens until `sweep()` actually deletes them from the ERC-20 supply.

## sweep

a permissionless function (`sweep()`) anyone can call. it:

1. burns all accumulated ascend claims (decrements `ascend.totalSupply()`)
2. routes the accrued tile share to TileEngine
3. emits the new reserve

sweep doesn't change any economic invariants — it's just bookkeeping.

## architecture

```
contracts/src/
  Ascend.sol         ERC-20. lowercase name & symbol. only the hook can mint/burn.
  AscendHookV3.sol   V4 hook. the issuer. holds the reserve as claim tokens.
                     implements bonding curve via beforeSwap + BeforeSwapDelta.
                     rejects all external LP. EIP-1153 not needed (PM lock guards).
  AscendRouterV3.sol thin unlock-callback wrapper. EOAs call buy/sell here.
  TileEngine.sol     12×12 grid, 24h epochs. Funded by sweep() from mint+burn fees.

contracts/script/
  DeployV3.s.sol     mines hook salt for the BeforeSwapDelta-capable permission set,
                     deploys hook + initializes pool + deploys router in one tx.

contracts/test/
  AscendHookV3.t.sol 13 tests: genesis state, mint, burn, anti-MEV, floor monotone,
                     sweep, quotes match actual swaps.
```

## what changes vs v2

| | v2 | v3 |
|---|---|---|
| issuance | fixed supply, pre-minted to LP | bonding curve, mint per buy |
| genesis | 1 ETH bootstrap, atomic seed | none — supply starts at 0 |
| LP | hook is sole LP, holds 122M ascend | no LP — hook holds reserve as claim tokens |
| curve | constant-product `Y · X = k` | exponential `q(e) = K · (1 − e^(−e/S))` |
| cap | hard 122M | soft, asymptotic ~20.5M |
| swap math | runs through V4 AMM with hook fee override | bypassed entirely via `BeforeSwapDelta` |
| swap fees | 1% / 1% | 0.7% / 0.7% |
| fee split | 70% LP / 30% TileEngine | 5/7 reserve / 2/7 TileEngine |
| floor | `Y / circulating` (Y = LP ETH) | `(S/(K−q)) · (1 − fee)` (curve marginal) |
| burn → fee | 1% input fee in ETH | 0.7% of `Δe` |
| anti-MEV cap | flat-fee + 10% max effective fee | 5 ETH per-tx hard cap |
| anti-bot launch window | 100-block randomized fee | not in V3 (could be added) |
| rebalance | on-demand, pulls accumulated LP fees | n/a — sweep handles deferred work |

## what stays

- lowercase `ascend` token name and symbol
- TileEngine 12×12 grid, 24h epochs, 68% selection rate, 1× to 4× multipliers
- no admin / no team / no presale / no upgrade
- same-block burn-after-mint anti-flash-loan guard
- `tx.origin`-keyed origin tracking through routers

## not yet shipped

- Sato's anti-bot launch window with random ±10% multiplier on first-100-block mints (could be added; keeps cleaner curve math)
- secondary AMM pool for sato/USDC (single-sided LP support is *additive* — see Sato's docs; can be deployed alongside without touching v3 hook)

## status

`forge build`: passes. `forge test`: **13/13** v3-specific tests passing on first run; full suite (V2 + V2 router + V3) at **43/43**.
not yet redeployed to Sepolia. v2 deployment at `0x7fdA89dBd683336D4d0bEd6528003faCA46B9880` remains live for comparison testing if desired.
