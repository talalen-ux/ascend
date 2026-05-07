/**
 * Estimate ascend's state under the dynamic-premium model.
 *
 *   floor(t)        = vault(t) / supply(t)
 *   premium_bps(t)  = BASE + cumulativeEthIn(t) · BPS / S
 *   price(t)        = floor(t) · (1 + premium_bps/BPS)
 *   marketCap(t)    = price(t) · supply(t)
 *
 *   initial vault   : 1 ETH (assumed bootstrap; numbers scale linearly)
 *   initial supply  : 1 ascend
 *   initial floor   : 1 ETH / ascend
 *   base premium    : 100%
 *   premium scale   : 250 ETH
 *   mining fee      : 5%   redemption fee : 5%   (retained in vault)
 *
 * Two scenarios:
 *   (A) sequential   : all buys land first, then all sells
 *   (B) interleaved  : buy/sell pairs in 5:4 USD ratio across the run
 */

import {
  quoteBuy,
  quoteSell,
  priceOf,
  marketCapOf,
  premiumFractionOf,
  type State,
} from "../lib/floor";

const ETH_PRICE_USD = 2_350;
const N_BUYS = 200;
const N_SELLS = 200;

const initial: State = { reserveEth: 1, supply: 1, cumulativeEthIn: 0 };

function snap(label: string, s: State) {
  const floor = s.reserveEth / s.supply;
  const price = priceOf(s);
  const mcEth = marketCapOf(s);
  const mcUsd = mcEth * ETH_PRICE_USD;
  const reserveUsd = s.reserveEth * ETH_PRICE_USD;
  return {
    label,
    floorEth: floor,
    floorUsd: floor * ETH_PRICE_USD,
    priceEth: price,
    priceUsd: price * ETH_PRICE_USD,
    supply: s.supply,
    reserveEth: s.reserveEth,
    reserveUsd,
    mcUsd,
    premiumPct: premiumFractionOf(s) * 100,
    cumulativeEth: s.cumulativeEthIn,
  };
}

function fmt(n: number, d = 4) {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: d })
    : "—";
}

function fmtUsd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function printSnap(s: ReturnType<typeof snap>) {
  console.log(
    `  ${s.label.padEnd(28)}  ` +
      `MC=${fmtUsd(s.mcUsd).padStart(8)}  ` +
      `vault=${fmtUsd(s.reserveUsd).padStart(8)}  ` +
      `prem=+${s.premiumPct.toFixed(0)}%  ` +
      `price=${fmtUsd(s.priceUsd)}  floor=${fmtUsd(s.floorUsd)}  ` +
      `supply=${fmt(s.supply, 2)}  ` +
      `cumE=${fmt(s.cumulativeEth, 1)} Ξ`,
  );
}

function applyBuy(s: State, ethIn: number, q: NonNullable<ReturnType<typeof quoteBuy>>): State {
  return {
    reserveEth: s.reserveEth + ethIn,
    supply: s.supply + q.ascendOut,
    cumulativeEthIn: s.cumulativeEthIn + ethIn,
  };
}

function applySell(s: State, ascendIn: number, q: NonNullable<ReturnType<typeof quoteSell>>): State {
  return {
    reserveEth: s.reserveEth - q.ethOut,
    supply: s.supply - ascendIn,
    cumulativeEthIn: s.cumulativeEthIn,
  };
}

// ---------- (A) sequential ---------------------------------------------------

function sequential(buyUsd: number, sellUsd: number) {
  const buyEthTotal = buyUsd / ETH_PRICE_USD;
  const ethPerBuy = buyEthTotal / N_BUYS;

  let s: State = { ...initial };
  console.log("\n=== A) sequential — all buys, then all sells ===");
  printSnap(snap("t0 (genesis)", s));

  for (let i = 0; i < N_BUYS; i++) {
    const q = quoteBuy(s, ethPerBuy);
    if (!q) break;
    s = applyBuy(s, ethPerBuy, q);
  }
  printSnap(snap(`after $${buyUsd / 1000}k buys`, s));

  let usdSold = 0;
  let trades = 0;
  while (usdSold < sellUsd && trades < N_SELLS) {
    const remaining = sellUsd - usdSold;
    const targetUsd = Math.min(remaining, sellUsd / N_SELLS);
    const targetEth = targetUsd / ETH_PRICE_USD;
    const floorNow = s.reserveEth / s.supply;
    let ascendIn = targetEth / floorNow;
    if (ascendIn >= s.supply) ascendIn = s.supply * 0.99;
    const q = quoteSell(s, ascendIn);
    if (!q) break;
    s = applySell(s, ascendIn, q);
    usdSold += q.ethOut * ETH_PRICE_USD;
    trades++;
  }
  printSnap(snap(`after $${sellUsd / 1000}k sells`, s));
  console.log(
    `  (${trades} sells executed; ${fmtUsd(usdSold)} actually extracted of ${fmtUsd(sellUsd)} target)`,
  );
}

// ---------- (B) interleaved --------------------------------------------------

function interleaved(buyUsd: number, sellUsd: number) {
  const buyEthTotal = buyUsd / ETH_PRICE_USD;
  const ethPerBuy = buyEthTotal / N_BUYS;
  const sellRatio = sellUsd / buyUsd;

  let s: State = { ...initial };
  console.log("\n=== B) interleaved — alternating buy/sell at 5:4 USD ratio ===");
  printSnap(snap("t0 (genesis)", s));

  for (let i = 0; i < N_BUYS; i++) {
    const qb = quoteBuy(s, ethPerBuy);
    if (!qb) break;
    s = applyBuy(s, ethPerBuy, qb);

    const sellUsdNow = ethPerBuy * ETH_PRICE_USD * sellRatio;
    const sellEthNow = sellUsdNow / ETH_PRICE_USD;
    const floorNow = s.reserveEth / s.supply;
    const ascendIn = sellEthNow / floorNow;
    if (ascendIn <= 0 || ascendIn >= s.supply) continue;
    const qs = quoteSell(s, ascendIn);
    if (!qs) continue;
    s = applySell(s, ascendIn, qs);
  }
  printSnap(snap("after interleaved volume", s));
}

// ---------- run --------------------------------------------------------------

console.log(`Assumptions:`);
console.log(`  ETH price          : $${ETH_PRICE_USD.toLocaleString()}`);
console.log(`  initial vault      : ${initial.reserveEth} ETH`);
console.log(`  initial supply     : ${initial.supply} ascend`);
console.log(`  initial floor      : ${initial.reserveEth / initial.supply} ETH/ascend`);
console.log(`  fee rates          : 5% mining / 5% redemption (retained in vault)`);
console.log(`  base premium       : 100% (price = 2 × floor at genesis)`);
console.log(`  premium scale      : +100% per 250 ETH of cumulative mining`);
console.log(`  trade granularity  : 200 buys + up to 200 sells\n`);

sequential(500_000, 400_000);
interleaved(500_000, 400_000);

console.log(`\n=== MC scaling vs cumulative mining (interleaved 5:4) ===`);
for (const buyUsd of [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000]) {
  const sellUsd = (buyUsd * 4) / 5;
  let s: State = { ...initial };
  const ethPerBuy = buyUsd / ETH_PRICE_USD / N_BUYS;
  const sellRatio = sellUsd / buyUsd;
  for (let i = 0; i < N_BUYS; i++) {
    const qb = quoteBuy(s, ethPerBuy);
    if (qb) s = applyBuy(s, ethPerBuy, qb);
    const sellEthNow = ethPerBuy * sellRatio;
    const floorNow = s.reserveEth / s.supply;
    const ascendIn = sellEthNow / floorNow;
    if (ascendIn > 0 && ascendIn < s.supply) {
      const qs = quoteSell(s, ascendIn);
      if (qs) s = applySell(s, ascendIn, qs);
    }
  }
  const mc = marketCapOf(s) * ETH_PRICE_USD;
  const vault = s.reserveEth * ETH_PRICE_USD;
  const prem = premiumFractionOf(s) * 100;
  console.log(
    `  mine=${fmtUsd(buyUsd).padEnd(8)} redeem=${fmtUsd(sellUsd).padEnd(8)} ` +
      `→ MC=${fmtUsd(mc).padStart(8)}  vault=${fmtUsd(vault).padStart(8)}  ` +
      `premium=+${prem.toFixed(0)}%  cumE=${fmt(s.cumulativeEthIn, 0)} Ξ`,
  );
}
