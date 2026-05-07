/**
 * Off-chain mirror of the v2 engine math.
 *
 *   v2 mechanics:
 *     - constant-product LP at full range, hook is the only LP
 *     - reserves (X, Y): X ascend in LP, Y ETH in LP
 *     - 5% fee on every swap; on rebalance, 4% donates back to LP
 *       (raises Y without minting), 1% goes to TileEngine
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
export const FEE_BPS = 500;
export const LP_RETENTION_BPS = 400;
export const TILE_BPS = 100;
export const BPS_DENOM = 10_000;

// Convenience floats.
export const FEE_RATE = FEE_BPS / BPS_DENOM;       // 0.05
export const LP_RETENTION = LP_RETENTION_BPS / BPS_DENOM; // 0.04
export const TILE_RATE = TILE_BPS / BPS_DENOM;     // 0.01

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
 * Quote a buy of `ethIn` ETH. Returns the ascend the user would receive,
 * the fee charged, and the post-swap floor + spot price.
 *
 * We model the rebalance as instantaneous (donation back into the LP
 * after each trade). On-chain, donation happens lazily via rebalance(),
 * but the floor invariant proof works either way.
 */
export function quoteBuy(s: State, ethIn: number) {
  if (ethIn <= 0) return null;
  const fee = ethIn * FEE_RATE;
  const net = ethIn - fee;

  // CP swap: Y' = Y + net, X' = k / Y'
  const k = s.reserveEth * s.reserveAscend;
  const yAfterSwap = s.reserveEth + net;
  const xAfterSwap = k / yAfterSwap;
  const ascendOut = s.reserveAscend - xAfterSwap;

  // After fee retention: 4% of fee donates back to LP (raises Y); 1%
  // leaves the LP system entirely (goes to tile pool).
  const yFinal = yAfterSwap + fee * (LP_RETENTION_BPS / FEE_BPS);
  const xFinal = xAfterSwap;

  const post: State = { reserveEth: yFinal, reserveAscend: xFinal };

  return {
    ascendOut,
    fee,
    tilePortion: fee * (TILE_BPS / FEE_BPS),
    lpRetention: fee * (LP_RETENTION_BPS / FEE_BPS),
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
 * Sells deposit ascend into the LP and pull ETH out. The 5% fee is
 * charged in ascend (stays in LP, growing X). Of the ETH side, 4% of
 * the gross ETH-equivalent fee donates back, 1% to TileEngine.
 */
export function quoteSell(s: State, ascendIn: number) {
  if (ascendIn <= 0) return null;
  if (ascendIn >= s.reserveAscend) return null;

  const fee = ascendIn * FEE_RATE;
  const net = ascendIn - fee;

  // CP swap on net (fee stays in LP as ascend after the swap)
  const k = s.reserveEth * s.reserveAscend;
  const xAfterSwap = s.reserveAscend + net;
  const yAfterSwap = k / xAfterSwap;
  const ethOut = s.reserveEth - yAfterSwap;

  // Fee retention: the 5% fee on the ascend side. 4% effectively donates
  // back as additional X (already there, since fee stayed in pool); 1%
  // worth (in ETH terms) is sourced from the LP retention. For the
  // simple sim we treat the full fee as retained X.
  const xFinal = xAfterSwap + fee;
  const yFinal = yAfterSwap;

  const post: State = { reserveEth: yFinal, reserveAscend: xFinal };

  return {
    ethOut,
    fee,
    tilePortion: ethOut * (TILE_BPS / FEE_BPS),
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
        const fee = tradeEthBuy * FEE_RATE;
        const net = tradeEthBuy - fee;
        const k = s.reserveEth * s.reserveAscend;
        const yAfter = s.reserveEth + net;
        const xAfter = k / yAfter;
        s = {
          reserveEth: yAfter + fee * (LP_RETENTION_BPS / FEE_BPS),
          reserveAscend: xAfter,
        };
      }
    } else {
      // sell side
      const sellAmount = (SUPPLY_CAP - s.reserveAscend) * sellFraction * 0.01;
      const q = quoteSell(s, sellAmount);
      if (q) {
        const fee = sellAmount * FEE_RATE;
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
