# ascend

> a self-compounding asset.

ascend is a fair-launch ERC-20 issued by a Uniswap V4 hook. the hook *is*
the engine: every swap routes through it, every swap moves the floor up,
and the floor is the price both sides pay.

## one venue, one price

| where you trade        | what happens                                        |
|------------------------|-----------------------------------------------------|
| this dapp              | calls the AscendRouter, which calls PoolManager.swap |
| Uniswap.org (v4 UI)    | calls PoolManager.swap directly                     |
| any v4 aggregator      | calls PoolManager.swap                              |
| any contract / EOA     | unlocks PoolManager and calls swap                  |

every path lands in the same `beforeSwap` callback on the hook. the hook
returns the same delta. **same price by construction**, not by arbitrage.

## the math

```
floor             = vault / supply        ETH per ascend (hook balance / total supply)
mining fee        = 5% of ETH in          retained in vault, deepens backing
redemption fee    = 5% of ETH out        retained in vault, deepens backing
```

both sides trade at `floor`. the fees are not paid to anyone — they
remain in the vault permanently as additional backing for every
remaining holder.

**theorem 1 (mining lifts the floor).** for any `e > 0`,
`floor' / floor = (R + e) / (R + 0.95·e) > 1`.

**theorem 2 (redemption lifts the floor).** for any `0 < r < S`,
`floor' / floor = (S − 0.95·r) / (S − r) > 1`.

**corollary (monotone).** the floor at the end of any finite sequence of
trades is at least the floor at the start. the floor cannot go down,
ever, under any sequence of buys and sells.

read the full treatment, including the solvency invariant and the
security model, in the [whitepaper](./app/whitepaper/page.tsx).

## architecture

```
contracts/src/
  Ascend.sol        ERC-20. lowercase name & symbol. sole minter is the hook.
  AscendHook.sol    Uniswap V4 hook. holds reserves. intercepts every swap.
                    rejects exact-output. rejects all LP. transient reentrancy guard.
  AscendRouter.sol  one-call buy/sell wrapper for the dapp. no privileged role.

contracts/script/
  Deploy.s.sol      mines a CREATE2 salt for the hook permission flags,
                    deploys the hook with 0.001 ETH bootstrap, initializes
                    the canonical pool, deploys + binds the router.

contracts/test/
  AscendHook.t.sol  uses v4-core's Deployers + HookMiner. exercises real
                    PoolManager swaps. asserts monotonicity and solvency
                    after every step of a randomized 40-trade sequence.

app/, components/, hooks/, lib/  Next.js dapp.
  app/whitepaper/   formal whitepaper page with the proofs.
  components/Connect  wagmi connect (injected + Coinbase Wallet).
  components/VenueRow links to the same pool on Uniswap and Dexscreener.
```

## the design that makes this work

V4 hooks can fully override the AMM behavior with a `BeforeSwapDelta`.
`AscendHook` does exactly that:

1. The pool is initialized with `currency0 = ETH`, `currency1 = ascend`,
   `fee = 0`, `tickSpacing = 60`. **no liquidity is ever provided**;
   `beforeAddLiquidity` reverts.
2. Every swap calls `beforeSwap(...)` on the hook.
3. The hook computes `floor = reserve / supply` from its current state.
4. For a buy: it `take`s the ETH input from the PoolManager, mints the
   appropriate amount of ascend to the PoolManager, and `settle`s. The
   delta returned cancels the AMM portion of the swap entirely.
5. For a sell: it `take`s the ascend input, burns it, and `settle`s ETH
   to the PoolManager.
6. The PoolManager forwards the swap output to the swapper.

Whether the swap originated from the dapp router, Uniswap.org's UI, an
aggregator, or any other contract, the hook sees the same call shape and
returns the same delta. The price is identical by execution path,
not by arbitrage.

## quickstart

### contracts

```sh
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts \
  Uniswap/v4-core Uniswap/v4-periphery
forge build
forge test -vv
```

### deploy (mainnet)

```sh
PRIVATE_KEY=0x... \
POOL_MANAGER=0x000000000004444c5dc75cb358380d2e3de08a90 \
  forge script contracts/script/Deploy.s.sol:Deploy \
  --rpc-url <rpc> --broadcast
```

The script:

1. Mines a CREATE2 salt that produces a hook address with the right
   permission bits set (`afterInitialize`, `beforeAddLiquidity`,
   `beforeSwap`, `beforeSwapReturnsDelta`).
2. Deploys the hook with exactly `0.001 ETH` value (the bootstrap).
3. Initializes the pool at `1.0` (irrelevant — hook overrides pricing).
4. Deploys the AscendRouter and binds it to the canonical pool key.

It prints the hook address, the ascend token address, the router
address, and the pool ID. Set them in the dapp env.

### dapp

```sh
cat > .env.local <<EOF
NEXT_PUBLIC_CHAIN_ID=1
NEXT_PUBLIC_POOL_MANAGER=0x000000000004444c5dc75cb358380d2e3de08a90
NEXT_PUBLIC_ASCEND_HOOK=0x...      # from deploy
NEXT_PUBLIC_ASCEND_ROUTER=0x...    # from deploy
NEXT_PUBLIC_ASCEND_TOKEN=0x...     # from deploy (= hook.ascend())
NEXT_PUBLIC_POOL_ID=0x...          # from deploy
EOF
npm install
npm run dev
```

## dexscreener / geckoterminal

Dexscreener and GeckoTerminal index Uniswap V4 pools automatically once
their indexers cover the chain and version. Nothing to apply for. Once
the deploy lands, the pool ID is the public identifier; share it.

## the promises

- no team allocation, no presale, no vesting
- no admin, no pause, no upgrade, no withdraw
- no off-chain oracle, no off-chain price, no migration path
- the hook is its own counterparty to every holder

## status

| area                       | status                                                 |
|----------------------------|--------------------------------------------------------|
| floor-lift math            | implemented + property-proven in the whitepaper        |
| monotone-floor invariant   | asserted under randomized 40-trade sequence            |
| solvency invariant         | asserted under randomized sequence                     |
| reject-LP                  | beforeAddLiquidity reverts                             |
| reject exact-output        | beforeSwap reverts on `amountSpecified > 0`            |
| reentrancy guard           | EIP-1153 transient storage                             |
| bootstrap                  | constructor enforces 0.001 ETH, locks 1 ascend forever |
| dapp                       | live state, projection chart, buy/sell UI              |
| wallet connect             | injected + Coinbase Wallet via wagmi v2                |
| router                     | single-tx buy/sell via PoolManager.unlock              |
| whitepaper page            | shipped at `/whitepaper`                               |
| deploy with HookMiner      | one-shot, deterministic                                |

not audited. read the source.
