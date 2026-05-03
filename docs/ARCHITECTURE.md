# ASCENT — Architecture

## 1. The Multiplier — Symmetric Reflexive Tanh-Exponential Curve (SR-TEC)

```
m(F, V, D, C) = exp( α · tanh(z) )

z = (F + γ·V) / S_F
  + θ · ln(1 + max(0, D) / S_D)
  − φ · (max(0, C) / S_C)^p
```

| symbol | meaning                          | default       |
|--------|----------------------------------|---------------|
| F      | net buy flow (decay)             | int (1e18)    |
| V      | velocity — recent buy intensity  | int (1e18)    |
| D      | depth — slow integral            | int (1e18)    |
| C      | compression — sell-side memory   | int (1e18)    |
| α      | `ln(M_max)` — tanh amplitude     | 4 (m∈[.018,55])|
| γ      | velocity weight                  | 2             |
| θ      | depth weight                     | 1             |
| φ      | compression weight               | 1             |
| p      | super-linear damping exponent    | 1.2           |
| S_F    | flow normalisation               | 300 ETH       |
| S_V    | velocity normalisation           | 50 ETH        |
| S_D    | depth normalisation              | 500 ETH       |
| S_C    | compression normalisation        | 200 ETH       |

### Properties (proven by construction)

1. **Neutral identity** — `m(0,0,0,0) = exp(α · 0) = 1`.
2. **Naturally bounded** — `tanh ∈ [−1,1]`, so `m ∈ [e^−α, e^+α]` for *any*
   inputs. No clamping branch, no overflow risk on the math input itself.
3. **Multiplicative symmetry** — `m(z) · m(−z) = exp(α·tanh(z))·exp(−α·tanh(z)) = 1`.
   Buying X, then selling X (same block, no decay) returns the multiplier
   exactly to its starting value.
4. **Smoothness** — C^∞ in all components. No jumps, no kinks.
5. **Saturation** — derivative `dm/dF ∝ sech²(z)` vanishes for large `|z|`,
   so manipulative whales hit diminishing returns automatically.

### Why this beats `K · (1 − e^{−E/S})`

The reference equation is single-state: it knows only cumulative ETH spent.
SR-TEC has **four orthogonal channels**:

| dimension              | reference | SR-TEC |
|------------------------|-----------|--------|
| cumulative buy pressure| ✓         | ✓ (F)  |
| velocity / burst signal| —         | ✓ (V)  |
| reputational depth     | —         | ✓ (D)  |
| sell-side memory       | —         | ✓ (C)  |
| bidirectional response | —         | ✓      |
| natural symmetry       | —         | ✓      |
| saturating without clamp| —        | ✓      |

A 100 ETH burst in one block and a 100 ETH drift over 1000 blocks have the
same `F` but very different `V` — SR-TEC distinguishes them; the reference
cannot.

## 2. State decay

Multiplicative per-block decay (half-life behaviour, no negative-zero
artefact):

```
new = old · max(0, 1 − r · blocks)
```

| component | rate r/block | ~half-life |
|-----------|--------------|------------|
| F         | 0.5%         | ~138 blk   |
| V         | 5%           | ~14 blk    |
| D         | 0.05%        | ~1380 blk  |
| C         | 1%           | ~69 blk    |

Decay runs lazily on the first swap of a block. Pure variant
`AscentState.projected(...)` is used by `computeMultiplier` and the quoter
without writing storage.

## 3. Hook flow

```
beforeSwap(key, params):
  if amountSpecified > 0: revert ExactOutputNotSupported   // closes arbitrage
  enter()                                                  // transient reentrancy guard
  state.decay(block.number)
  if BUY:
    F += a; V += a; D += a/4; C −= a/10
    if m > 1:
      tax = a · (m−1)/m
      treasury += tax
      poolManager.take(currency0, this, tax)
      delta = (specified=+tax, unspecified=0)
  else SELL:
    F −= a; V −= a; C += a
    if m > 1 and treasury > 0:
      requested = a · (m−1)
      paid = min(requested, treasury)
      treasury −= paid
      poolManager.sync(currency0); transfer; settle()
      delta = (specified=0, unspecified=−paid)
  emit StateUpdated(poolId, F, V, D, C, m, treasury)
  exit()
```

Key invariants:

- **Solvency** — sell-side bonus is bounded by treasury; the hook can
  always settle.
- **CEI** — state is mutated before any external call; the transient
  reentrancy guard catches re-entry from token callbacks.
- **No admin** — there is no owner, no pause, no parameter setter. The
  constants are immutable.

## 4. Why exact-output reverts

Applying the multiplier on exact-output swaps requires either knowing the
pool's input amount before `beforeSwap` (impossible without a quoter
roundtrip from inside the hook) or skipping the tax (creates a free
arbitrage path for bots). Reverting is the honest middle path —
exact-output users route through the v4 quoter and submit exact-input
instead.

## 5. Quoter

`AscentQuoter.quoteExactInput(key, zeroForOne, amountIn, baseOut)` mirrors
the hook's branching logic on a memory copy of state, so the frontend's
preview is exact (modulo the underlying AMM's `baseOut`, which the caller
supplies from the v4 quoter).

## 6. Frontend

- `useAscentState` — polls per-pool state via `poolId`.
- `useQuoter` — debounced live quote against `AscentQuoter`.
- `useExecuteSwap` — submits exact-input swaps through `PoolSwapTest` (the
  v4 reference router for tests). Production deployments substitute the
  `UniversalRouter` once it supports v4 routes for the target chain.

## 7. Indexer

Single Node process polling `StateUpdated` logs into SQLite, indexed by
`poolId`. Exposes `/history?poolId=…&limit=N`. Switch to The Graph or
Ponder for production scale.

## 8. Risk surface

- **Treasury denial** — sell bonuses are capped, so the hook is solvent,
  but a sustained sell run will deplete the treasury and re-enter
  symmetric mode. This is the intended steady state.
- **MEV** — the velocity term V means sandwiching attempts that buy
  immediately before a victim's buy will increase the victim's tax. The
  attacker pays the same tax themselves, so this is self-cancelling for
  exact-input flows.
- **Reentrancy** — guarded via EIP-1153 transient storage.
- **PoolManager invariants** — `take`/`sync`/`settle` calls follow the v4
  pattern; the integration test `test_buyAccumulatesTreasuryAsMRises`
  exercises this end-to-end.
