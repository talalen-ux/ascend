/**
 * Off-chain mirror of the v3 bonding-curve math (exponential-curve).
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
export const SURPLUS_BPS = 300;     // 3% of post-fee mint to surplusReserve
export const BURN_TOKEN_FEE_BPS = 100; // 1% token-side burn fee
export const FEE_DENOM = 10_000;
export const MAX_MINT_PER_TX = 5;   // ETH

export const MINT_FEE_RATE = MINT_FEE_BPS / FEE_DENOM;   // 0.007
export const BURN_FEE_RATE = BURN_FEE_BPS / FEE_DENOM;   // 0.007
export const SURPLUS_RATE = SURPLUS_BPS / FEE_DENOM;     // 0.03
export const BURN_TOKEN_FEE_RATE = BURN_TOKEN_FEE_BPS / FEE_DENOM; // 0.01

/// Block-age burn penalty constants — must match AscendHookV3.sol.
/// Smooth exponential decay (no anchor points / no piecewise math):
///     payout(b) = FLOOR + (CEIL − FLOOR) · (1 − e^(−b/TAU))
export const PENALTY_FLOOR_BPS = 9000;     // 90% at block 0
export const PENALTY_CEIL_BPS = 10000;     // 100% asymptote
export const PENALTY_TAU_BLOCKS = 100;     // decay constant (blocks)
export const PENALTY_CAP_BLOCKS = 1000;    // hard cap past this for gas

/// Convenience: a few computed milestones for chart annotations.
/// Solve b = −TAU · ln(1 − (target − FLOOR) / (CEIL − FLOOR)).
function blocksAt(payoutBps: number): number {
  const span = PENALTY_CEIL_BPS - PENALTY_FLOOR_BPS;
  const t = (payoutBps - PENALTY_FLOOR_BPS) / span;
  if (t <= 0) return 0;
  if (t >= 1) return PENALTY_CAP_BLOCKS;
  return Math.round(-PENALTY_TAU_BLOCKS * Math.log(1 - t));
}
export const PENALTY_MILESTONES = [
  { payoutBps: 9500, blocks: blocksAt(9500) },  // 95% at ~69 blocks
  { payoutBps: 9900, blocks: blocksAt(9900) },  // 99% at ~461 blocks
  { payoutBps: 9990, blocks: blocksAt(9990) },  // 99.9% at ~691 blocks
] as const;

export interface StateV3 {
  /// Net cumulative ETH paid in over all mints (after fees+surplus). Monotone
  /// non-decreasing — frozen on burns (exponential-curve).
  ethCum: number;
  /// Actual ERC-20 supply (= mintedFair − sumOfBurns). Goes both ways.
  supply: number;
  /// ETH the protocol holds (claim balance with PoolManager).
  reserveEth: number;
  /// Fair supply position on the curve. = q(ethCum). Monotone non-decreasing.
  /// Differs from `supply` after any burns happen.
  mintedFair?: number;
  /// Active reserve-aware burn bonus, in basis points. 0 unless surplus
  /// crossed the 10% trigger.
  bonusBps?: number;
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

/** Floor (exponential-curve monotone). Per-token redemption price at the
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

/**
 * "Live" per-token burn payout — what your wallet actually receives per
 * ascend if you burn a small amount RIGHT NOW. Includes the 1% token fee,
 * 0.7% protocol fee, the block-age penalty (defaults to tier-1 / 90%
 * payout), and any active reserve bonus.
 *
 * Distinct from `floorOf()` (monotone aggregate). `floorOf` is the
 * per-token average if the entire supply were liquidated against the
 * frozen mintedFair — a conceptual long-term floor that only ever rises.
 * `livePerTokenBurnAt` is what a real burn pays at this instant.
 */
export function livePerTokenBurnAt(s: StateV3, holdAgeBlocks: number = 0): number {
  const mF = s.mintedFair ?? curveSupplyAt(s.ethCum);
  if (mF <= 0 || mF >= K || s.supply <= 0) return 0;
  // Marginal forward per ascend = S/(K−mF). 1% of input is destroyed
  // before reaching the curve, so only 99% earns deltaE.
  const grossPerToken = (S / (K - mF)) * (1 - BURN_TOKEN_FEE_RATE);
  const afterProtocolFee = grossPerToken * (1 - BURN_FEE_RATE);
  const multBps = penaltyMultBps(holdAgeBlocks);
  const afterPenalty = (afterProtocolFee * multBps) / FEE_DENOM;
  const bonusBps = s.bonusBps ?? 0;
  return afterPenalty * (1 + bonusBps / FEE_DENOM);
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
 * Quote a mint of `ethIn`. Mirrors AscendHookV3.quoteMint exactly:
 *   totalFee     = ethIn · MINT_FEE_BPS
 *   surplusTake  = (ethIn − totalFee) · SURPLUS_BPS
 *   ethToCurve   = ethIn − totalFee − surplusTake
 *   mintAmount   = q(cumulativeEthIn + ethToCurve) − q(cumulativeEthIn)
 *
 * Note: mintAmount is anchored at q(ethCum) — i.e. the curve position —
 * NOT at currentSupply. After any burns, currentSupply < q(ethCum), so
 * subtracting `s.supply` overstates mintAmount by the burn deficit.
 */
export function quoteMintV3(s: StateV3, ethIn: number) {
  if (ethIn <= 0 || ethIn > MAX_MINT_PER_TX) return null;

  const totalFee = ethIn * MINT_FEE_RATE;
  const tileShare = ethIn * (TILE_FEE_BPS / FEE_DENOM);
  const reserveShare = totalFee - tileShare;
  const postFee = ethIn - totalFee;
  const surplusTake = postFee * SURPLUS_RATE;
  const ethToCurve = postFee - surplusTake;
  if (ethToCurve <= 0) return null;

  const ethCumNew = s.ethCum + ethToCurve;
  const mFOld = s.mintedFair ?? curveSupplyAt(s.ethCum);
  const mFNew = curveSupplyAt(ethCumNew);
  const mintAmount = mFNew - mFOld;
  if (mintAmount <= 0) return null;

  const post: StateV3 = {
    ethCum: ethCumNew,
    supply: s.supply + mintAmount,
    reserveEth: s.reserveEth + ethIn - tileShare,
    mintedFair: mFNew,
    bonusBps: s.bonusBps,
  };

  return {
    ascendOut: mintAmount,
    fee: totalFee,
    tilePortion: tileShare,
    reservePortion: reserveShare,
    surplusTake,
    floorBefore: floorOf(s),
    floorAfter: floorOf(post),
    priceBefore: priceOf(s),
    priceAfter: priceOf(post),
  };
}

/// Penalty multiplier (in bps) for a given hold age. Mirrors the on-chain
/// `_penaltyMultBps` exactly — smooth exponential decay, no piecewise math.
export function penaltyMultBps(holdAgeBlocks: number): number {
  if (holdAgeBlocks >= PENALTY_CAP_BLOCKS) return PENALTY_CEIL_BPS;
  if (holdAgeBlocks <= 0) return PENALTY_FLOOR_BPS;
  const factor = 1 - Math.exp(-holdAgeBlocks / PENALTY_TAU_BLOCKS);
  const span = PENALTY_CEIL_BPS - PENALTY_FLOOR_BPS;
  return PENALTY_FLOOR_BPS + Math.floor(span * factor);
}

/**
 * Quote a burn of `ascendIn`. Mirrors AscendHookV3.quoteBurn exactly:
 *   ascendBurnFee = ascendIn · BURN_TOKEN_FEE_BPS         (1% destroyed)
 *   ascendToCurve = ascendIn − ascendBurnFee
 *   deltaE      = S · ln((K − mF + ascendToCurve) / (K − mF))   (V3 inverse)
 *   totalFee    = deltaE · BURN_FEE_BPS                       (0.7%)
 *   basePayout  = deltaE − totalFee
 *   grossPayout = basePayout · penaltyMultBps(holdAge)        (block-age)
 *   bonus       = grossPayout · bonusBps                      (reserve-aware)
 *   ethOut      = grossPayout + bonus
 *
 * `holdAgeBlocks` defaults to 0 (tier-1, 90% payout) — the conservative
 * fresh-mint case. Pass the user's actual age when known.
 */
export function quoteBurnV3(
  s: StateV3,
  ascendIn: number,
  holdAgeBlocks: number = 0,
) {
  if (ascendIn <= 0 || ascendIn >= s.supply) return null;
  const mF = s.mintedFair ?? curveSupplyAt(s.ethCum);
  if (mF === 0 || mF >= K) return null;

  const ascendBurnFee = ascendIn * BURN_TOKEN_FEE_RATE;
  const ascendToCurve = ascendIn - ascendBurnFee;
  if (ascendToCurve <= 0) return null;

  // V3 inverse curve, frozen mF.
  const deltaE = S * Math.log((K - mF + ascendToCurve) / (K - mF));
  const totalFee = deltaE * BURN_FEE_RATE;
  const tileShare = deltaE * (TILE_FEE_BPS / FEE_DENOM);
  const reserveShare = totalFee - tileShare;
  const basePayout = deltaE - totalFee;

  // Block-age penalty.
  const multBps = penaltyMultBps(holdAgeBlocks);
  const grossPayout = (basePayout * multBps) / FEE_DENOM;
  const penaltyTaken = basePayout - grossPayout;

  // Reserve-aware bonus.
  const bonusBps = s.bonusBps ?? 0;
  let bonusAmount = (grossPayout * bonusBps) / FEE_DENOM;
  if (bonusAmount < 0) bonusAmount = 0;

  const ethOut = grossPayout + bonusAmount;

  // Solvency: the on-chain hook reverts if ethOut > reserve.
  if (ethOut > s.reserveEth) return null;

  const post: StateV3 = {
    ethCum: s.ethCum,            // frozen on burn
    supply: s.supply - ascendIn,
    reserveEth: s.reserveEth - ethOut - tileShare,
    mintedFair: mF,              // frozen on burn
    bonusBps: s.bonusBps,
  };

  return {
    ethOut,
    fee: totalFee,
    tilePortion: tileShare,
    reservePortion: reserveShare,
    tokenBurnFee: ascendBurnFee,
    penalty: penaltyTaken,
    bonus: bonusAmount,
    payoutMultBps: multBps,
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
