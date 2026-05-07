/**
 * What does the chart look like at $200k net buys?
 *
 *   "net buys" can mean two very different runs:
 *
 *   case A — pure $200k cumulative mining, no redemptions
 *   case B — $1M mining and $800k redemptions (net $200k)
 *   case C — $5M mining and $4.8M redemptions (net $200k)
 *   case D — $10M mining and $9.8M redemptions (net $200k)
 *
 *   For each, report the resulting state and the mining/redemption
 *   execution prices that DexScreener would actually plot.
 */

import {
  quoteBuy,
  quoteSell,
  priceOf,
  marketCapOf,
  premiumFractionOf,
  floorOf,
  type State,
} from "../lib/floor";

const ETH_PRICE_USD = 2_350;
const STEPS = 800;

const initial = (): State => ({ reserveEth: 0.001, supply: 1, cumulativeEthIn: 0 });

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function applyBuy(s: State, ethIn: number): State {
  const q = quoteBuy(s, ethIn);
  if (!q) return s;
  return {
    reserveEth: s.reserveEth + ethIn,
    supply: s.supply + q.ascendOut,
    cumulativeEthIn: s.cumulativeEthIn + ethIn,
  };
}

function applySell(s: State, ascendIn: number): State {
  if (ascendIn >= s.supply) ascendIn = s.supply * 0.999;
  const q = quoteSell(s, ascendIn);
  if (!q) return s;
  return {
    reserveEth: s.reserveEth - q.ethOut,
    supply: s.supply - ascendIn,
    cumulativeEthIn: s.cumulativeEthIn,
  };
}

function run(mineUsd: number, redeemUsd: number): State {
  let s = initial();
  const ethPerBuy = mineUsd / ETH_PRICE_USD / STEPS;
  const ratio = redeemUsd / mineUsd;
  for (let i = 0; i < STEPS; i++) {
    s = applyBuy(s, ethPerBuy);
    if (ratio > 0) {
      const sellEth = ethPerBuy * ratio;
      const ascendIn = sellEth / floorOf(s);
      if (ascendIn > 0 && ascendIn < s.supply) s = applySell(s, ascendIn);
    }
  }
  return s;
}

function report(label: string, mineUsd: number, redeemUsd: number) {
  const s = run(mineUsd, redeemUsd);
  const mc = marketCapOf(s) * ETH_PRICE_USD;
  const vault = s.reserveEth * ETH_PRICE_USD;
  const prem = premiumFractionOf(s) * 100;
  const floor = floorOf(s) * ETH_PRICE_USD;
  const miningPrice = priceOf(s) * ETH_PRICE_USD;
  const redemptionPrice = floor * 0.95;
  const spreadX = miningPrice / redemptionPrice;

  console.log(`--- ${label} ---`);
  console.log(`  gross mining     = ${fmtUsd(mineUsd)}`);
  console.log(`  gross redemption = ${fmtUsd(redeemUsd)}`);
  console.log(`  net buys         = ${fmtUsd(mineUsd - redeemUsd)}`);
  console.log(`  ----`);
  console.log(`  vault (ETH)      = ${fmtUsd(vault)}   ← actual ETH in the hook`);
  console.log(`  supply           = ${s.supply.toFixed(4)} ascend`);
  console.log(`  premium          = +${prem.toFixed(0)}%`);
  console.log(`  market cap       = ${fmtUsd(mc)}`);
  console.log(`  ----`);
  console.log(`  mining price     = ${fmtUsd(miningPrice)}    ← what every BUY candle prints`);
  console.log(`  floor            = ${fmtUsd(floor)}    ← redemption value before fee`);
  console.log(`  redemption price = ${fmtUsd(redemptionPrice)}    ← what every SELL candle prints`);
  console.log(`  buy/sell spread  = ${spreadX.toFixed(2)}× (mining is this many × redemption)`);
  console.log();
}

console.log(`assumptions: ETH=$${ETH_PRICE_USD}, fees 5%/5%, base premium 100%, scale 250 ETH\n`);

report("A) pure $200k mining, no sells",     200_000,        0);
report("B) $1M mining, $800k sells (net $200k)",   1_000_000,    800_000);
report("C) $5M mining, $4.8M sells (net $200k)",   5_000_000,  4_800_000);
report("D) $10M mining, $9.8M sells (net $200k)", 10_000_000,  9_800_000);
