/**
 * Off-chain mirror of the engine math, dynamic-premium edition.
 *
 *   floor(t)        = vault(t) / supply(t)
 *   premium_bps(t)  = BASE + cumulativeEthIn(t) · BPS / S
 *   price(t)        = floor(t) · (1 + premium_bps(t)/BPS)
 *   marketCap(t)    = price(t) · supply(t)  =  (1 + premium) · vault
 *
 *   mining fee     5%   retained in vault
 *   redemption fee 15%  retained in vault
 *   base premium   100% — at genesis, price = 2 · floor
 *   premium scale  250 ETH — premium gains BASE per S of cumulative mining
 *
 * cumulativeEthIn is a monotone-non-decreasing counter: every mine
 * permanently raises the premium for every subsequent miner. Sells do not
 * reduce it.
 */

export const BUY_FEE_BPS = 500;
export const SELL_FEE_BPS = 500;
export const BASE_PREMIUM_BPS = 10_000; // 100% base — price = 2 · floor at genesis
export const PREMIUM_SCALE_ETH = 250; // premium gains BASE per 250 ETH of cumulative mining
export const BPS_DENOM = 10_000;
export const BOOTSTRAP_ETH = 0.001;
export const BOOTSTRAP_ASCEND = 1;

export interface State {
  reserveEth: number;
  supply: number;
  cumulativeEthIn: number;
}

export function floorOf({ reserveEth, supply }: State): number {
  if (supply === 0) return BOOTSTRAP_ETH / BOOTSTRAP_ASCEND;
  return reserveEth / supply;
}

/** Premium fraction (e.g. 1.0 = 100%) at the current cumulativeEthIn. */
export function premiumFractionOf(state: State): number {
  return BASE_PREMIUM_BPS / BPS_DENOM + state.cumulativeEthIn / PREMIUM_SCALE_ETH;
}

/** Trading price (cost to mine one ascend), ETH per ascend. */
export function priceOf(state: State): number {
  return floorOf(state) * (1 + premiumFractionOf(state));
}

/** Market cap in ETH. = price × supply = (1 + premium) × vault. */
export function marketCapOf(state: State): number {
  return priceOf(state) * state.supply;
}

export function quoteBuy(state: State, ethIn: number) {
  if (ethIn <= 0) return null;
  const f = floorOf(state);
  const tradingPrice = priceOf(state);
  const fee = (ethIn * BUY_FEE_BPS) / BPS_DENOM;
  const net = ethIn - fee;
  const ascendOut = net / tradingPrice;
  const post: State = {
    reserveEth: state.reserveEth + ethIn,
    supply: state.supply + ascendOut,
    cumulativeEthIn: state.cumulativeEthIn + ethIn, // ratchets up
  };
  return {
    ascendOut,
    fee,
    floorBefore: f,
    floorAfter: floorOf(post),
    tradingPrice,
    priceAfter: priceOf(post),
    premiumPctAfter: premiumFractionOf(post) * 100,
  };
}

export function quoteSell(state: State, ascendIn: number) {
  if (ascendIn <= 0) return null;
  if (ascendIn >= state.supply) return null;
  const f = floorOf(state);
  const gross = ascendIn * f;
  const fee = (gross * SELL_FEE_BPS) / BPS_DENOM;
  const ethOut = gross - fee;
  const post: State = {
    reserveEth: state.reserveEth - ethOut,
    supply: state.supply - ascendIn,
    cumulativeEthIn: state.cumulativeEthIn, // unchanged on sells
  };
  return {
    ethOut,
    fee,
    floorBefore: f,
    floorAfter: floorOf(post),
    priceAfter: priceOf(post),
  };
}

/** Simulate alternating mine/redeem activity for the projection chart. */
export function simulateFloor(
  start: State,
  steps: number,
  tradeEthBuy: number,
  sellFraction: number = 0.5,
): { step: number; floor: number }[] {
  const trace: { step: number; floor: number }[] = [
    { step: 0, floor: floorOf(start) },
  ];
  let s: State = { ...start };
  for (let i = 1; i <= steps; i++) {
    if (i % 2 === 1) {
      const q = quoteBuy(s, tradeEthBuy);
      if (q) {
        s = {
          reserveEth: s.reserveEth + tradeEthBuy,
          supply: s.supply + q.ascendOut,
          cumulativeEthIn: s.cumulativeEthIn + tradeEthBuy,
        };
      }
    } else {
      const sellAscend = s.supply * sellFraction * 0.01;
      const q = quoteSell(s, sellAscend);
      if (q) {
        s = {
          reserveEth: s.reserveEth - q.ethOut,
          supply: s.supply - sellAscend,
          cumulativeEthIn: s.cumulativeEthIn,
        };
      }
    }
    trace.push({ step: i, floor: floorOf(s) });
  }
  return trace;
}
