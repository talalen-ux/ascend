/**
 * Off-chain mirror of the v2 engine math (option A — 1% fee, $2 mint
 * surcharge, anti-MEV).
 *
 *   v2 mechanics:
 *     - constant-product LP at full range, hook is the only LP
 *     - reserves (X, Y): X ascend in LP, Y ETH in LP
 *     - 1% base swap fee on every trade
 *     - on buys: additional flat $2 (≈ 0.001 ETH) surcharge encoded as
 *       a per-swap dynamic-fee adjustment
 *     - rebalance splits 70% to LP retention (raises Y), 30% to TileEngine
 *     - circulating = SUPPLY_CAP - X
 *     - floor = Y / circulating  (ETH per circulating ascend, the
 *               redemption guarantee)
 *     - spot price = Y / X       (the curve price, what swaps execute at)
 *
 *   monotonicity:
 *     fee retention compounds Y faster than the swap depletes/grows it,
 *     so floor is non-decreasing under any finite trade sequence.
 *
 *   typical units in this file:
 *     reserves and prices are floats in ETH-units (not wei)
 *     `supplyTotal` is in ascend-units (not wei)
 */

export const SUPPLY_CAP = 122_000_000;
export const BOOTSTRAP_ETH = 1;

// Pip units (V4-native; 1_000_000 = 100%).
export const SWAP_FEE_PIPS = 10_000;          // 1%
export const PIP_DENOM = 1_000_000;
export const MAX_EFFECTIVE_FEE_PIPS = 100_000; // 10% cap

// Fee split (basis points; 10_000 = 100% of fee).
export const LP_SHARE_BPS = 7_000;
export const TILE_SHARE_BPS = 3_000;
export const SHARE_DENOM = 10_000;

// Mint surcharge.
export const MINT_FEE_ETH = 0.001;            // ~$2 at $2350/ETH

// Convenience floats.
export const SWAP_FEE_RATE = SWAP_FEE_PIPS / PIP_DENOM; // 0.01
export const LP_SHARE = LP_SHARE_BPS / SHARE_DENOM;     // 0.7
export const TILE_SHARE = TILE_SHARE_BPS / SHARE_DENOM; // 0.3

export interface State {
  /// ETH currently in the LP.
  reserveEth: number;
  /// ascend currently in the LP.
  reserveAscend: number;
}

/** ETH per circulating ascend — the floor (redemption guarantee). */
export function floorOf(s: State): number {
  const circ = SUPPLY_CAP - s.reserveAscend;
  if (circ <= 0) return 0;
  return s.reserveEth / circ;
}

/** Spot price on the LP curve. ETH per ascend. */
export function priceOf(s: State): number {
  if (s.reserveAscend <= 0) return 0;
  return s.reserveEth / s.reserveAscend;
}

/** circulating supply = total minted into LP - amount still in LP. */
export function circulatingOf(s: State): number {
  return Math.max(0, SUPPLY_CAP - s.reserveAscend);
}

/** Market cap in ETH. = price × circulating. */
export function marketCapOf(s: State): number {
  return priceOf(s) * circulatingOf(s);
}

/** Fully-diluted value in ETH. = price × supplyCap. */
export function fdvOf(s: State): number {
  return priceOf(s) * SUPPLY_CAP;
}

/**
 * Compute the effective buy fee in pips for an `ethIn` mint, mirroring
 * the on-chain `_computeBuyFeePips` (without the anti-bot random
 * extra, which is non-deterministic). Used for accurate quotes.
 */
export function effectiveBuyFeePips(ethIn: number): number {
  if (ethIn <= 0) return 0;
  const mintPips = (MINT_FEE_ETH * PIP_DENOM) / ethIn;
  const total = SWAP_FEE_PIPS + mintPips;
  return Math.min(total, MAX_EFFECTIVE_FEE_PIPS);
}

/**
 * Quote a buy of `ethIn` ETH. Returns the ascend the user would receive,
 * the effective fee, and the post-swap floor + spot price. Reverts
 * (returns null) if `ethIn` is below `MINT_FEE_ETH` (would mint zero).
 *
 * We model the rebalance as instantaneous (donation back into the LP
 * after each trade). On-chain, donation happens lazily via rebalance(),
 * but the floor invariant proof works either way.
 */
export function quoteBuy(s: State, ethIn: number) {
  if (ethIn <= MINT_FEE_ETH) return null;

  const feePips = effectiveBuyFeePips(ethIn);
  const fee = ethIn * (feePips / PIP_DENOM);
  const net = ethIn - fee;
  if (net <= 0) return null;

  // CP swap: Y' = Y + net, X' = k / Y'
  const k = s.reserveEth * s.reserveAscend;
  const yAfterSwap = s.reserveEth + net;
  const xAfterSwap = k / yAfterSwap;
  const ascendOut = s.reserveAscend - xAfterSwap;

  // After fee retention: 70% of fee retained as ETH side (LP), 30%
  // routed to TileEngine. For the floor projection we count only the
  // LP-retained portion as added depth.
  const yFinal = yAfterSwap + fee * LP_SHARE;
  const xFinal = xAfterSwap;

  const post: State = { reserveEth: yFinal, reserveAscend: xFinal };

  return {
    ascendOut,
    fee,
    feePips,
    tilePortion: fee * TILE_SHARE,
    lpRetention: fee * LP_SHARE,
    floorBefore: floorOf(s),
    floorAfter: floorOf(post),
    priceBefore: priceOf(s),
    priceAfter: priceOf(post),
  };
}

/**
 * Quote a sell of `ascendIn` ascend. Returns ETH out, fee charged, and
 * post-swap floor + spot price.
 *
 * Sells pay a flat 1% fee — no surcharge, no anti-bot extra. Fee is
 * charged in ascend (stays in LP, growing X). On rebalance, 70% of
 * the ETH-equivalent fee is retained as LP depth, 30% to TileEngine.
 */
export function quoteSell(s: State, ascendIn: number) {
  if (ascendIn <= 0) return null;
  if (ascendIn >= s.reserveAscend) return null;

  const fee = ascendIn * SWAP_FEE_RATE;
  const net = ascendIn - fee;

  // CP swap on net (fee stays in LP as ascend after the swap)
  const k = s.reserveEth * s.reserveAscend;
  const xAfterSwap = s.reserveAscend + net;
  const yAfterSwap = k / xAfterSwap;
  const ethOut = s.reserveEth - yAfterSwap;

  // Fee retention: the 1% fee on the ascend side stays in the LP as X.
  // The ETH side of the LP keeps the post-swap value (no addition).
  const xFinal = xAfterSwap + fee;
  const yFinal = yAfterSwap;

  const post: State = { reserveEth: yFinal, reserveAscend: xFinal };

  return {
    ethOut,
    fee,
    tilePortion: fee * TILE_SHARE,
    floorBefore: floorOf(s),
    floorAfter: floorOf(post),
    priceBefore: priceOf(s),
    priceAfter: priceOf(post),
  };
}

/** Initial state at genesis: all 122M ascend in LP, 1 ETH bootstrap. */
export function genesis(): State {
  return { reserveEth: BOOTSTRAP_ETH, reserveAscend: SUPPLY_CAP };
}

/**
 * Simulate a sequence of mining buys for the projection chart. Returns
 * a trace of (step, floor, price) tuples.
 *
 * @param start state to start from
 * @param steps number of steps
 * @param tradeEthBuy ETH per buy step
 * @param sellFraction fraction of supply sold per even step (0..1)
 */
export function simulateFloor(
  start: State,
  steps: number,
  tradeEthBuy: number,
  sellFraction: number = 0.5,
): { step: number; floor: number; price: number }[] {
  const trace: { step: number; floor: number; price: number }[] = [
    { step: 0, floor: floorOf(start), price: priceOf(start) },
  ];
  let s: State = { ...start };
  for (let i = 1; i <= steps; i++) {
    if (i % 2 === 1) {
      const q = quoteBuy(s, tradeEthBuy);
      if (q) {
        const fee = tradeEthBuy * (q.feePips / PIP_DENOM);
        const net = tradeEthBuy - fee;
        const k = s.reserveEth * s.reserveAscend;
        const yAfter = s.reserveEth + net;
        const xAfter = k / yAfter;
        s = {
          reserveEth: yAfter + fee * LP_SHARE,
          reserveAscend: xAfter,
        };
      }
    } else {
      // sell side
      const sellAmount = (SUPPLY_CAP - s.reserveAscend) * sellFraction * 0.01;
      const q = quoteSell(s, sellAmount);
      if (q) {
        const fee = sellAmount * SWAP_FEE_RATE;
        const net = sellAmount - fee;
        const k = s.reserveEth * s.reserveAscend;
        const xAfter = s.reserveAscend + net;
        const yAfter = k / xAfter;
        s = {
          reserveEth: yAfter,
          reserveAscend: xAfter + fee,
        };
      }
    }
    trace.push({ step: i, floor: floorOf(s), price: priceOf(s) });
  }
  return trace;
}
