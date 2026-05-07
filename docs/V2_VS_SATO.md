# ascend v2 vs. sato — key differences

This document captures the structural differences between ascend (v2) and
sato as a reference for design decisions, marketing language, and
audit/research conversations. Numbers from sato are taken from the
public DexScreener snapshot and from the simulator runs in
`scripts/v2sim.ts` and `scripts/sato.ts`.

## TL;DR

Sato is a fixed-cap fair-launch token traded on a vanilla Uniswap V4
pool. It looks normal because it *is* normal — its uniqueness is
distributional (no team alloc, fair launch), not mechanical.

Ascend v2 is also a fixed-cap fair-launch token traded on a Uniswap V4
pool, but the pool is owned by a hook that performs a **floor-ratcheting
rebalance after every trade**: 5% of every swap retains as additional
ETH depth (without minting more ascend), so the LP's lower tick — the
floor — is monotone non-decreasing. Sato has no such guarantee.

The retail experience (chart, liquidity, aggregator routing) is
identical. The mathematical guarantees and the long-run growth profile
are not.

## Side-by-side

| dimension                   | sato                         | ascend v2                                                |
|----------------------------|------------------------------|----------------------------------------------------------|
| supply model               | fixed 21M, fully circulating | fixed cap (e.g. 21M), fully LP'd at genesis              |
| LP owner                   | external LPs (third parties) | the hook only — `beforeAddLiquidity` rejects all others  |
| AMM curve                  | constant product (V4 LP)     | constant product (V4 LP, full range)                     |
| pricing                    | spot from LP                 | spot from LP                                             |
| chart shape                | single band                  | single band                                              |
| visible liquidity          | LP depth ($1.4M today)       | LP depth (== vault, grows from fees)                     |
| swap fee                   | 0% or LP-yield fee           | 5% **retained as ETH-side depth, not paid out**          |
| fee destination            | LPs                          | the LP itself (deepens floor)                            |
| floor / redemption guarantee | none                       | LP lower tick = monotone non-decreasing                  |
| floor enforceable on-chain | n/a                          | `floorTick` readable from the hook                       |
| aggregator routing         | yes                          | yes (standard V4)                                        |
| honeypot heuristic         | passes                       | passes                                                   |
| permission model           | normal Uniswap LP            | hook is the only LP; no admin, no upgrade, no withdraw   |
| MC growth at $15M volume   | ~$21M                        | ~$140M (sim, sato-style 50/50 churn)                     |
| FDV at sato's MC level     | $21.4M (current)             | reachable with $250k mining or $1.9M with 80% churn     |
| originality                | distributional               | mechanical — rising-floor LP that compounds itself       |

## What sato has that ascend doesn't

1. **Track record.** Sato has been live; ascend hasn't. That is the
   single biggest practical difference for a retail buyer scanning
   newly-listed tokens.
2. **Liquidity providers.** Anyone can LP into sato and earn the trading
   fee. Ascend rejects external LPs by design — the hook is the only
   counterparty. This is a feature for the redemption guarantee but
   removes a class of yield-seekers from the cap table.
3. **Simplicity to explain.** "21M cap, fair launch, V4 pool" is a
   one-line pitch. Ascend's pitch is "21M cap, fair launch, V4 pool,
   *and the floor only ever goes up because every swap pays the LP a
   compounding 5%*." Slightly harder to communicate.

## What ascend v2 has that sato doesn't

### 1. A monotone-rising floor (the engine)

Sato has no protocol-level redemption guarantee. If the price collapses,
holders depend on whoever remains willing to buy on the open market.

Ascend's hook keeps the LP's lower tick at `vault / circulating`, and
**only ever raises it**. Every trade — buy or sell — pays a 5% fee that
deepens the ETH side of the LP without minting more ascend. That's a
strict-monotone increase in `Y / X_circulating`, which is the floor.

A holder reading `floorTick` from the hook contract has a
mathematically-guaranteed minimum exit price. Sato holders have no
such number.

### 2. Sustained volume → permanent depth

In sato, fees flow to LPs. LPs can withdraw at any time, taking depth
with them. In ascend, fees stay in the LP forever. **Volume is depth, and
depth is permanent.**

A token with $50M of cumulative trading on sato might have $1M of LP
(LPs took profits and left). The same volume on ascend leaves the full
$2.5M (5% retention) embedded in the LP, raising the floor for everyone.

### 3. The hook is the only LP

External LPs can't add liquidity, withdraw it, or steer the curve. There
are no LP rugs to worry about. The "team" can't drain LP — there is no
team-controlled LP because there is no team.

This is the mechanical embodiment of "no admin, no pause, no upgrade":
the LP itself is owned and operated by the hook, which has no privileged
caller.

### 4. Bigger headline growth at matched volume

Same constant-product curve, same fees, same supply cap. Sato compounds
its fees back to LP holders (who often withdraw). Ascend compounds them
into the floor (which can't be withdrawn).

Numerically (`scripts/v2sim.ts` at 1 ETH bootstrap, 21M cap):

| volume profile           | sato MC (observed) | ascend v2 MC (sim) |
|--------------------------|--------------------|--------------------|
| $200k mined, no sells    | n/a                | $13.8M             |
| $1M / $800k churn        | n/a                | $6.2M              |
| sato 24h ($15M / $14M)   | **$21.4M**         | **$140M**          |
| $50M / $40M churn        | n/a                | $13B               |

The ~7× MC delta at sato-equivalent 24h volume comes from two effects:
(a) ascend's bootstrap is thinner so reflexive supply scarcity is
sharper, and (b) ascend's fees never leave the LP, so depth keeps
compounding instead of leaking to outside LPs.

### 5. No LP slippage from withdrawals

Sato's $1.4M LP could go to $0.5M in a day if external LPs decide to
exit. The chart would show a real price collapse from depth thinning.
Ascend can't have that — the LP can only grow.

This stability advantage compounds: depth-stability → predictable
slippage → bots and aggregators preferring the venue → more volume →
more depth.

## What's the same

- **Both look normal on DexScreener.** Single chart band, real visible
  liquidity, both buys and sells print as candles.
- **Both have a fixed supply cap and no team allocation.** Anti-rug at
  the supply level.
- **Both route through standard V4 swap.** Aggregators, the Uniswap UI,
  Coinbase Wallet's swap, 1inch — all work without custom integrations.
- **Both pass standard honeypot heuristics.** Sells route through the
  same swap path as buys.
- **Both have the same gas profile per swap** for end users (the v2
  rebalance happens in `afterSwap`, paid by whoever rebalances — can be
  threshold-gated to amortize).

## The pitch line

> Sato is a fair-launch token. Ascend is a fair-launch token whose
> floor compounds with every trade.

Same look, deeper foundation. The growth profile is structurally
stronger because volume permanently capitalizes the protocol instead of
leaking to LP rotators.

## Open questions vs. sato

1. **Cold-start liquidity.** Sato had third-party LPs willing to seed.
   Ascend's bootstrap is fixed at 1 ETH; depth grows organically from
   trade fees. The first hour after launch is thinner than sato's first
   hour. Mitigation: sub-cent initial price means small amounts of
   buying pressure produce dramatic price discovery, which is itself a
   draw.
2. **Aggregator depth detection.** Aggregators may temporarily prefer
   sato's deeper LP for large orders even if ascend's quote is better.
   Resolves itself once cumulative volume puts ascend's LP in a
   comparable depth range (~$1.4M takes about $30M of cumulative trading
   under 50/50 churn).
3. **Listing tier on DexScreener.** Some screeners filter by initial
   liquidity. Ascend's sub-$3k genesis liquidity may be flagged
   "low-cap" until depth catches up. Standard problem for genuine fair
   launches; resolves with volume.

## Summary

Ascend v2 is sato's mechanical sibling with a built-in floor ratchet.
Same retail surface area. Stronger long-run growth. Hard redemption
guarantee that sato structurally cannot offer. Tradeoff: thinner
cold-start depth and a slightly more involved pitch.
