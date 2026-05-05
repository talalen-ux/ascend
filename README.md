# rise

> every trade is bullish.

rise is a self-compounding ethereum-native asset. one contract holds
every wei ever paid in. the price floor is `reserve / supply`, and by
construction it can only go up.

```
floor       = reserve / supply
buy fee     = 1%   (stays in reserve, lifts the floor)
sell fee    = 3%   (stays in reserve, lifts the floor)
```

both sides trade at the same price — the floor. there is no spread, no
oracle, no AMM curve. fees are not paid to anyone; they sit in the
contract permanently and back the floor for everyone.

## why the floor only goes up

let `floor = R / S`.

```
buy of e ETH:    floor' / floor = (R + e) / (R + 0.99·e)            > 1
sell of r rise:  floor' / floor = (S − 0.97·r) / (S − r)            > 1
```

both ratios are strictly greater than 1. the floor is monotone
non-decreasing. there is no sequence of trades — buys, sells, or any
mix — that can lower it. ever.

read the [whitepaper](./app/whitepaper/page.tsx) for the full
treatment, including the solvency invariant and the security model.

## how to enter and exit

**1. via the dapp (primary venue, best execution).** connect any web3
wallet on the homepage and use the trade panel. fees are 1% in / 3%
out. this is the engine — the only venue where the floor lift actually
happens.

**2. via uniswap v2 (for indexer visibility).** post-deploy, a small
locked-LP rise/WETH pool is created so trackers like Dexscreener and
GeckoTerminal pick rise up automatically. arbitrageurs keep its mid-price
soft-pegged to the engine floor (within the 4% round-trip band).
trading directly through uniswap works but execution is worse than the
engine for any non-trivial size — the dapp will always route to the
engine.

## architecture

```
contracts/
  src/
    Rise.sol          ERC-20. lowercase name & symbol. sole minter is the engine.
    RiseEngine.sol    buy/sell. holds all ETH forever. no admin, no withdraw.
  script/Deploy.s.sol one-shot deploy. bootstrap reserve = 0.001 ETH.
  test/RiseEngine.t.sol  monotonicity proof + solvency invariant + fee math.

scripts/
  seedUniswap.ts      post-deploy: seed v2 pool + lock LP for Dexscreener.

app/, components/, hooks/, lib/   Next.js dapp.
  app/whitepaper/     formal whitepaper page.
  components/Connect  web3 wallet connect (injected + Coinbase Wallet).
```

## quickstart

### contracts

```sh
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge build
forge test -vv
```

### deploy

```sh
PRIVATE_KEY=0x... forge script script/Deploy.s.sol:Deploy \
  --rpc-url <rpc> --broadcast --value 0.001ether
```

prints the engine address and the rise token address. set the engine
address as `NEXT_PUBLIC_RISE_ENGINE` in the dapp env.

### post-deploy: seed the uniswap pool (for Dexscreener)

```sh
PRIVATE_KEY=0x... \
RPC_URL=https://eth.llamarpc.com \
RISE_ENGINE=0x...                                          \
UNI_V2_ROUTER=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D   \
SEED_ETH=0.1                                                \
  npx tsx scripts/seedUniswap.ts
```

what this does:

1. buys 0.1 ETH worth of rise from the engine
2. adds 0.1 ETH + the resulting rise as v2 liquidity on uniswap
3. transfers the LP tokens to `0x000…dEaD`, locked forever

after this transaction confirms, Dexscreener and GeckoTerminal will
automatically index the pair within minutes. share the pair address (the
script prints it).

### dapp

```sh
cat > .env.local <<EOF
NEXT_PUBLIC_RISE_ENGINE=0x...   # engine address from deploy
NEXT_PUBLIC_CHAIN_ID=1
EOF
npm install
npm run dev
```

## the promises

- no team allocation, no presale, no vesting
- no admin, no pause, no upgrade, no withdraw function anywhere
- no off-chain oracle, no off-chain price, no migration path
- the contract is its own counterparty to every holder

## status

| area                          | status                                       |
|-------------------------------|----------------------------------------------|
| floor math                    | implemented + property-tested                |
| monotone-floor invariant      | asserted under randomized trade sequence     |
| solvency invariant            | asserted under randomized trade sequence     |
| fee math (1% / 3%)            | exact-match tested vs. quoter                |
| bootstrap                     | constructor enforces 0.001 ETH exactly       |
| dapp                          | live state, projection chart, buy/sell UI    |
| wallet connect                | injected + Coinbase Wallet via wagmi v2      |
| whitepaper page               | shipped at `/whitepaper`                     |
| uniswap seed script           | one-shot, locks LP, dexscreener-ready        |

not audited. the contract is small and the invariants are simple, but
that is not a substitute for a third-party review on anything you put
real money into.
