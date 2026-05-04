/**
 * Off-chain mirror of SatoMath. Used by the dapp for instant quotes and
 * for rendering the price/supply curves without an RPC roundtrip.
 *
 * All inputs are in wei (1e18-scaled). All outputs are in wei.
 */

export const S_WEI = 500n * 10n ** 18n; // 500 ETH
export const K = 21_000_000n; // raw count (sato has 18 decimals)
export const K_WEI = K * 10n ** 18n;
export const FEE_BPS = 30n;
export const FEE_DENOM = 10_000n;
export const MAX_BUY_WEI = 5n * 10n ** 18n;

const S = Number(S_WEI) / 1e18; // 500
const KN = Number(K); // 21_000_000

/** Marginal price (ETH per sato) at cumulative ETH `eEth`. */
export function priceAt(eEth: number): number {
  return (S / KN) * Math.exp(eEth / S);
}

/** Total supply (in sato units, not wei) at cumulative ETH `eEth`. */
export function supplyAt(eEth: number): number {
  return KN * (1 - Math.exp(-eEth / S));
}

/** Inverse: cumulative ETH that yields the given total supply. */
export function ethForSupply(supply: number): number {
  if (supply <= 0) return 0;
  if (supply >= KN) return Infinity;
  return -S * Math.log(1 - supply / KN);
}

/** Quote a buy: returns sato out + fee paid (both in their natural units). */
export function quoteBuy(
  cumulativeEth: number,
  ethIn: number,
): { satoOut: number; fee: number; newCumulativeEth: number; effectivePriceEth: number } {
  if (ethIn <= 0 || ethIn > 5) return { satoOut: 0, fee: 0, newCumulativeEth: cumulativeEth, effectivePriceEth: 0 };
  const fee = (ethIn * 30) / 10_000;
  const net = ethIn - fee;
  const newCum = cumulativeEth + net;
  const satoOut = supplyAt(newCum) - supplyAt(cumulativeEth);
  return {
    satoOut,
    fee,
    newCumulativeEth: newCum,
    effectivePriceEth: ethIn / satoOut,
  };
}

/** Quote a sell: returns ETH out + fee taken. */
export function quoteSell(
  cumulativeEth: number,
  satoIn: number,
): { ethOut: number; fee: number; newCumulativeEth: number; effectivePriceEth: number } {
  if (satoIn <= 0) return { ethOut: 0, fee: 0, newCumulativeEth: cumulativeEth, effectivePriceEth: 0 };
  const supply = supplyAt(cumulativeEth);
  if (satoIn > supply) return { ethOut: 0, fee: 0, newCumulativeEth: cumulativeEth, effectivePriceEth: 0 };
  const newCum = ethForSupply(supply - satoIn);
  const gross = cumulativeEth - newCum;
  const fee = (gross * 30) / 10_000;
  const ethOut = gross - fee;
  return {
    ethOut,
    fee,
    newCumulativeEth: newCum,
    effectivePriceEth: ethOut / satoIn,
  };
}

/** Sample the price curve over `n` points up to `maxEth` cumulative. */
export function priceCurve(maxEth: number, n: number): { e: number; price: number; supply: number }[] {
  const out: { e: number; price: number; supply: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const e = (maxEth * i) / n;
    out.push({ e, price: priceAt(e), supply: supplyAt(e) });
  }
  return out;
}
