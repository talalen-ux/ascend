/**
 * Off-chain mirror of the engine math. Floor only goes up.
 *
 * floor      = reserve / supply
 * buy fee    = 1% of ETH in
 * sell fee   = 3% of ETH out (gross)
 *
 * Both fees stay in the contract permanently as additional backing.
 */

export const BUY_FEE_BPS = 500;   // 5% — mining fee, retained in vault
export const SELL_FEE_BPS = 1500; // 15% — redemption fee, retained in vault
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

export function quoteBuy(state: State, ethIn: number) {
  if (ethIn <= 0) return null;
  const f = floorOf(state);
  const fee = (ethIn * BUY_FEE_BPS) / BPS_DENOM;
  const net = ethIn - fee;
  const ascendOut = net / f;
  // simulate post-state
  const post: State = {
    reserveEth: state.reserveEth + ethIn,
    supply: state.supply + ascendOut,
  };
  return { ascendOut, fee, floorBefore: f, floorAfter: floorOf(post) };
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
  };
  return { ethOut, fee, floorBefore: f, floorAfter: floorOf(post) };
}

/**
 * Simulate `n` alternating trades of size `tradeEth` to project a floor
 * trajectory. Used by the dapp to render "what happens if there's
 * volume?" as an illustrative chart, not a price prediction.
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
