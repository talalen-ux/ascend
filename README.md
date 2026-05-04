# rise

> the floor only goes up.

rise is a fair-launch ERC-20 backed by ETH. one contract holds every wei
ever paid in. the price floor is `reserve / supply`, and by construction
it can only go up.

```
floor       = reserve / supply
buy fee     = 1%   (stays in reserve)
sell fee    = 3%   (stays in reserve)
```

both sides trade at the same price — the floor. there is no spread, no
oracle, no AMM curve. fees are not paid to anyone; they sit in the
contract permanently and back the floor for everyone.

## why the floor only goes up

let `floor = R / S` where R is the ETH reserve and S is the total supply.

**a buy adds X ETH:**

```
new R = R + X
new S = S + (X·0.99) / floor   ←  1% retained as fee
new floor / floor = (R + X) / (R + 0.99·X) > 1     for any X > 0
```

**a sell burns Y rise:**

```
new R = R − 0.97·Y·floor       ←  3% retained as fee
new S = S − Y
new floor / floor = (S − 0.97·Y) / (S − Y) > 1     for any 0 < Y < S
```

both ratios are strictly greater than 1. the floor is monotone
non-decreasing. there is no sequence of trades — buys, sells, or any
mix — that can lower it. ever.

## architecture

```
contracts/
  src/
    Rise.sol          ERC-20. lowercase name & symbol. sole minter is the engine.
    RiseEngine.sol    buy/sell. holds all ETH forever. no admin, no withdraw.
  script/Deploy.s.sol one-shot deploy. bootstrap reserve = 0.001 ETH.
  test/RiseEngine.t.sol  monotonicity proof + solvency invariant + fee math.

app/, components/, hooks/, lib/   Next.js dapp.
  lib/floor.ts        off-chain mirror for instant quotes & projection chart.
```

the engine constructor pays exactly 0.001 ETH and mints 1 rise locked
into the engine address itself (the engine has no path to spend its own
balance, so this rise can never be sold). that anchors the initial
floor at `0.001 ETH / 1 rise = 0.001 ETH per rise`.

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

### dapp

```sh
echo 'NEXT_PUBLIC_RISE_ENGINE=0x...' > .env.local   # demo mode otherwise
echo 'NEXT_PUBLIC_CHAIN_ID=1'        >> .env.local
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

not audited. the contract is small and the invariants are simple, but
that is not a substitute for a third-party review on anything you put
real money into.
