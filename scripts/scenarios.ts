/**
 * Scenario simulations:
 *
 *   (1) initial-liquidity sweep
 *       what does MC look like immediately after the first miner deposits X?
 *
 *   (2) market-cap milestones
 *       what cumulative net mining (USD) is needed to reach each milestone?
 *
 *   (3) mine/redeem ratio sensitivity
 *       at fixed gross mining of $10M, vary redemption from 0% to 99%.
 *
 * All sims share lib/floor and the same parameters as scripts/simulate.ts.
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
const N_STEPS = 400;

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

/** Run cumulative mining of `mineUsd` and then redeem `redeemUsd` interleaved. */
function runInterleaved(mineUsd: number, redeemUsd: number, steps = N_STEPS): State {
  const ethPerBuy = mineUsd / ETH_PRICE_USD / steps;
  const ratio = redeemUsd / mineUsd;
  let s = initial();
  for (let i = 0; i < steps; i++) {
    s = applyBuy(s, ethPerBuy);
    const sellEth = ethPerBuy * ratio;
    if (sellEth > 0) {
      const ascendIn = sellEth / floorOf(s);
      if (ascendIn > 0 && ascendIn < s.supply) s = applySell(s, ascendIn);
    }
  }
  return s;
}

/** Run cumulative mining of `mineUsd` only — no redemptions. */
function runMineOnly(mineUsd: number, steps = N_STEPS): State {
  const ethPerBuy = mineUsd / ETH_PRICE_USD / steps;
  let s = initial();
  for (let i = 0; i < steps; i++) s = applyBuy(s, ethPerBuy);
  return s;
}

function row(label: string, s: State) {
  const mc = marketCapOf(s) * ETH_PRICE_USD;
  const vault = s.reserveEth * ETH_PRICE_USD;
  const prem = premiumFractionOf(s) * 100;
  const price = priceOf(s) * ETH_PRICE_USD;
  const floor = floorOf(s) * ETH_PRICE_USD;
  console.log(
    `  ${label.padEnd(28)}  MC=${fmtUsd(mc).padStart(9)}  ` +
      `vault=${fmtUsd(vault).padStart(9)}  ` +
      `price=${fmtUsd(price).padStart(9)}  floor=${fmtUsd(floor).padStart(9)}  ` +
      `prem=+${prem.toFixed(0).padStart(4)}%  cumE=${s.cumulativeEthIn.toFixed(1).padStart(7)}Ξ`,
  );
}

console.log(`assumptions: ETH=$${ETH_PRICE_USD}, fees 5%/5%, base premium 100%, scale 250 ETH`);
console.log(`bootstrap:   0.001 ETH / 1 ascend  (genesis MC ≈ $4.70)`);
console.log(`granularity: ${N_STEPS} steps per scenario\n`);

// =============================================================================
// (1) Initial-liquidity sweep
//     "you launch ascend; the first miners deposit $X total. what's MC?"
// =============================================================================

console.log("=== (1) initial liquidity → market cap (mine-only, no redemptions) ===");
console.log(`  the first wave of miners deposits X with no sells; this is`);
console.log(`  the launch-day ceiling for a given inflow size.\n`);

for (const usd of [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000]) {
  const s = runMineOnly(usd);
  row(`launch inflow ${fmtUsd(usd)}`, s);
}

// =============================================================================
// (2) MC milestones — what cumulative mining is needed to reach each?
//     Try two redemption regimes: 0% (mining-only) and 80% (heavy redemption).
// =============================================================================

console.log("\n=== (2) cumulative mining required to reach MC milestones ===");
console.log(`  inverse search: for each target MC, find the gross mining`);
console.log(`  volume that achieves it. shown for two redemption regimes.\n`);

function mineNeededForMc(targetMcUsd: number, redeemRatio: number): { mineUsd: number; s: State } {
  // logarithmic bisection
  let lo = 1_000;
  let hi = 1e15;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    const s =
      redeemRatio === 0 ? runMineOnly(mid, N_STEPS) : runInterleaved(mid, mid * redeemRatio, N_STEPS);
    const mcUsd = marketCapOf(s) * ETH_PRICE_USD;
    if (mcUsd > targetMcUsd) hi = mid;
    else lo = mid;
  }
  const mineUsd = (lo + hi) / 2;
  const s =
    redeemRatio === 0 ? runMineOnly(mineUsd, N_STEPS) : runInterleaved(mineUsd, mineUsd * redeemRatio, N_STEPS);
  return { mineUsd, s };
}

console.log("  -- regime A: 0% redemptions --");
for (const mc of [100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000]) {
  const { mineUsd, s } = mineNeededForMc(mc, 0);
  console.log(
    `  target MC=${fmtUsd(mc).padStart(8)}  →  need mine=${fmtUsd(mineUsd).padStart(9)}  ` +
      `actual MC=${fmtUsd(marketCapOf(s) * ETH_PRICE_USD).padStart(9)}  ` +
      `vault=${fmtUsd(s.reserveEth * ETH_PRICE_USD).padStart(9)}  ` +
      `prem=+${(premiumFractionOf(s) * 100).toFixed(0).padStart(4)}%`,
  );
}

console.log("\n  -- regime B: 80% redemptions (heavy churn) --");
for (const mc of [100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000]) {
  const { mineUsd, s } = mineNeededForMc(mc, 0.8);
  console.log(
    `  target MC=${fmtUsd(mc).padStart(8)}  →  need mine=${fmtUsd(mineUsd).padStart(9)}  ` +
      `actual MC=${fmtUsd(marketCapOf(s) * ETH_PRICE_USD).padStart(9)}  ` +
      `vault=${fmtUsd(s.reserveEth * ETH_PRICE_USD).padStart(9)}  ` +
      `prem=+${(premiumFractionOf(s) * 100).toFixed(0).padStart(4)}%`,
  );
}

// =============================================================================
// (3) Mine/redeem ratio sensitivity
//     hold cumulative mining at $10M, vary redemption from 0% to 99%
// =============================================================================

console.log("\n=== (3) mine/redeem sensitivity at $10M cumulative mining ===");
console.log(`  cumulative mining is fixed; redemption is a fraction of it.`);
console.log(`  the premium ratchet is unaffected by sells — only vault & supply move.\n`);

const FIX_MINE = 10_000_000;
for (const ratio of [0, 0.2, 0.4, 0.6, 0.8, 0.95, 0.99]) {
  const s = ratio === 0 ? runMineOnly(FIX_MINE) : runInterleaved(FIX_MINE, FIX_MINE * ratio);
  row(`mine $10M, redeem ${(ratio * 100).toFixed(0)}%`, s);
}

console.log("\ndone.");
