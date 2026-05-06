/**
 * Off-chain mirror of the engine math.
 *
 *   floor   = vault / supply                         (redemption price)
 *   price   = floor · (1 + MINING_PREMIUM_BPS/BPS)   (trading price)
 *   MC      = price · supply  =  (1 + premium) · vault
 *
 *   mining fee     5%   retained in vault
 *   redemption fee 15%  retained in vault
 *   mining premium 100% trading_price = 2 · floor (the spread also lands in vault)
 */

export const BUY_FEE_BPS = 500;
export const SELL_FEE_BPS = 1500;
export const MINING_PREMIUM_BPS = 10_000; // 100% — price = 2 · floor
export const BPS_DENOM = 10_000;
export const BOOTSTRAP_ETH = 0.001;
export const BOOTSTRAP_ASCEND = 1;

export interface State {
  reserveEth: number;
  supply: number;
}

export function floorOf({ reserveEth, supply }: State): number {
  if (supply === 0) return BOOTSTRAP_ETH / BOOTSTRAP_ASCEND;
  return reserveEth / supply;
}

/** Trading price, the cost to mine one ascend. */
export function priceOf(state: State): number {
  return floorOf(state) * (1 + MINING_PREMIUM_BPS / BPS_DENOM);
}

/** Market cap in ETH. = price × supply = (1 + premium) × vault. */
export function marketCapOf(state: State): number {
  return priceOf(state) * state.supply;
}

export function quoteBuy(state: State, ethIn: number) {
  if (ethIn <= 0) return null;
  const f = floorOf(state);
  const tradingPrice = f * (1 + MINING_PREMIUM_BPS / BPS_DENOM);
  const fee = (ethIn * BUY_FEE_BPS) / BPS_DENOM;
  const net = ethIn - fee;
  const ascendOut = net / tradingPrice;
  const post: State = {
    reserveEth: state.reserveEth + ethIn,
    supply: state.supply + ascendOut,
  };
  return {
    ascendOut,
    fee,
    floorBefore: f,
    floorAfter: floorOf(post),
    tradingPrice,
    priceAfter: priceOf(post),
  };
}

export function quoteSell(state: State, ascendIn: number) {
  if (ascendIn <= 0) return null;
  if (ascendIn >= state.supply) return null;
  const f = floorOf(state);
  // Redemption ignores the premium — sellers exit at the floor minus fee.
  const gross = ascendIn * f;
  const fee = (gross * SELL_FEE_BPS) / BPS_DENOM;
  const ethOut = gross - fee;
  const post: State = {
    reserveEth: state.reserveEth - ethOut,
    supply: state.supply - ascendIn,
  };
  return {
    ethOut,
    fee,
    floorBefore: f,
    floorAfter: floorOf(post),
    priceAfter: priceOf(post),
  };
}

/**
 * Simulate `n` alternating trades for the projection chart in the dapp.
 */
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
      if (q) s = { reserveEth: s.reserveEth + tradeEthBuy, supply: s.supply + q.ascendOut };
    } else {
      const sellAscend = s.supply * sellFraction * 0.01;
      const q = quoteSell(s, sellAscend);
      if (q) s = { reserveEth: s.reserveEth - q.ethOut, supply: s.supply - sellAscend };
    }
    trace.push({ step: i, floor: floorOf(s) });
  }
  return trace;
}
