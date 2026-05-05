# ascend — architecture

## the floor

```
floor = reserve / supply       (ETH per ascend)
```

`reserve` is the contract's ETH balance. `supply` is `ascend.totalSupply()`.
both are public. anyone can compute the floor at any block. the engine
has no internal accounting on top of these two numbers — they are the
state.

## buy

```
fee     = ethIn · 0.05
net     = ethIn · 0.95
floorAt = reserve / supply              (before this trade)
ascendOut = net / floorAt
```

then mint `ascendOut` to the buyer and let `msg.value` rest in the
contract. no fee transfer happens — the fee stays in the contract by
not being subtracted from anything.

post-trade floor:

```
R'   = R + ethIn
S'   = S + (0.95 · ethIn) / (R/S)
       = S + 0.95 · ethIn · S / R
floor' = R' / S' = R(R+ethIn) / (S(R + 0.95·ethIn))
floor' / floor = (R+ethIn) / (R + 0.95·ethIn) > 1
```

floor strictly ascends on any buy with `ethIn > 0`.

## sell

```
floorAt = reserve / supply              (before this trade)
gross   = ascendIn · floorAt
fee     = gross · 0.15
ethOut  = gross · 0.85
```

then burn `ascendIn` from the seller, transfer `ethOut`. the fee stays in
the contract by not being transferred.

post-trade floor:

```
R'   = R − 0.85 · gross = R − 0.85 · ascendIn · R / S
       = R · (S − 0.85·ascendIn) / S
S'   = S − ascendIn
floor' = R' / S' = R · (S − 0.85·ascendIn) / (S · (S − ascendIn))
floor' / floor = (S − 0.85·ascendIn) / (S − ascendIn)
```

since `0.85·ascendIn < ascendIn`, the numerator exceeds the denominator and
the ratio is strictly greater than 1. floor strictly ascends on any sell
with `0 < ascendIn < S`.

## solvency

at any block, the engine balance equals every wei ever paid in by buys,
minus every wei ever paid out by sells. a sell of `ascendIn` (where
`ascendIn < S`) pays out `0.85 · ascendIn · R/S < R`. so the engine never
sends more than it holds. the test suite asserts this after every step
of a randomized trade sequence.

## bootstrap

at deploy, the constructor:

1. requires `msg.value == 0.001 ETH` (exact)
2. deploys the ascend token with the engine as the sole minter
3. mints `1 ascend` to the engine itself, permanently locked

the engine has no function that lets it transfer its own ERC-20 balance
or its own ETH balance, so the bootstrap ascend is unsellable and the
0.001 ETH is non-withdrawable. the initial floor is therefore exactly
`0.001 ETH / 1 ascend = 0.001 ETH per ascend`. once any user trades, the
floor moves up from there and never comes back.

## what the contract cannot do

- mint ascend outside `buy()`
- burn ascend outside `sell()`
- send ETH out except as the seller's `ethOut`
- be paused, upgraded, blacklisted, rescued, or refunded
- be reconfigured by anyone

if every wallet associated with the deploy disappears tonight, the
contract still trades tomorrow at exactly the same rules.

## why no Uniswap pool

a parallel Uniswap pool would arbitrage against the engine on every
block. the floor would still ascend, but the price observed by traders
would be the AMM mid-price, which depends on liquidity ratios, not on
`reserve / supply`. the simplicity of "the floor only goes up" only
holds if the engine is the only venue. so it is.

## what the floor does NOT promise

- the floor is the redemption price *minus 15%*. the seller receives 85%
  of `ascendIn · floor`. the floor itself is what the contract uses
  internally; what hits a seller's wallet is slightly less.
- the floor rising does not mean a buy will be profitable on resale
  immediately. with 5% in and 15% out, a round-trip costs ~20% even on a
  flat floor. you need the floor to lift by ~20% (compounded by trade
  volume) before a round-trip breaks even.
- the floor is denominated in ETH. it does not promise USD-denominated
  appreciation; ETH itself can move.
