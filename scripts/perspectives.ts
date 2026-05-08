/**
 * Four-perspective simulations of v2 (option A).
 *
 *   1. BUYER — what does it cost to mint at different volume points?
 *      slippage, effective fee %, tokens received, $ in vs ascend out.
 *
 *   2. SELLER — what does it return to redeem at different points?
 *      slippage, fee, ETH out for a given ascend amount.
 *
 *   3. CHART — what would the candles look like? walks the price curve
 *      under a randomized 1000-step trade sequence and reports the
 *      open/high/low/close per "candle" (every 50 steps), so it can
 *      be eyeballed.
 *
 *   4. MCAP / FLOOR — at growing cumulative volume, how do the
 *      protocol-level numbers (MC, FDV, floor, liquidity) evolve?
 */

import {
  SUPPLY_CAP,
  BOOTSTRAP_ETH,
  MINT_FEE_ETH,
  SWAP_FEE_RATE,
  LP_SHARE,
  TILE_SHARE,
  effectiveBuyFeePips,
  PIP_DENOM,
  type State,
} from "../lib/floor";

const ETH_USD = 2_350;

// ---------- helpers ---------------------------------------------------------

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.001) return `$${n.toFixed(4)}`;
  return `$${n.toExponential(2)}`;
}

function fmtPct(n: number, d = 2): string {
  return `${(n * 100).toFixed(d)}%`;
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return n.toFixed(4);
}

function genesis(): State {
  return { reserveEth: BOOTSTRAP_ETH, reserveAscend: SUPPLY_CAP };
}

function applyBuy(s: State, ethIn: number): State {
  if (ethIn <= MINT_FEE_ETH) return s;
  const feePips = effectiveBuyFeePips(ethIn);
  const fee = ethIn * (feePips / PIP_DENOM);
  const net = ethIn - fee;
  if (net <= 0) return s;
  const k = s.reserveEth * s.reserveAscend;
  const yAfter = s.reserveEth + net;
  const xAfter = k / yAfter;
  // 70% of fee retained as LP depth (raises Y)
  return {
    reserveEth: yAfter + fee * LP_SHARE,
    reserveAscend: xAfter,
  };
}

function applySell(s: State, ascendIn: number): State {
  if (ascendIn <= 0) return s;
  // Sellers must hold what they're selling. Circulating = SUPPLY_CAP - X_in_LP.
  const circ = SUPPLY_CAP - s.reserveAscend;
  if (ascendIn > circ * 0.99) ascendIn = circ * 0.99;
  if (ascendIn <= 0) return s;
  const fee = ascendIn * SWAP_FEE_RATE;
  const net = ascendIn - fee;
  const k = s.reserveEth * s.reserveAscend;
  const xAfter = s.reserveAscend + net;
  const yAfter = k / xAfter;
  return {
    reserveEth: yAfter,
    reserveAscend: xAfter + fee,
  };
}

function spotPrice(s: State): number {
  return s.reserveAscend > 0 ? s.reserveEth / s.reserveAscend : 0;
}

function floorPrice(s: State): number {
  const circ = SUPPLY_CAP - s.reserveAscend;
  return circ > 0 ? s.reserveEth / circ : 0;
}

function circulating(s: State): number {
  return Math.max(0, SUPPLY_CAP - s.reserveAscend);
}

function mcEth(s: State): number {
  return spotPrice(s) * circulating(s);
}

function fdvEth(s: State): number {
  return spotPrice(s) * SUPPLY_CAP;
}

/** Drive state to a target cumulative-mining volume by walking many small buys. */
function statesAfterMining(targetMineUsd: number, redeemRatio = 0): State {
  const steps = 800;
  let s = genesis();
  const ethPerBuy = targetMineUsd / ETH_USD / steps;
  for (let i = 0; i < steps; i++) {
    s = applyBuy(s, ethPerBuy);
    if (redeemRatio > 0) {
      const sellEth = ethPerBuy * redeemRatio;
      const askPrice = spotPrice(s);
      const ascendIn = askPrice > 0 ? sellEth / askPrice : 0;
      s = applySell(s, ascendIn);
    }
  }
  return s;
}

// =========================================================================
// PERSPECTIVE 1 — THE BUYER
// =========================================================================

console.log(`\n${"═".repeat(76)}`);
console.log(`PERSPECTIVE 1 — THE BUYER`);
console.log(`${"═".repeat(76)}\n`);
console.log(`What does it cost to buy ascend? Below: a single buy of various sizes,`);
console.log(`at three different states of the protocol.\n`);

const buyerScenarios: { label: string; state: State }[] = [
  { label: "GENESIS (just deployed)", state: genesis() },
  { label: "AFTER $200k MINING", state: statesAfterMining(200_000, 0) },
  { label: "AFTER $5M MINING", state: statesAfterMining(5_000_000, 0) },
];

const buySizes = [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 100];

for (const scn of buyerScenarios) {
  const stateLabel = `${scn.label}  spot=${fmtUsd(spotPrice(scn.state) * ETH_USD)}  floor=${fmtUsd(floorPrice(scn.state) * ETH_USD)}`;
  console.log(`--- ${stateLabel}`);
  console.log(`  ${"buy".padStart(8)}  ${"USD in".padStart(9)}  ${"fee %".padStart(7)}  ${"fee USD".padStart(9)}  ${"ascend out".padStart(11)}  ${"USD/ascend".padStart(11)}  ${"slippage".padStart(8)}`);
  for (const ethIn of buySizes) {
    if (ethIn <= MINT_FEE_ETH) {
      console.log(`  ${(ethIn + " ETH").padStart(8)}  ${fmtUsd(ethIn * ETH_USD).padStart(9)}  ${"REVERT (below dust floor)".padStart(60)}`);
      continue;
    }
    const before = scn.state;
    const after = applyBuy(before, ethIn);
    const ascendOut = before.reserveAscend - after.reserveAscend;
    const usdIn = ethIn * ETH_USD;
    const feePips = effectiveBuyFeePips(ethIn);
    const feeUsd = ethIn * (feePips / PIP_DENOM) * ETH_USD;
    const usdPerAscend = ascendOut > 0 ? usdIn / ascendOut : 0;
    const spotBefore = spotPrice(before);
    const slippage = spotBefore > 0 ? (usdPerAscend / (spotBefore * ETH_USD)) - 1 : 0;
    console.log(
      `  ${(ethIn + " ETH").padStart(8)}  ${fmtUsd(usdIn).padStart(9)}  ${fmtPct(feePips / PIP_DENOM).padStart(7)}  ${fmtUsd(feeUsd).padStart(9)}  ${fmtNum(ascendOut).padStart(11)}  ${fmtUsd(usdPerAscend).padStart(11)}  ${fmtPct(slippage, 2).padStart(8)}`,
    );
  }
  console.log();
}

console.log(`Reading the table:`);
console.log(`  - The smallest buys (0.001 ETH = $2.35) revert because they're below the dust floor.`);
console.log(`  - Small buys (0.01 ETH = $24) pay 11–13% effective fee due to the $2 surcharge.`);
console.log(`  - Buys at $235+ pay ~2% effective fee — close to the base 1%.`);
console.log(`  - Big buys (5 ETH = $11k) pay ~1% — the surcharge is a rounding error.`);
console.log(`  - Big buys also have meaningful slippage as the curve walks up.`);

// =========================================================================
// PERSPECTIVE 2 — THE SELLER
// =========================================================================

console.log(`\n${"═".repeat(76)}`);
console.log(`PERSPECTIVE 2 — THE SELLER`);
console.log(`${"═".repeat(76)}\n`);
console.log(`What does the seller receive? Below: redeeming various amounts at the`);
console.log(`same three states.\n`);

for (const scn of buyerScenarios) {
  if (circulating(scn.state) < 1) {
    console.log(`--- ${scn.label}: nothing in circulation yet, skipping\n`);
    continue;
  }
  const stateLabel = `${scn.label}  spot=${fmtUsd(spotPrice(scn.state) * ETH_USD)}  floor=${fmtUsd(floorPrice(scn.state) * ETH_USD)}  circulating=${fmtNum(circulating(scn.state))} ascend`;
  console.log(`--- ${stateLabel}`);
  console.log(`  ${"sell %".padStart(7)}  ${"ascend".padStart(11)}  ${"USD value".padStart(10)}  ${"fee USD".padStart(9)}  ${"ETH out".padStart(9)}  ${"USD out".padStart(10)}  ${"USD/ascend".padStart(11)}  ${"slippage".padStart(9)}`);
  for (const fracOfCirc of [0.0001, 0.001, 0.01, 0.05, 0.1]) {
    const ascendIn = circulating(scn.state) * fracOfCirc;
    if (ascendIn < 1) continue;
    const before = scn.state;
    const after = applySell(before, ascendIn);
    const ethOut = before.reserveEth - after.reserveEth;
    const usdOut = ethOut * ETH_USD;
    const usdValue = ascendIn * spotPrice(before) * ETH_USD;
    const fee = ascendIn * SWAP_FEE_RATE;
    const feeUsd = fee * spotPrice(before) * ETH_USD;
    const usdPerAscend = ascendIn > 0 ? usdOut / ascendIn : 0;
    const spotBefore = spotPrice(before);
    const slippage = spotBefore > 0 ? (usdPerAscend / (spotBefore * ETH_USD)) - 1 : 0;
    console.log(
      `  ${(fracOfCirc * 100).toFixed(2).padStart(6)}%  ${fmtNum(ascendIn).padStart(11)}  ${fmtUsd(usdValue).padStart(10)}  ${fmtUsd(feeUsd).padStart(9)}  ${ethOut.toExponential(2).padStart(9)}  ${fmtUsd(usdOut).padStart(10)}  ${fmtUsd(usdPerAscend).padStart(11)}  ${fmtPct(slippage, 2).padStart(9)}`,
    );
  }
  console.log();
}

console.log(`Reading the table:`);
console.log(`  - Sells always pay a flat 1% fee — no surcharge.`);
console.log(`  - "Slippage" is negative — sellers receive less than spot price as their`);
console.log(`    sell pushes the curve down. This is normal AMM behaviour.`);
console.log(`  - Selling 1% of circulating moves the price ~1–2% (depending on state).`);
console.log(`  - Selling 10% of circulating is ALWAYS painful — the curve walks down hard.`);

// =========================================================================
// PERSPECTIVE 3 — THE CHART
// =========================================================================

console.log(`\n${"═".repeat(76)}`);
console.log(`PERSPECTIVE 3 — THE CHART (what DexScreener candles would show)`);
console.log(`${"═".repeat(76)}\n`);
console.log(`Walks a 600-step randomized trade sequence (60% buys, 40% sells weighted`);
console.log(`by random amount), takes 50 steps per "candle" → 12 candles total. The`);
console.log(`OHLC shows the open / high / low / close price during each candle.\n`);

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function runChart(targetCumMineUsd: number, sellRatio: number, candleCount = 12) {
  const stepsPerCandle = 50;
  const totalSteps = candleCount * stepsPerCandle;
  const rand = rng(42);
  let s = genesis();
  const ethPerStep = targetCumMineUsd / ETH_USD / totalSteps;

  const candles: { open: number; high: number; low: number; close: number; trades: number }[] = [];
  let candleHigh = spotPrice(s);
  let candleLow = spotPrice(s);
  let candleOpen = spotPrice(s);
  let trades = 0;

  for (let i = 0; i < totalSteps; i++) {
    // Bias buys vs sells based on sellRatio. sellRatio=1 → 50/50.
    // sellRatio=0.3 → mostly buys. sellRatio=1.5 → mostly sells.
    const isBuy = rand() < 1 / (1 + sellRatio);
    const sizeMul = 0.5 + rand() * 1.0; // 0.5x to 1.5x typical step size
    if (isBuy) {
      s = applyBuy(s, ethPerStep * sizeMul);
    } else {
      const sellEth = ethPerStep * sizeMul;
      const askPrice = spotPrice(s);
      const ascendIn = askPrice > 0 ? sellEth / askPrice : 0;
      s = applySell(s, ascendIn);
    }
    trades++;
    const p = spotPrice(s);
    if (p > candleHigh) candleHigh = p;
    if (p < candleLow) candleLow = p;

    if ((i + 1) % stepsPerCandle === 0) {
      candles.push({
        open: candleOpen,
        high: candleHigh,
        low: candleLow,
        close: p,
        trades,
      });
      candleOpen = p;
      candleHigh = p;
      candleLow = p;
      trades = 0;
    }
  }

  return { candles, finalState: s };
}

const chartScenarios = [
  { label: "ACTIVE: $1M cumulative volume, 50/50 buys/sells", mine: 1_000_000, sell: 1.0 },
  { label: "BULLISH: $1M cumulative volume, mostly buys (sell ratio 0.3)", mine: 1_000_000, sell: 0.3 },
  { label: "BEARISH: $1M cumulative volume, mostly sells (sell ratio 1.5)", mine: 1_000_000, sell: 1.5 },
];

for (const scn of chartScenarios) {
  console.log(`--- ${scn.label}`);
  const { candles, finalState } = runChart(scn.mine, scn.sell);
  console.log(`  ${"#".padStart(2)}  ${"open".padStart(10)}  ${"high".padStart(10)}  ${"low".padStart(10)}  ${"close".padStart(10)}  ${"color".padStart(5)}  ${"sparkline".padStart(15)}`);
  // sparkline sized relative to all closes
  const allHighs = candles.map((c) => c.high);
  const allLows = candles.map((c) => c.low);
  const overallMax = Math.max(...allHighs);
  const overallMin = Math.min(...allLows);
  const range = Math.max(overallMax - overallMin, 1e-30);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const color = c.close > c.open ? "🟢" : "🔴";
    // sparkline positions
    const lowPos = Math.round(((c.low - overallMin) / range) * 14);
    const highPos = Math.round(((c.high - overallMin) / range) * 14);
    const closePos = Math.round(((c.close - overallMin) / range) * 14);
    let spark = "";
    for (let j = 0; j < 15; j++) {
      if (j === closePos) spark += "●";
      else if (j >= lowPos && j <= highPos) spark += "│";
      else spark += " ";
    }
    console.log(
      `  ${(i + 1).toString().padStart(2)}  ${fmtUsd(c.open * ETH_USD).padStart(10)}  ${fmtUsd(c.high * ETH_USD).padStart(10)}  ${fmtUsd(c.low * ETH_USD).padStart(10)}  ${fmtUsd(c.close * ETH_USD).padStart(10)}    ${color}   ${spark}`,
    );
  }
  console.log(
    `  end: spot=${fmtUsd(spotPrice(finalState) * ETH_USD)}  floor=${fmtUsd(floorPrice(finalState) * ETH_USD)}  liq=${fmtUsd(finalState.reserveEth * ETH_USD)}  MC=${fmtUsd(mcEth(finalState) * ETH_USD)}\n`,
  );
}

console.log(`Reading the chart:`);
console.log(`  - All scenarios show normal-looking candles: red and green wicks, both`);
console.log(`    sides. A retail viewer sees a normal token chart.`);
console.log(`  - In BULLISH, price walks up steadily.`);
console.log(`  - In BEARISH, price drops; but the floor is still rising underneath.`);
console.log(`  - In ACTIVE, the chart oscillates around a slowly rising mid-line.`);

// =========================================================================
// PERSPECTIVE 4 — MCAP / FLOOR PROGRESSION
// =========================================================================

console.log(`\n${"═".repeat(76)}`);
console.log(`PERSPECTIVE 4 — MCAP / FLOOR (the protocol view)`);
console.log(`${"═".repeat(76)}\n`);
console.log(`Snapshot of protocol metrics at growing cumulative mining volume.\n`);

console.log(`Regime A: 0% redemptions (pure mining):`);
console.log(`  ${"cum mining".padStart(10)}  ${"liq (LP)".padStart(10)}  ${"floor".padStart(11)}  ${"spot".padStart(11)}  ${"MC".padStart(11)}  ${"FDV".padStart(11)}  ${"upside".padStart(7)}  ${"liq/MC".padStart(7)}`);
for (const targetUsd of [10_000, 50_000, 200_000, 1_000_000, 5_000_000, 50_000_000]) {
  const s = statesAfterMining(targetUsd, 0);
  const liq = s.reserveEth * ETH_USD;
  const fp = floorPrice(s) * ETH_USD;
  const sp = spotPrice(s) * ETH_USD;
  const m = mcEth(s) * ETH_USD;
  const f = fdvEth(s) * ETH_USD;
  const upside = fp > 0 ? sp / fp : 0;
  const liqMc = m > 0 ? liq / m : 0;
  console.log(
    `  ${fmtUsd(targetUsd).padStart(10)}  ${fmtUsd(liq).padStart(10)}  ${fmtUsd(fp).padStart(11)}  ${fmtUsd(sp).padStart(11)}  ${fmtUsd(m).padStart(11)}  ${fmtUsd(f).padStart(11)}  ${(upside.toFixed(1) + "x").padStart(7)}  ${fmtPct(liqMc, 1).padStart(7)}`,
  );
}

console.log(`\nRegime B: 80% redemptions (heavy churn — most exits):`);
console.log(`  ${"cum mining".padStart(10)}  ${"liq (LP)".padStart(10)}  ${"floor".padStart(11)}  ${"spot".padStart(11)}  ${"MC".padStart(11)}  ${"FDV".padStart(11)}  ${"upside".padStart(7)}  ${"liq/MC".padStart(7)}`);
for (const targetUsd of [10_000, 50_000, 200_000, 1_000_000, 5_000_000, 50_000_000]) {
  const s = statesAfterMining(targetUsd, 0.8);
  const liq = s.reserveEth * ETH_USD;
  const fp = floorPrice(s) * ETH_USD;
  const sp = spotPrice(s) * ETH_USD;
  const m = mcEth(s) * ETH_USD;
  const f = fdvEth(s) * ETH_USD;
  const upside = fp > 0 ? sp / fp : 0;
  const liqMc = m > 0 ? liq / m : 0;
  console.log(
    `  ${fmtUsd(targetUsd).padStart(10)}  ${fmtUsd(liq).padStart(10)}  ${fmtUsd(fp).padStart(11)}  ${fmtUsd(sp).padStart(11)}  ${fmtUsd(m).padStart(11)}  ${fmtUsd(f).padStart(11)}  ${(upside.toFixed(1) + "x").padStart(7)}  ${fmtPct(liqMc, 1).padStart(7)}`,
  );
}

console.log(`\n--- TileEngine pool growth ---\n`);
console.log(`The TileEngine receives 30% of every fee. At various daily volumes:\n`);
console.log(`  ${"daily volume".padStart(15)}  ${"daily fees".padStart(12)}  ${"to TileEngine".padStart(15)}  ${"epoch base reward".padStart(20)}  ${"4× jackpot".padStart(11)}`);
for (const dailyVol of [10_000, 100_000, 1_000_000, 5_000_000, 15_000_000]) {
  // Assume half buys: each buy pays ~1% + flat $2; each sell pays 1%
  // Simplified: avg fee ≈ 1% of volume + (2 × buyCount). Estimate buyCount=10/buyAmount
  const baseFees = dailyVol * 0.01;
  // Count of buys depends on size mix; assume avg buy = $500 → 0.5 × dailyVol / $500 buys
  const buyCount = (dailyVol * 0.5) / 500;
  const surchargeFees = buyCount * 2; // $2 per buy
  const totalFees = baseFees + surchargeFees;
  const tileFees = totalFees * TILE_SHARE;
  const baseReward = tileFees / 144 / 1.625; // E[m] = 1.625
  const jackpot = baseReward * 4;
  console.log(
    `  ${fmtUsd(dailyVol).padStart(15)}  ${fmtUsd(totalFees).padStart(12)}  ${fmtUsd(tileFees).padStart(15)}  ${fmtUsd(baseReward).padStart(20)}  ${fmtUsd(jackpot).padStart(11)}`,
  );
}

console.log(`\nReading the table:`);
console.log(`  - The lottery scales linearly with trading activity. No volume → tiny pool.`);
console.log(`  - At low volumes ($10k/day) the lottery is sub-dollar; at $15M/day it's $230 base.`);
console.log(`  - The "buy count" assumption is avg buy = $500. Smaller buys → more $2 surcharges → bigger pool.`);
console.log();
console.log(`${"═".repeat(76)}`);
console.log(`Done. To rerun: npx tsx scripts/perspectives.ts`);
console.log(`${"═".repeat(76)}\n`);
