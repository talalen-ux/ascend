# ASCENT — Architecture

## 1. The Multiplier

The hook maintains three state variables and derives a price multiplier from
them:

```
F  = net cumulative buy flow (currency0 in − currency0 out)         [decays]
D  = depth — slow integral of buy flow (1/4 of each buy adds to D)
C  = compression — accumulates with sells, dampens m              [decays]
```

```
m(E) = exp(clamp(F/S₁, −4, +4))            // bounded core
       · (1 + ln(1 + max(0, D/S₂)))         // depth bonus
       / (1 + C/S₃)                         // sell-side relief
```

Constants live in `AscentHook.sol`:

| name             | value     | meaning                          |
|------------------|-----------|----------------------------------|
| `S1`             | 300 ETH   | flow normalisation               |
| `S2`             | 500 ETH   | depth normalisation              |
| `S3`             | 200 ETH   | compression normalisation        |
| `DECAY_F`        | 0.01/blk  | flow decay per block             |
| `DECAY_C`        | 0.02/blk  | compression decay per block      |
| `MIN/MAX_EXP`    | ±4·1e18   | exp input clamp → m ∈ [.018, 55] |

Decay runs lazily on the first swap of any block (`_decay`).

## 2. Hook flow

```
beforeSwap:
  decay()
  if exactInput:
    if BUY:
      F += amountIn
      D += amountIn / 4
      C -= amountIn / 10           (clamped at 0)
      tax  = amountIn · (m−1)/m    (only if m > 1)
      take(tax)                    → BeforeSwapDelta(specified=+tax)
      treasury += tax
    else SELL:
      F -= amountIn
      C += amountIn
      bonus = min(treasury, amountIn · (m−1))  (only if m > 1)
      pay(bonus)                   → BeforeSwapDelta(unspecified=−bonus)
      treasury -= bonus
```

The hook only mutates state on **exact-input** swaps; exact-output flows
pass through neutrally. This avoids the round-trip quoting that would be
needed to convert an output-specified swap into an effective pressure
delta.

## 3. Why a treasury?

The spec calls for `eth_out = baseOut · m` on sells. With `m > 1` that
demands more output than the pool itself produces. Without a source of
funds, the hook would be insolvent on the first big sell.

The buy-side pressure tax `(m−1)/m · amountIn` is precisely the amount the
buyer would have received as extra tokens in a memoryless market — by
diverting it into the hook's own balance, we accumulate exactly the budget
needed to subsidise sellers symmetrically.

The bonus is capped at `treasury` so the hook is always solvent, at the
cost of the sell-side multiplier being asymmetric when the system is
imbalanced. This is the honest trade-off; documented loudly.

## 4. Permission flags

The hook needs:

- `BEFORE_SWAP_FLAG`
- `BEFORE_SWAP_RETURNS_DELTA_FLAG`

These are encoded in the lowest bits of the deployed address. The deploy
script uses `HookMiner` to find a CREATE2 salt that produces a compliant
address.

## 5. Frontend

- `lib/math.ts` mirrors `computeMultiplier` in floating point. The contract
  is the source of truth; the JS copy avoids an RPC roundtrip per
  keystroke in the trade panel.
- `useAscentState` polls `F/D/C/treasury/computeMultiplier` every 6s.
- `MomentumGraph` reads the indexer's `/history` endpoint (a flat list of
  `StateUpdated` events).

## 6. Indexer

A single Node process:

- polls the chain every `POLL_MS` ms via viem
- decodes `StateUpdated` logs into a SQLite table
- exposes `/history?limit=N` for the frontend

This is deliberately tiny — for production, switch to The Graph or
Ponder.

## 7. Known gaps

- No integration tests against a live `PoolManager`. The math tests in
  `test/AscentHook.t.sol` cover the multiplier function only.
- The trade panel preview uses `baseOut = amountIn` as a stand-in for the
  v4 quoter result. Wire `IQuoter` from `v4-periphery` once a pool is
  deployed.
- Flash-swap and reentrancy paths around `take`/`settle` need a dedicated
  audit pass — they're the primary risk surface.
- `D` never decays in this version; it is intended as a slow-moving
  reputation signal. If you want it to decay, add a third `DECAY_D`
  constant and mirror the F branch in `_decay`.
