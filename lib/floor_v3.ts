/**
 * Off-chain mirror of the v3 bonding-curve math (Sato-style).
 *
 *   v3 mechanics:
 *     - exponential bonding curve: q(e) = K · (1 − e^(−e/S))
 *     - K = 21M (asymptotic supply cap), S = 500 ETH (curve scale)
 *     - mint: ETH → ascend, advances ethCum by (ethIn − fee)
 *     - burn: ascend → ETH, decreases supply, ethOut = (Δe)·(1 − fee)
 *     - 0.7% fee on each side, split: 5/7 reserve, 2/7 TileEngine
 *     - max 5 ETH per mint tx (anti-vacuum)
 *     - same-block burn-after-mint reverts (anti-flash-loan)
 *
 *   typical units: floats in ETH-units / ascend-units (not wei).
 */

export const K = 21_000_000;        // supply cap (ascend, asymptotic)
export const S = 0.3;               // curve scale (ETH) — testnet-calibrated for $1 reachability

/// USD/ETH for display purposes only (chart labels, tooltips). Override
/// at deploy time via NEXT_PUBLIC_USD_PER_ETH; default to a recent
/// mid-cycle mainnet ETH rate so testnet numbers feel grounded.
export const USD_PER_ETH = Number(process.env.NEXT_PUBLIC_USD_PER_ETH ?? 3500);

export function ethToUsd(eth: number): number {
  return eth * USD_PER_ETH;
}
export const MINT_FEE_BPS = 70;     // 0.7%
export const BURN_FEE_BPS = 70;     // 0.7%
export const TILE_FEE_BPS = 20;     // 0.2%
export const FEE_DENOM = 10_000;
export const MAX_MINT_PER_TX = 5;   // ETH

export const MINT_FEE_RATE = MINT_FEE_BPS / FEE_DENOM; // 0.007
export const BURN_FEE_RATE = BURN_FEE_BPS / FEE_DENOM; // 0.007

export interface StateV3 {
  /// Net cumulative ETH paid in over all mints (after fees). Monotone
  /// non-decreasing — frozen on burns (Sato-style).
  ethCum: number;
  /// Actual ERC-20 supply (= mintedFair − sumOfBurns). Goes both ways.
  supply: number;
  /// ETH the protocol holds (claim balance with PoolManager).
  reserveEth: number;
  /// Fair supply position on the curve. = q(ethCum). Monotone non-decreasing.
  /// Differs from `supply` after any burns happen.
  mintedFair?: number;
}

/** q(e) = K · (1 − e^(−e/S)) — fair supply at curve position e. */
export function curveSupplyAt(e: number): number {
  return K * (1 - Math.exp(-e / S));
}

/** Marginal forward (mint) price at e: ETH per ascend. = (S/K) · e^(e/S) */
export function marginalMintPriceAt(e: number): number {
  return (S / K) * Math.exp(e / S);
}

/** Marginal burn price at supply q (after fee). Naive V3 formula
 *  used as a building block. = (S/(K−q)) · (1 − burnFee). */
export function marginalBurnPriceAt(q: number): number {
  if (q >= K) return 0;
  return (S / (K - q)) * (1 - BURN_FEE_RATE);
}

/** Floor (Sato-style monotone). Per-token redemption price at the
 *  current state. mintedFair is frozen across burns, so this only
 *  rises as either mintedFair grows (mints) or supply shrinks (burns).
 *      = (S / (K − mintedFair)) · (mintedFair / supply) · (1 − burnFee) */
export function floorOf(s: StateV3): number {
  const mF = s.mintedFair ?? curveSupplyAt(s.ethCum);
  if (mF === 0 || mF >= K || s.supply <= 0) return 0;
  return (S / (K - mF)) * (mF / s.supply) * (1 - BURN_FEE_RATE);
}

/** Spot price (mint side, before fee). ETH per ascend. */
export function priceOf(s: StateV3): number {
  return marginalMintPriceAt(s.ethCum);
}

/** Total minted so far. = supply (in v3, no pre-mint exists). */
export function circulatingOf(s: StateV3): number {
  return s.supply;
}

export function marketCapOf(s: StateV3): number {
  return priceOf(s) * circulatingOf(s);
}

export function fdvOf(s: StateV3): number {
  return priceOf(s) * K;
}

/**
 * Quote a mint of `ethIn`. Returns mintAmount, fee in ETH, post-state floor.
 * Returns null if ethIn is out of bounds.
 */
export function quoteMintV3(s: StateV3, ethIn: number) {
  if (ethIn <= 0 || ethIn > MAX_MINT_PER_TX) return null;

  const totalFee = ethIn * MINT_FEE_RATE;
  const tileShare = ethIn * (TILE_FEE_BPS / FEE_DENOM);
  const reserveShare = totalFee - tileShare;
  const ethToCurve = ethIn - totalFee;
  if (ethToCurve <= 0) return null;

  const ethCumNew = s.ethCum + ethToCurve;
  const supplyNew = curveSupplyAt(ethCumNew);
  const mintAmount = supplyNew - s.supply;
  if (mintAmount <= 0) return null;

  const post: StateV3 = {
    ethCum: ethCumNew,
    supply: supplyNew,
    reserveEth: s.reserveEth + ethIn - tileShare,
  };

  return {
    ascendOut: mintAmount,
    fee: totalFee,
    tilePortion: tileShare,
    reservePortion: reserveShare,
    floorBefore: floorOf(s),
    floorAfter: floorOf(post),
    priceBefore: priceOf(s),
    priceAfter: priceOf(post),
  };
}

/**
 * Quote a burn of `ascendIn` (Sato-style monotone-floor formula).
 * mintedFair is frozen — only `supply` shrinks. ethOut comes from the
 * marginal-integral:
 *     ethOut(beforeFee) = (S · mF / (K − mF)) · ln(supply / (supply − b))
 *     ethOut(afterFee)  = ethOut(beforeFee) · (1 − fee)
 * Returns null if ascendIn is out of bounds OR the implied payout
 * exceeds the current reserve (insolvent — on-chain would revert).
 */
export function quoteBurnV3(s: StateV3, ascendIn: number) {
  if (ascendIn <= 0 || ascendIn >= s.supply) return null;
  const mF = s.mintedFair ?? curveSupplyAt(s.ethCum);
  if (mF === 0 || mF >= K) return null;

  const grossEth = (S * mF) / (K - mF) * Math.log(s.supply / (s.supply - ascendIn));
  const totalFee = grossEth * BURN_FEE_RATE;
  const tileShare = grossEth * (TILE_FEE_BPS / FEE_DENOM);
  const reserveShare = totalFee - tileShare;
  const ethOut = grossEth - totalFee;

  // Solvency: the on-chain hook reverts if ethOut > reserve.
  if (ethOut > s.reserveEth) return null;

  const post: StateV3 = {
    ethCum: s.ethCum,            // frozen on burn
    supply: s.supply - ascendIn,
    reserveEth: s.reserveEth - ethOut - tileShare,
    mintedFair: mF,              // frozen on burn
  };

  return {
    ethOut,
    fee: totalFee,
    tilePortion: tileShare,
    reservePortion: reserveShare,
    floorBefore: floorOf(s),
    floorAfter: floorOf(post),
    priceBefore: priceOf(s),
    priceAfter: priceOf(post),
  };
}

/** Genesis state for v3: zero everything. */
export function genesisV3(): StateV3 {
  return { ethCum: 0, supply: 0, reserveEth: 0 };
}
