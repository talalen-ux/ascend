/**
 * Estimate ascend's state after a fixed dollar-volume scenario.
 *
 *   initial reserve  : 1 ETH   (assumes a 1 ETH bootstrap, larger than the
 *                                contract's default 0.001 ETH; numbers scale
 *                                linearly with the bootstrap)
 *   initial supply   : 1 ascend
 *   initial floor    : 1 ETH per ascend
 *
 *   total buys       : $500,000      (= 125 ETH at $4,000/ETH)
 *   total sells      : $400,000      (= 100 ETH equivalent, sized at the
 *                                       prevailing floor when each sell hits)
 *
 * Two scenarios:
 *   (A) sequential   : all buys land first, then all sells
 *   (B) interleaved  : buy/sell pairs in 5:4 USD ratio across the run
 *
 * Off-chain mirror of the on-chain math (same as lib/floor.ts).
 */

import { quoteBuy, quoteSell, type State } from "../lib/floor";

const ETH_PRICE_USD = 4_000;
const N_BUYS = 200;
const N_SELLS = 200;

const initial: State = { reserveEth: 1, supply: 1 };

function snap(label: string, s: State) {
  const floor = s.reserveEth / s.supply;
  const fdvUsd = floor * s.supply * ETH_PRICE_USD;
  const reserveUsd = s.reserveEth * ETH_PRICE_USD;
  return {
    label,
    floorEth: floor,
    floorUsd: floor * ETH_PRICE_USD,
    supply: s.supply,
    reserveEth: s.reserveEth,
    reserveUsd,
    fdvUsd,
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
      `floor=${fmt(s.floorEth, 8)} Ξ (${fmtUsd(s.floorUsd)})  ` +
      `supply=${fmt(s.supply, 4)}  ` +
      `reserve=${fmt(s.reserveEth, 4)} Ξ (${fmtUsd(s.reserveUsd)})  ` +
      `FDV=${fmtUsd(s.fdvUsd)}`,
  );
}

// ---------- (A) sequential ---------------------------------------------------

function sequential(buyUsd: number, sellUsd: number) {
  const buyEthTotal = buyUsd / ETH_PRICE_USD;
  const ethPerBuy = buyEthTotal / N_BUYS;

  let s = { ...initial };
  console.log("\n=== A) sequential — all buys, then all sells ===");
  printSnap(snap("t0 (genesis)", s));

  for (let i = 0; i < N_BUYS; i++) {
    const q = quoteBuy(s, ethPerBuy);
    if (!q) break;
    s = { reserveEth: s.reserveEth + ethPerBuy, supply: s.supply + q.ascendOut };
  }
  printSnap(snap(`after $${buyUsd / 1000}k buys`, s));

  // sell phase: target a fixed USD volume out, sized at the prevailing floor
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
    s = { reserveEth: s.reserveEth - q.ethOut, supply: s.supply - ascendIn };
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

  let s = { ...initial };
  console.log("\n=== B) interleaved — alternating buy/sell at 5:4 USD ratio ===");
  printSnap(snap("t0 (genesis)", s));

  for (let i = 0; i < N_BUYS; i++) {
    // buy
    const qb = quoteBuy(s, ethPerBuy);
    if (!qb) break;
    s = { reserveEth: s.reserveEth + ethPerBuy, supply: s.supply + qb.ascendOut };

    // matching sell sized at current floor
    const sellUsdNow = ethPerBuy * ETH_PRICE_USD * sellRatio;
    const sellEthNow = sellUsdNow / ETH_PRICE_USD;
    const floorNow = s.reserveEth / s.supply;
    const ascendIn = sellEthNow / floorNow;
    if (ascendIn <= 0 || ascendIn >= s.supply) continue;
    const qs = quoteSell(s, ascendIn);
    if (!qs) continue;
    s = { reserveEth: s.reserveEth - qs.ethOut, supply: s.supply - ascendIn };
  }
  printSnap(snap("after interleaved volume", s));
}

// ---------- run --------------------------------------------------------------

console.log(`Assumptions:`);
console.log(`  ETH price          : $${ETH_PRICE_USD.toLocaleString()}`);
console.log(`  initial reserve    : ${initial.reserveEth} ETH`);
console.log(`  initial supply     : ${initial.supply} ascend`);
console.log(`  initial floor      : ${initial.reserveEth / initial.supply} ETH/ascend`);
console.log(
  `  fee rates          : 1% buy / 3% sell (retained as backing)`,
);
console.log(`  trade granularity  : 200 buys + up to 200 sells\n`);

sequential(500_000, 400_000);
interleaved(500_000, 400_000);

// floor-lift summary at $1M / $5M / $10M cumulative volume (interleaved)
console.log(`\n=== floor-lift sensitivity (interleaved, 5:4 buy/sell ratio) ===`);
for (const buyUsd of [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000]) {
  const sellUsd = (buyUsd * 4) / 5;
  let s = { ...initial };
  const ethPerBuy = buyUsd / ETH_PRICE_USD / N_BUYS;
  const sellRatio = sellUsd / buyUsd;
  for (let i = 0; i < N_BUYS; i++) {
    const qb = quoteBuy(s, ethPerBuy);
    if (qb) s = { reserveEth: s.reserveEth + ethPerBuy, supply: s.supply + qb.ascendOut };
    const sellEthNow = ethPerBuy * sellRatio;
    const floorNow = s.reserveEth / s.supply;
    const ascendIn = sellEthNow / floorNow;
    if (ascendIn > 0 && ascendIn < s.supply) {
      const qs = quoteSell(s, ascendIn);
      if (qs) s = { reserveEth: s.reserveEth - qs.ethOut, supply: s.supply - ascendIn };
    }
  }
  const floor = s.reserveEth / s.supply;
  const fdv = floor * s.supply * ETH_PRICE_USD;
  console.log(
    `  buys=${fmtUsd(buyUsd).padEnd(8)} sells=${fmtUsd(sellUsd).padEnd(8)} ` +
      `→ floor=${fmt(floor, 6)} Ξ (${fmtUsd(floor * ETH_PRICE_USD)})  ` +
      `FDV=${fmtUsd(fdv)}  reserve=${fmt(s.reserveEth, 2)} Ξ`,
  );
}
