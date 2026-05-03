# ASCENT

**A store of value with memory. The market that rewards patience.**

Ascent is a single token in a single Uniswap v4 pool with one rule baked
into the AMM itself:

- **Buyers pay a premium during hype.** The faster the rush, the steeper
  the premium. Premiums fund a per-pool holder reserve.
- **Sellers receive a bonus when hype cools.** Patience is paid out in
  cash, drawn from the reserve that earlier buyers filled.
- **The market reverts on its own.** Memory of recent activity decays
  every block — no keeper, no team intervention, no governance.

There is no inflation, no team unlock, no staking flow. Time becomes a
price input. Patience compounds into a real bonus on exit.

See the on-site [Docs](./app/page.tsx) section for the plain-language
explanation, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
math derivation.

## How the swap path works

The AMM is augmented with a stateful demand premium:

```
m(F, V, D, C) = exp( α · tanh(z) )
z = (F + γV)/S_F + θ·ln(1 + D/S_D) − φ·(C/S_C)^p
```

Naturally bounded (no clamps), multiplicatively symmetric, momentum-aware.

- **BUY** (currency0 → currency1): user receives `baseOut / m`. The
  `(m−1)/m` fraction of input is taxed into a per-pool holder reserve
  (the "treasury").
- **SELL** (currency1 → currency0): user receives `baseOut + bonus`,
  where `bonus = min(amountIn·(m−1), treasury)`. The hook is always
  solvent.
- **Exact-output** swaps revert (closes the arbitrage path that would
  exist if exact-output bypassed the multiplier).

## Layout

```
./           Next.js 14 dapp (Vercel root) — app, components, hooks, lib
contracts/   Foundry — AscentToken, AscentHook, AscentQuoter, libs, tests
backend/     Lightweight indexer (viem + sqlite + fastify)
scripts/     deploy convenience wrapper
docs/        architecture
.github/     CI workflow
```

## Quickstart

### Frontend (this directory)

```sh
cp .env.example .env.local   # fill in addresses + poolId (optional — demo mode otherwise)
npm install
npm run dev
```

### Contracts

```sh
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts \
  PaulRBerg/prb-math Uniswap/v4-core Uniswap/v4-periphery
forge build
forge test -vv
```

### Indexer

```sh
cd backend/indexer
cp .env.example .env         # HOOK_ADDRESS + RPC_URL
npm install
npm run dev
```

### Deploy

```sh
POOL_MANAGER=0x... TOKEN_RECIPIENT=0x... PRIVATE_KEY=0x... \
  npx tsx scripts/deploy.ts --rpc <rpc-url>
```

The deploy script mines a CREATE2 salt so the hook address encodes the
required permission flags (`AFTER_INITIALIZE` + `BEFORE_SWAP` +
`BEFORE_SWAP_RETURNS_DELTA`). It also deploys the quoter.

## Status

| area                          | status                                     |
|-------------------------------|--------------------------------------------|
| math core (SR-TEC)            | implemented + property-tested              |
| per-pool state + decay        | implemented + tested                       |
| reentrancy guard              | EIP-1153 transient storage                 |
| exact-output handling         | reverts (`ExactOutputNotSupported`)        |
| v4 integration tests          | included (`AscentHookIntegrationTest`)     |
| quoter                        | `AscentQuoter` — exact off-chain mirror    |
| frontend wiring               | quoter + `PoolSwapTest` execute path       |
| indexer                       | per-pool history; new event payload        |
| CI                            | foundry build + test on push               |

Not audited. Treasury solvency is mathematically guaranteed; the hook
itself has not been through a third-party review. The `PoolSwapTest`
router is the v4 reference router for tests; substitute the
`UniversalRouter` for production swap flows on chains where it supports
v4.
