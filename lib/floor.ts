/**
 * Off-chain mirror of the v3 bonding-curve math (Sato-style).
 *
 * Re-exports lib/floor_v3.ts under the names the existing components
 * already consume (`quoteBuy`, `quoteSell`, `floorOf`, `priceOf`,
 * `simulateFloor`, `genesis`). Those wrappers translate the V2-shaped
 * `{reserveEth, reserveAscend}` state argument to V3-shaped state
 * `{ethCum, supply, reserveEth}` for the components that haven't been
 * updated yet.
 */

import {
  K,
  S,
  MAX_MINT_PER_TX,
  MINT_FEE_RATE,
  BURN_FEE_RATE,
  TILE_FEE_BPS,
  FEE_DENOM,
  curveSupplyAt,
  marginalMintPriceAt,
  marginalBurnPriceAt,
  quoteMintV3,
  quoteBurnV3,
  floorOf as floorOfV3,
  priceOf as priceOfV3,
  type StateV3,
} from "./floor_v3";

// Re-exports: components consuming these can switch to lib/floor_v3
// directly when convenient. Aliases below preserve old call sites.
export {
  K,
  S,
  MAX_MINT_PER_TX,
  MINT_FEE_RATE,
  BURN_FEE_RATE,
  curveSupplyAt,
  marginalMintPriceAt,
  marginalBurnPriceAt,
};

/// Old-name aliases. v3 has no fixed cap (curve is asymptotic at K), so
/// `SUPPLY_CAP` is just K. `BOOTSTRAP_ETH` is 0 (no bootstrap in v3).
export const SUPPLY_CAP = K;
export const BOOTSTRAP_ETH = 0;
export const SWAP_FEE_RATE = MINT_FEE_RATE;
export const TILE_SHARE = TILE_FEE_BPS / FEE_DENOM;

/// V3-shaped state object. Components are migrating to use this directly.
export type State = StateV3;

export const floorOf = floorOfV3;
export const priceOf = priceOfV3;

export function circulatingOf(s: State): number {
  return s.supply;
}

export function marketCapOf(s: State): number {
  return priceOf(s) * s.supply;
}

export function fdvOf(s: State): number {
  return priceOf(s) * K;
}

/** Genesis state for v3: zero everything. */
export function genesis(): State {
  return { ethCum: 0, supply: 0, reserveEth: 0 };
}

/**
 * Quote a mint (legacy `quoteBuy` name). Returns a result shaped so the
 * existing Trade.tsx can read `ascendOut`, `fee`, `floorAfter`, `priceAfter`.
 */
export function quoteBuy(s: State, ethIn: number) {
  const q = quoteMintV3(s, ethIn);
  if (!q) return null;
  return {
    ascendOut: q.ascendOut,
    fee: q.fee,
    feePips: MINT_FEE_RATE * 1_000_000, // legacy callers expected pips
    tilePortion: q.tilePortion,
    lpRetention: q.reservePortion, // legacy name; v3 calls it reserveShare
    floorBefore: q.floorBefore,
    floorAfter: q.floorAfter,
    priceBefore: q.priceBefore,
    priceAfter: q.priceAfter,
  };
}

/**
 * Quote a burn (legacy `quoteSell` name). Returns a result shaped so the
 * existing Trade.tsx can read `ethOut`, `fee`, `floorAfter`, `priceAfter`.
 */
export function quoteSell(s: State, ascendIn: number) {
  const q = quoteBurnV3(s, ascendIn);
  if (!q) return null;
  return {
    ethOut: q.ethOut,
    fee: q.fee,
    tilePortion: q.tilePortion,
    floorBefore: q.floorBefore,
    floorAfter: q.floorAfter,
    priceBefore: q.priceBefore,
    priceAfter: q.priceAfter,
  };
}

/**
 * Simulate a sequence of mints + burns for the Projection chart. Step i
 * mints `tradeEthBuy` ETH on odd steps and burns a fraction of supply
 * on even steps. Returns trace of (step, floor, price) tuples.
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
      // mint
      const q = quoteMintV3(s, Math.min(tradeEthBuy, MAX_MINT_PER_TX));
      if (q) {
        s = {
          ethCum: s.ethCum + (tradeEthBuy * (1 - MINT_FEE_RATE)),
          supply: s.supply + q.ascendOut,
          reserveEth: s.reserveEth + tradeEthBuy - q.tilePortion,
        };
      }
    } else if (s.supply > 0) {
      // burn a small fraction so the simulation can keep running
      const burnAmount = s.supply * sellFraction * 0.01;
      const q = quoteBurnV3(s, burnAmount);
      if (q) {
        s = {
          ethCum: Math.max(0, s.ethCum - q.ethOut / (1 - BURN_FEE_RATE)),
          supply: s.supply - burnAmount,
          reserveEth: s.reserveEth - q.ethOut - q.tilePortion,
        };
      }
    }
    trace.push({ step: i, floor: floorOf(s), price: priceOf(s) });
  }
  return trace;
}
