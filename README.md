# ascend

> a self-compounding asset.

ascend is a fair-launch ERC-20 issued by a Uniswap V4 hook. one pool,
one curve, one chart — and a 12×12 reward grid that pays holders out
of every swap.

## one venue, one price

| where you trade        | what happens                                        |
|------------------------|-----------------------------------------------------|
| this dapp              | swaps directly through PoolManager via the V4 router |
| Uniswap.org (v4 UI)    | calls PoolManager.swap                              |
| any v4 aggregator      | calls PoolManager.swap                              |
| any contract / EOA     | unlocks PoolManager and calls swap                  |

every path lands on the hook's `beforeSwap`. the hook is the only LP
on this pool; buys and sells walk the same constant-product curve at
the same price. **same chart by construction**, no off-pool routing,
no two-band whipsaw.

## the math

```
reserves           Y = ETH in LP, X = ascend in LP
spot price         Y / X        (the curve price; what swaps execute at)
floor              Y / (122M − X)   ETH per circulating ascend (redemption guarantee)
buy fee            1% base + ~$2 surcharge per buy (encoded as a per-swap fee adjustment)
sell fee           1% flat
fee split          70% retained as LP-side depth (raises floor)
                   30% routed to TileEngine (funds the daily tile lottery)
```

both buys and sells trade at the spot price (with normal CP slippage).
**the fee, not the curve, is what compounds the floor.** every swap
deepens the LP without minting any new ascend, so `Y / circulating`
strictly grows over time.

**theorem 1 (mining lifts the floor).** for any buy of `e ETH`:
`floor' / floor ≥ (Y + 0.7 × 0.01·e) · circ / (Y · circ') > 1`.

**theorem 2 (redemption lifts the floor).** for any sell of `r ascend`
where `0 < r < circulating`, the 1% retained-as-X plus the curve
mechanics give `floor' / floor > 1`.

**corollary.** the *true* floor (active reserves + uncollected fee
credits) is monotone non-decreasing under any finite trade sequence.
the on-chain `floor()` getter reads only active reserves and is a
conservative lower bound — see audit M-3.

## architecture

```
contracts/src/
  Ascend.sol         ERC-20. lowercase name & symbol. sole minter is the hook.
  AscendHookV2.sol   Uniswap V4 hook. owns the only LP. applies dynamic fee.
                     rejects external LP. EIP-1153 reentrancy guard.
  TileEngine.sol     12×12 grid, 24h epochs, 1×–4× multipliers, hook-only deposits.
  Genesis.sol        atomic deploy: hook + LP seed in one constructor.

contracts/script/
  DeployV2.s.sol     mines the CREATE2 salt for permission bits, computes
                     the genesis sqrtPriceX96, and broadcasts the Genesis
                     constructor with 1 ETH bootstrap.

contracts/test/
  AscendHookV2.t.sol uses v4-core's Deployers + HookMiner. 16 tests covering
                     init, fee routing, monotonicity (system-level), tile
                     game end-to-end. all passing.

app/, components/, hooks/, lib/   Next.js dapp.
  components/Tiles  the interactive 12×12 grid (the USP).
  components/Hero   the pitch.
  components/State  live-floor / live-MC / live-LP cells.
  components/Trade  buy/sell UI with quote + slippage.
```

## locked launch parameters

| | value |
|---|---|
| supply cap                | 122,000,000 ascend |
| bootstrap                 | 1 ETH (constructor enforces) |
| swap fee                  | 1% on both sides |
| flat mint surcharge       | 0.001 ETH (~$2 at typical prices) |
| LP retention share        | 70% of every fee |
| TileEngine share          | 30% of every fee |
| LP range                  | full range |
| pool fee                  | dynamic (hook overrides per swap) |
| anti-bot launch window    | 100 blocks (extra random 0–1% fee) |
| same-block burn-after-buy | reverts (anti-flash-loan) |
| max effective fee         | 10% (hard cap on dust mints) |
| tile grid                 | 12 × 12 |
| epoch length              | 24 hours |
| min holding to claim      | 1 ascend |

## quickstart

### contracts

The repo uses the `@uniswap/v4-template` lib layout (uniswap-hooks
vendors v4-core + v4-periphery at known-working commits).

```sh
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/uniswap-hooks akshatmittal/hookmate \
  --no-git --shallow
cd lib/uniswap-hooks && git submodule update --init --recursive --depth 1 && cd ../..
forge build
forge test -vv
```

### deploy (mainnet)

```sh
PRIVATE_KEY=0x... \
POOL_MANAGER=0x000000000004444c5dc75cb358380d2e3de08a90 \
  forge script contracts/script/DeployV2.s.sol:DeployV2 \
  --rpc-url <rpc> --broadcast --verify
```

The script:

1. Mines a CREATE2 salt for the permission flag set (`afterInitialize`,
   `beforeAddLiquidity`, `beforeSwap`, `afterSwap`).
2. Computes the genesis sqrtPriceX96 for 1 ETH : 122M ascend.
3. Deploys `Genesis{value: 1 ether}(...)` — its constructor performs
   hook deploy, pool initialize, and LP seed atomically.

It prints the hook, ascend, and TileEngine addresses. Set them in the
dapp env.

For a first-time foundry walkthrough see [docs/DEPLOY_GUIDE.md](./docs/DEPLOY_GUIDE.md).

### dapp

```sh
cat > .env.local <<EOF
NEXT_PUBLIC_CHAIN_ID=1
NEXT_PUBLIC_POOL_MANAGER=0x000000000004444c5dc75cb358380d2e3de08a90
NEXT_PUBLIC_ASCEND_HOOK=0x...     # from deploy
NEXT_PUBLIC_ASCEND_TOKEN=0x...    # from deploy (= hook.ascend())
NEXT_PUBLIC_TILE_ENGINE=0x...     # from deploy (= hook.tileEngine())
NEXT_PUBLIC_POOL_ID=0x...         # from deploy
EOF
npm install
npm run dev
```

## dexscreener / geckoterminal

Dexscreener and GeckoTerminal index Uniswap V4 pools automatically. The
LP is real and visible (the hook is the LP), so depth and chart show
up cleanly. Optional listings tier on Dexscreener costs ~0.05 ETH for
the official badge.

## the promises

- no team allocation, no presale, no vesting
- no admin, no pause, no upgrade, no withdraw
- no off-chain oracle, no off-chain price, no migration path
- the hook is the only LP on its pool — no third-party LP can rug

## docs

| | |
|---|---|
| [docs/HOW_IT_WORKS.md](./docs/HOW_IT_WORKS.md)   | plain-language explainer |
| [docs/V2_DESIGN.md](./docs/V2_DESIGN.md)         | locked spec + invariants + math |
| [docs/AUDIT_V2.md](./docs/AUDIT_V2.md)           | internal audit, severity-ranked |
| [docs/DEPLOY_GUIDE.md](./docs/DEPLOY_GUIDE.md)   | first-time foundry walkthrough |
| [docs/WHITEPAPER.md](./docs/WHITEPAPER.md)       | formal whitepaper |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)   | architecture overview |

## status

| area                            | status                                                |
|---------------------------------|-------------------------------------------------------|
| `forge build`                   | passes                                                |
| `forge test` (V2 suite)         | **16/16 passing**                                     |
| floor invariant                 | algebraically proved + system-level test under 30-step random sequence |
| supply cap invariant            | tested under random sequence                          |
| TileEngine end-to-end           | tested (epoch advance, multiplier bounds, solvency)   |
| anti-MEV (same-block-burn, dust) | tested                                               |
| anti-bot launch window          | tested (deterministic past block 100)                 |
| genesis atomic deploy           | tested via Genesis constructor                        |
| audit (internal)                | C-1..4, H-1..3, M-5 closed; M-3 documented            |
| third-party audit               | recommended before any meaningful TVL                 |

not yet shipped to mainnet. read the source.
