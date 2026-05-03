/**
 * Market-cap simulation for Ascent.
 *
 * Inputs:
 *   - 2 ETH initial LP liquidity
 *   - $1,000,000 cumulative BUY volume
 *   - $900,000 cumulative SELL volume
 *
 * Models:
 *   - Uniswap v2-style x*y=k AMM (v4 base curve at full-range)
 *   - Ascent hook: buyer tax (m-1)/m → treasury, seller bonus (m-1) ← treasury
 *   - Per-block multiplicative decay of F, V, D, C
 *
 * Token total supply: 1,000,000,000 ASCENT (per script/Deploy.s.sol).
 */

import {
  ALPHA,
  S_F,
  S_V,
  S_D,
  S_C,
  GAMMA,
  THETA,
  PHI,
  P_COMPRESSION,
  multiplier,
  applySwap,
  type AscentState,
} from "../lib/math";

const TOTAL_SUPPLY = 1_000_000_000;
const ETH_PRICE_USD = 4_000;

// Per-block multiplicative decay rates (mirror of contracts/src/lib/AscentState.sol).
const R_F = 0.005;
const R_V = 0.05;
const R_D = 0.0005;
const R_C = 0.01;

interface Pool {
  ethReserve: number;
  ascReserve: number;
  treasury: number;
  state: AscentState;
  block: number;
}

function decay(s: AscentState, dt: number): AscentState {
  const f = (rate: number) => Math.max(0, 1 - rate * dt);
  return {
    F: s.F * f(R_F),
    V: s.V * f(R_V),
    D: s.D * f(R_D),
    C: Math.max(0, s.C * f(R_C)),
  };
}

function spotPriceEth(p: Pool): number {
  // ETH per ASCENT — the marginal swap rate ignoring slippage and the multiplier.
  return p.ethReserve / p.ascReserve;
}

function marketCapUsd(p: Pool): number {
  return spotPriceEth(p) * TOTAL_SUPPLY * ETH_PRICE_USD;
}

/**
 * Buy: user spends `ethIn` ETH, hook taxes (m-1)/m → treasury, AMM swaps the
 * remainder (= ethIn/m) for ASCENT. User receives the AMM output.
 */
function buy(p: Pool, ethIn: number) {
  const post = applySwap(p.state, ethIn, true);
  const m = multiplier(post);
  const tax = m > 1 ? (ethIn * (m - 1)) / m : 0;
  const ethToAmm = ethIn - tax;

  // x*y = k constant product
  const newEth = p.ethReserve + ethToAmm;
  const newAsc = (p.ethReserve * p.ascReserve) / newEth;
  const ascOut = p.ascReserve - newAsc;

  p.ethReserve = newEth;
  p.ascReserve = newAsc;
  p.treasury += tax;
  p.state = post;

  return { ascOut, m, tax };
}

/**
 * Sell: user sends `ascIn` ASCENT, AMM returns ETH baseOut, hook adds bonus
 * = min(ascIn·(m-1) priced in ETH, treasury). Bonus is paid in ETH from treasury.
 *
 * The contract sizes the bonus as `amountIn * (m-1)` in *currency1 units*
 * (ASCENT) but pays it in currency0 (ETH). To keep symmetry with the buy-side
 * tax (denominated in ETH), we interpret bonus as `ethBaseOut * (m-1)`,
 * matching the off-chain quoter / preview semantics.
 */
function sell(p: Pool, ascIn: number) {
  const post = applySwap(p.state, ascIn, false);
  const m = multiplier(post);

  const newAsc = p.ascReserve + ascIn;
  const newEth = (p.ethReserve * p.ascReserve) / newAsc;
  const baseOut = p.ethReserve - newEth;

  let bonus = 0;
  if (m > 1 && p.treasury > 0) {
    const requested = baseOut * (m - 1);
    bonus = Math.min(requested, p.treasury);
  }

  p.ethReserve = newEth;
  p.ascReserve = newAsc;
  p.treasury -= bonus;
  p.state = post;

  return { ethOut: baseOut + bonus, m, bonus };
}

function advanceBlocks(p: Pool, blocks: number) {
  if (blocks <= 0) return;
  p.state = decay(p.state, blocks);
  p.block += blocks;
}

interface ScenarioOpts {
  initialEth: number;
  initialAsc: number;
  totalBuyUsd: number;
  totalSellUsd: number;
  numBuys: number;
  numSells: number;
  blocksBetweenTrades: number;
  /** "interleaved" alternates buy/sell; "sequential" runs all buys then all sells. */
  ordering: "interleaved" | "sequential";
}

interface Snap {
  label: string;
  priceEth: number;
  priceUsd: number;
  fdvUsd: number;
  multiplier: number;
  treasuryEth: number;
  ethReserve: number;
  ascReserve: number;
}

function snap(p: Pool, label: string): Snap {
  const priceEth = spotPriceEth(p);
  return {
    label,
    priceEth,
    priceUsd: priceEth * ETH_PRICE_USD,
    fdvUsd: priceEth * TOTAL_SUPPLY * ETH_PRICE_USD,
    multiplier: multiplier(p.state),
    treasuryEth: p.treasury,
    ethReserve: p.ethReserve,
    ascReserve: p.ascReserve,
  };
}

const fmtUsd = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
    ? `$${(n / 1e6).toFixed(2)}M`
    : n >= 1e3
    ? `$${(n / 1e3).toFixed(1)}k`
    : `$${n.toFixed(2)}`;

function runScenario(opts: ScenarioOpts) {
  const pool: Pool = {
    ethReserve: opts.initialEth,
    ascReserve: opts.initialAsc,
    treasury: 0,
    state: { F: 0, V: 0, D: 0, C: 0 },
    block: 0,
  };

  const snaps: Snap[] = [];
  snaps.push(snap(pool, "t0 (seed)"));

  const totalBuyEth = opts.totalBuyUsd / ETH_PRICE_USD;
  const totalSellUsd = opts.totalSellUsd;

  if (opts.ordering === "sequential") {
    // BUYS
    const ethPerBuy = totalBuyEth / opts.numBuys;
    for (let i = 0; i < opts.numBuys; i++) {
      buy(pool, ethPerBuy);
      advanceBlocks(pool, opts.blocksBetweenTrades);
    }
    snaps.push(snap(pool, `after $${opts.totalBuyUsd / 1e6}M buys`));

    // SELLS — sized so each sell extracts ~equal USD; stop when pool is dry.
    const targetUsdPerSell = totalSellUsd / opts.numSells;
    let usdSold = 0;
    let aborted = false;
    for (let i = 0; i < opts.numSells; i++) {
      const ethTarget = Math.min(
        targetUsdPerSell / ETH_PRICE_USD,
        pool.ethReserve * 0.9, // never try to take more than 90% of what's left
      );
      if (ethTarget < 1e-12 || pool.ethReserve < 1e-9) {
        aborted = true;
        break;
      }
      const ascIn = ethTarget / Math.max(spotPriceEth(pool), 1e-30);
      const { ethOut } = sell(pool, ascIn);
      usdSold += ethOut * ETH_PRICE_USD;
      advanceBlocks(pool, opts.blocksBetweenTrades);
      if (usdSold >= totalSellUsd) break;
    }
    snaps.push(
      snap(
        pool,
        aborted
          ? `sells exhausted pool at ${fmtUsd(usdSold)} (target $${(totalSellUsd / 1e3).toFixed(0)}k)`
          : `after $${opts.totalSellUsd / 1e3}k sells`,
      ),
    );
  } else {
    // Interleaved 1:1 ratio of count, sized so totals match
    const ethPerBuy = totalBuyEth / opts.numBuys;
    const ratio = opts.totalSellUsd / opts.totalBuyUsd; // sells are this fraction of buys
    for (let i = 0; i < opts.numBuys; i++) {
      buy(pool, ethPerBuy);
      advanceBlocks(pool, opts.blocksBetweenTrades);
      // matching sell: scale sell USD per buy
      const sellUsd = (ethPerBuy * ETH_PRICE_USD) * ratio;
      const ethTarget = sellUsd / ETH_PRICE_USD;
      const ascIn = ethTarget / Math.max(spotPriceEth(pool), 1e-30);
      sell(pool, ascIn);
      advanceBlocks(pool, opts.blocksBetweenTrades);
    }
    snaps.push(snap(pool, `after interleaved $${opts.totalBuyUsd / 1e6}M buy / $${opts.totalSellUsd / 1e3}k sell`));
  }

  return snaps;
}

// ---------- run scenarios ----------

const fmtNum = (n: number, d = 4) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

function printSnaps(title: string, snaps: Snap[]) {
  console.log(`\n=== ${title} ===`);
  for (const s of snaps) {
    console.log(
      `${s.label.padEnd(46)}` +
        `  price=${s.priceUsd < 0.01 ? `$${s.priceUsd.toExponential(3)}` : `$${s.priceUsd.toFixed(6)}`}` +
        `  FDV=${fmtUsd(s.fdvUsd)}` +
        `  m=×${fmtNum(s.multiplier, 3)}` +
        `  treasury=${fmtNum(s.treasuryEth, 3)} Ξ` +
        `  reserves=(${fmtNum(s.ethReserve, 3)} Ξ, ${fmtNum(s.ascReserve, 0)} ASC)`,
    );
  }
}

const seeds = [
  { name: "Seed A — full supply in LP (1B ASCENT + 2 Ξ)", asc: 1_000_000_000 },
  { name: "Seed B — 10% in LP (100M ASCENT + 2 Ξ)", asc: 100_000_000 },
  { name: "Seed C — 1% in LP (10M ASCENT + 2 Ξ)", asc: 10_000_000 },
];

console.log("Assumptions:");
console.log(`  ETH price: $${ETH_PRICE_USD.toLocaleString()}`);
console.log(`  Total ASCENT supply: ${TOTAL_SUPPLY.toLocaleString()}`);
console.log(`  $1M buys (= ${(1_000_000 / ETH_PRICE_USD).toFixed(0)} Ξ), then $900k sells`);
console.log(`  100 trades each side, 5 blocks between trades (~1 min on Ethereum)`);
console.log(
  `  α=${ALPHA}, S_F=${S_F}, S_V=${S_V}, S_D=${S_D}, S_C=${S_C}, γ=${GAMMA}, θ=${THETA}, φ=${PHI}, p=${P_COMPRESSION}`,
);

for (const { name, asc } of seeds) {
  console.log(`\n\n#### ${name} ####`);
  console.log("→ Sequential: all buys, then all sells");
  const seq = runScenario({
    initialEth: 2,
    initialAsc: asc,
    totalBuyUsd: 1_000_000,
    totalSellUsd: 900_000,
    numBuys: 100,
    numSells: 100,
    blocksBetweenTrades: 5,
    ordering: "sequential",
  });
  printSnaps("sequential", seq);

  console.log("→ Interleaved: alternating buy/sell at 0.9× ratio");
  const inter = runScenario({
    initialEth: 2,
    initialAsc: asc,
    totalBuyUsd: 1_000_000,
    totalSellUsd: 900_000,
    numBuys: 100,
    numSells: 100,
    blocksBetweenTrades: 5,
    ordering: "interleaved",
  });
  printSnaps("interleaved", inter);
}
