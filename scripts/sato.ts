/**
 * Compare ascend against sato's on-chain profile (24h DexScreener snapshot).
 *
 *   sato:
 *     supply              21M (hard cap, fully circulating)
 *     price               $1.10
 *     FDV / MC            $21.4M  (FDV/MC = 1.0 — no premium structure)
 *     pool liquidity      $1.4M  (real LP)
 *     24h volume          $15.1M  (buys $7.6M, sells $7.4M, net +$200k)
 *     liquidity / MC      ~6.5%
 *     chart shape         single band, green/red candles, normal AMM
 *
 *   ascend at equivalent volume profiles:
 *     run gross mining + scaled redemption, report MC, vault, spread.
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
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
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
  const ratio = mineUsd > 0 ? redeemUsd / mineUsd : 0;
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
  const spread = miningPrice / redemptionPrice;
  const fdvMc = mc / vault;
  const liqMc = vault / mc;

  console.log(`--- ${label} ---`);
  console.log(`  gross mining = ${fmtUsd(mineUsd)}, gross sells = ${fmtUsd(redeemUsd)} (net ${fmtUsd(mineUsd - redeemUsd)})`);
  console.log(`  vault            = ${fmtUsd(vault)}     ← what dexscreener will report as 'liquidity'`);
  console.log(`  market cap       = ${fmtUsd(mc)}     ← (1+premium) · vault`);
  console.log(`  fdv / liquidity  = ${fdvMc.toFixed(1)}× (vs sato 15.3×)`);
  console.log(`  liquidity / mc   = ${(liqMc * 100).toFixed(1)}% (vs sato 6.5%)`);
  console.log(`  premium          = +${prem.toFixed(0)}%`);
  console.log(`  mining price     = ${fmtUsd(miningPrice).padStart(10)} ← buy candles print here`);
  console.log(`  redemption price = ${fmtUsd(redemptionPrice).padStart(10)} ← sell candles print here`);
  console.log(`  buy/sell spread  = ${spread.toFixed(1)}× (sato: 1.00× — single band)`);
  console.log();
}

console.log(`SATO (observed on dexscreener):`);
console.log(`  price       $1.10`);
console.log(`  FDV / MC    $21.4M (1.0× — fixed cap, no premium structure)`);
console.log(`  liquidity   $1.40M`);
console.log(`  24h volume  $15.1M (buys $7.6M, sells $7.4M, net +$200k)`);
console.log(`  liq / mc    6.5%`);
console.log(`  chart       single band, normal AMM look\n`);

console.log(`ASCEND simulated under matching volume profiles\n`);

report("(1) day-one sato profile: gross $15M mined, $14M sold (net +$200k → near sato 24h)",
       15_000_000, 14_000_000);

report("(2) just to ascend $21M MC, no churn",
       2_500_000, 0);

report("(3) just to ascend $21M MC, sato-style 50/50 churn",
       8_000_000, 7_900_000);

report("(4) launch day, $200k organic net buys, no churn (case A from prior sim)",
       200_000, 0);

report("(5) gentler comparable: $1M mined, $0.8M sold (net +$200k)",
       1_000_000, 800_000);
