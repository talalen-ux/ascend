# ASCENT

A Uniswap v4 hook-powered asset where price is distorted by the cumulative
memory of buying pressure. The AMM is augmented with a stateful multiplier:

```
m(F, V, D, C) = exp( α · tanh(z) )
z = (F + γV)/S_F + θ·ln(1 + D/S_D) − φ·(C/S_C)^p
```

Naturally bounded (no clamps), multiplicatively symmetric, momentum-aware.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the derivation and
why this strictly dominates a single-state bonding curve like
`K·(1 − e^{−E/S})`.

- **BUY** (currency0 → currency1): user receives `baseOut / m`. The
  `(m−1)/m` fraction of input is taxed into a per-pool treasury.
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
