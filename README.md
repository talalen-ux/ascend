# ASCENT

A Uniswap v4 hook-powered asset where price is distorted by the cumulative
memory of buying pressure. The AMM is augmented with a stateful multiplier
`m(E)` that grows with net buy flow and decays per block.

```
m(E) = exp(F/S₁) · (1 + ln(1 + D/S₂)) / (1 + C/S₃)        (clamped)
```

- **BUY** (ETH → ASCENT): user receives `baseOut / m`
- **SELL** (ASCENT → ETH): user receives `baseOut · m`, paid from a treasury
  funded by the buy-side pressure tax. Sell bonus is capped at the treasury
  balance to preserve solvency.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details and
trade-offs.

## Layout

```
contracts/   Foundry project — AscentToken, AscentHook, deploy + math tests
frontend/    Next.js 14 app — dashboard, trade panel, momentum graph
backend/     Lightweight TS indexer (viem + better-sqlite3 + fastify)
scripts/     deploy convenience wrapper
docs/        architecture + spec
```

## Quickstart

### Contracts

```sh
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts \
  PaulRBerg/prb-math Uniswap/v4-core Uniswap/v4-periphery
forge build
forge test -vv
```

### Frontend

```sh
cd frontend
cp .env.example .env.local   # fill in addresses
npm install
npm run dev
```

### Indexer

```sh
cd backend/indexer
cp .env.example .env         # fill in HOOK_ADDRESS + RPC_URL
npm install
npm run dev
```

### Deploy

```sh
POOL_MANAGER=0x... TOKEN_RECIPIENT=0x... PRIVATE_KEY=0x... \
  npx tsx scripts/deploy.ts --rpc <rpc-url>
```

The deploy script mines a CREATE2 salt so the hook address encodes the
required permission flags (`BEFORE_SWAP` + `BEFORE_SWAP_RETURNS_DELTA`).

## Status

This is a working scaffold, **not** an audited system.

- The hook delta semantics are implemented to the best of the v4 spec but
  have **not** been integrated against a live `PoolManager`. Test against
  the v4 deployer fixtures before touching real liquidity.
- The trade panel does not yet route through the v4 router — the "Execute"
  button is intentionally disabled. Wiring it requires the chosen v4
  router/quoter for your target chain.
- Treasury solvency for sell bonuses is best-effort: the bonus is bounded
  by the hook's own currency0 balance.
