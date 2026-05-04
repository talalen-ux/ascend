# sato

> the contract that priced the first buy will price every buy after it. forever.

sato is a fair-launch ERC-20 issued from a single bonding-curve contract on
Ethereum. there is no team wallet, no LP position, no migration path, no
admin. price is a deterministic function of cumulative ETH ever paid in;
supply asymptotes at 21,000,000 and never quite reaches it.

## the function

```
p(E) = (S/K) · e^( E/S )                    marginal price (ETH per sato)
N(E) = K · ( 1 - e^( -E/S ) )               total supply at cumulative ETH E

S = 500 ETH
K = 21,000,000
fee = 0.3% on both directions, accumulated in the issuer permanently
```

every wei of ETH ever paid in lives in the issuer contract. sells reverse
the function: burning sato moves cumulative-ETH backward by exactly the
wedge it represents under the curve, and the user is paid that ETH from
the contract balance. the contract is its own counterparty.

two protections against same-block manipulation:

- each buy is capped at **5 ETH**
- selling in the same block as your last buy reverts

these are the only frictions. there is no other state.

## architecture

```
contracts/
  src/
    Sato.sol         ERC-20. lowercase name & symbol. sole minter is the issuer.
    SatoHook.sol     the issuer. buy/sell + curve state. holds all ETH forever.
    SatoMath.sol     exp/ln helpers (PRBMath SD59x18) for the curve.
  script/Deploy.s.sol   one-shot deploy. nothing to configure.
  test/SatoHook.t.sol   round-trip + invariants + cap/lockout tests.

app/, components/, hooks/, lib/    Next.js dapp.
  lib/curve.ts        off-chain mirror of SatoMath for instant quoting.
```

the issuer constructor deploys the sato token with the issuer address
locked in as the sole minter. there are no setters, no admin role, no
upgrade path. once the deploy transaction lands, the contract is the
contract.

## quickstart

### contracts

```sh
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts PaulRBerg/prb-math
forge build
forge test -vv
```

### deploy

```sh
PRIVATE_KEY=0x... forge script script/Deploy.s.sol:Deploy \
  --rpc-url <rpc> --broadcast
```

prints the issuer address and the sato token address. add the issuer
address to your dapp env as `NEXT_PUBLIC_SATO_HOOK`.

### dapp

```sh
echo 'NEXT_PUBLIC_SATO_HOOK=0x...' > .env.local   # optional — demo mode otherwise
echo 'NEXT_PUBLIC_CHAIN_ID=1'      >> .env.local
npm install
npm run dev
```

## design notes

**why the bootstrap-randomness window was cut.** the manifesto draft
referenced a per-buy random multiplier between 0.9 and 1.1 over the first
100 blocks. any range that includes mult > 1 (favoring the buyer) puts the
issuer in a position where total ETH credited to the curve exceeds total
ETH actually held, breaking solvency for future sells. dropping the
window makes the contract deterministic from genesis instead of from
block 100, which is a cleaner expression of the manifesto's thesis.

**why the fees can never be withdrawn.** there is no withdraw function.
the fees sit in the issuer balance forever. they back nothing, fund
nothing, and pay nothing. they exist to widen the round-trip spread by
0.6%, slowing the wash-trade attack surface without creating a treasury
that someone has to govern.

**why no Uniswap pool.** the manifesto's thesis is "the contract that
priced the first buy will price every buy after it." adding a parallel
AMM pool — even with the issuer wired in as a hook — splits price
discovery between two surfaces. the only way to honor the thesis
literally is to make the issuer the only buy/sell venue.

## status

| area              | status                                  |
|-------------------|-----------------------------------------|
| curve math        | implemented + property-tested           |
| solvency invariant| asserted in fuzz-style sequence test    |
| 5 ETH per-buy cap | enforced                                |
| same-block lockout| enforced                                |
| deploy script     | one-shot, no configuration              |
| dapp              | live state, curve preview, buy/sell UI  |

not audited. the contract is small and the invariants are simple, but
that is not a substitute for a third-party review on anything you put
real money into.
