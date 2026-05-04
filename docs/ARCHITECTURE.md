# sato — architecture

## the curve

let `E` be the cumulative ETH ever paid in (post-fee). the issuer
defines two functions:

```
p(E) = (S/K) · e^(  E/S )       marginal price, ETH per sato
N(E) = K   · ( 1 - e^(-E/S) )   total supply at state E
```

with `S = 500 ETH` and `K = 21,000,000`.

these are inverses of each other in the obvious way:
`dN/dE = (K/S) · e^(-E/S) = 1/p(E)`. that identity is what makes the
curve invertible — buying integrates the spend across the price wedge,
selling unwinds the same wedge.

## buy

input: `ethIn`. compute fee, then move along the curve:

```
fee     = ethIn · 0.003                 (0.3% bps)
net     = ethIn - fee
E_old   = cumulativeEth                  (state before)
E_new   = E_old + net                    (state after)
satoOut = N(E_new) - N(E_old)
        = K · (e^(-E_old/S) - e^(-E_new/S))
```

then mint `satoOut` to the buyer, add `fee` to the issuer balance, and
write `cumulativeEth = E_new`.

## sell

input: `satoIn`. unwind the same wedge:

```
N_old   = N(E)                          ≡ totalSupply on the curve
N_new   = N_old - satoIn
E_new   = -S · ln(1 - N_new/K)
gross   = E - E_new
fee     = gross · 0.003
ethOut  = gross - fee
```

burn `satoIn`, transfer `ethOut`, write `cumulativeEth = E_new`.

## the solvency invariant

at every block, the issuer balance equals
`cumulativeEth + accumulatedFees`. buys add `net` to cumulativeEth and
`fee` to fees; sells take `gross = fee + ethOut` out of the contract
balance and reduce cumulativeEth by `gross`, leaving fees untouched.

since `gross ≤ E` (you cannot move past zero), the balance never goes
negative. the asymptote at `K` makes selling all of the supply
mathematically impossible — the inverse function diverges as `N → K`.

the test suite asserts this invariant after every buy and sell in a
randomized sequence.

## anti-MEV

two protections, both small:

- **per-buy cap of 5 ETH.** prevents single-block whale buys from racing
  the price function. with `S = 500 ETH`, a 5 ETH buy moves cumulative
  ETH by 1% of S — meaningful but bounded.
- **same-block sell-after-buy revert.** prevents an attacker from
  buying at price `p`, observing a follow-up buy in the same block, and
  unwinding before any other actor can react.

these are sufficient because the curve has no AMM-style slippage to
attack; price is a closed-form function of `E`, not a function of
liquidity ratios.

## why no Uniswap pool, no LP token, no admin

every alternative architecture either:

- splits price discovery across multiple venues (a parallel Uniswap
  pool would arbitrage against the issuer constantly), or
- hands custody of part of the system to an account or a position that
  can be removed.

the issuer is the only venue. the issuer has no owner. there is nothing
to remove and nothing to administer.

## what the contract cannot do

- mint sato outside of `buy()`
- burn sato outside of `sell()`
- transfer ETH out except through `sell()`
- pause, blacklist, upgrade, rescue, refund
- be reconfigured by anyone

if every wallet associated with the deploy disappears tonight, the
contract still runs tomorrow at exactly the same prices.
