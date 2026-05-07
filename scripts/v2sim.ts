/**
 * v2 mechanics simulation: floor-ratcheting concentrated LP.
 *
 *   - 21M ascend hard-cap, fully minted into the LP at genesis
 *   - hook owns one V4 LP; the LP IS the vault
 *   - 5% fee on every swap; fee retained as additional ETH in the LP
 *     (deepens depth without minting ascend → floor lifts)
 *   - both buys and sells trade the SAME constant-product curve, single price
 *
 * model:
 *   reserves (X, Y): X ascend in LP, Y ETH in LP
 *   spot_price = Y / X  (ETH per ascend)
 *   buy(e):  net = 0.95·e   →  walk CP from Y to Y+net, fee 0.05·e added to Y after
 *   sell(x): net = 0.95·x   →  walk CP from X to X+net, fee 0.05·x added to X after
 *   floor(t) := Y(t) / (SUPPLY_CAP − X(t))   ETH per circulating ascend
 *                                            ↑ vault / circulating
 *
 *   fee retention compounds depth: every trade leaves the LP with
 *   strictly more "k" (= X·Y) than before. The floor (= ETH per
 *   circulating token) is monotone non-decreasing.
 *
 *   "asymmetric depth" mentioned in the design isn't modeled here as a
 *   free parameter; for the v2 spec, an asymmetric position can be
 *   approximated by adjusting the bootstrap ratio. We use a thin
 *   bootstrap so first buyers consume a lot of supply quickly (which
 *   IS the reflexive upside).
 */

const ETH_USD = 2_350;
const SUPPLY_CAP = 21_000_000;
const FEE = 0.05;
const BOOTSTRAP_ETH = 1;
const STEPS = 1_000;

type V2 = { X: number; Y: number };
const initialV2 = (): V2 => ({ X: SUPPLY_CAP, Y: BOOTSTRAP_ETH });

function v2Buy(s: V2, ethIn: number): V2 {
  const fee = ethIn * FEE;
  const net = ethIn - fee;
  const k = s.X * s.Y;
  const newY1 = s.Y + net;
  const newX = k / newY1;
  const newY = newY1 + fee; // fee retained in LP
  return { X: newX, Y: newY };
}

function v2Sell(s: V2, ethValue: number): V2 {
  const price = s.Y / s.X;
  const ascendIn = ethValue / price;
  const fee = ascendIn * FEE;
  const net = ascendIn - fee;
  const k = s.X * s.Y;
  const newX1 = s.X + net;
  const newY = k / newX1;
  const newX = newX1 + fee; // fee retained in LP
  return { X: newX, Y: newY };
}

function runV2(mineUsd: number, redeemUsd: number): V2 {
  let s = initialV2();
  const ethPerBuy = mineUsd / ETH_USD / STEPS;
  const ratio = mineUsd > 0 ? redeemUsd / mineUsd : 0;
  for (let i = 0; i < STEPS; i++) {
    s = v2Buy(s, ethPerBuy);
    if (ratio > 0) s = v2Sell(s, ethPerBuy * ratio);
  }
  return s;
}

const spot = (s: V2) => s.Y / s.X;
const fdv = (s: V2) => spot(s) * SUPPLY_CAP * ETH_USD;
const circulating = (s: V2) => SUPPLY_CAP - s.X;
const mc = (s: V2) => spot(s) * circulating(s) * ETH_USD;
const liquidityUsd = (s: V2) => s.Y * ETH_USD;
const floorEthPerCirc = (s: V2) => (circulating(s) > 0 ? s.Y / circulating(s) : 0);
const floorUsd = (s: V2) => floorEthPerCirc(s) * ETH_USD;
const priceUsd = (s: V2) => spot(s) * ETH_USD;

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.001) return `$${n.toFixed(4)}`;
  return `$${n.toExponential(2)}`;
}
const fmtNum = (n: number) =>
  Math.abs(n) >= 1e6
    ? `${(n / 1e6).toFixed(2)}M`
    : Math.abs(n) >= 1e3
      ? `${(n / 1e3).toFixed(1)}k`
      : n.toFixed(2);

function row(label: string, mineUsd: number, redeemUsd: number) {
  const s = runV2(mineUsd, redeemUsd);
  const liq = liquidityUsd(s);
  const m = mc(s);
  const f = fdv(s);
  const p = priceUsd(s);
  const fl = floorUsd(s);
  const upside = p / fl;
  console.log(
    `  ${label.padEnd(36)}` +
      `liq=${fmtUsd(liq).padStart(8)}  ` +
      `MC=${fmtUsd(m).padStart(9)}  ` +
      `FDV=${fmtUsd(f).padStart(9)}  ` +
      `price=${fmtUsd(p).padStart(9)}  ` +
      `floor=${fmtUsd(fl).padStart(9)}  ` +
      `liq/MC=${((liq / m) * 100).toFixed(1)}%  ` +
      `circ=${fmtNum(circulating(s)).padStart(7)}  ` +
      `p/floor=${upside.toFixed(2)}×`,
  );
}

console.log(`v2 SIMULATION — single LP, single chart, 5% fee retained as depth`);
console.log(`assumptions: ETH=$${ETH_USD}, supply cap 21M, bootstrap ${BOOTSTRAP_ETH} ETH (~$${(BOOTSTRAP_ETH * ETH_USD).toFixed(0)})\n`);

console.log("=== (1) volume scenarios — same inputs as sato comparison ===\n");
row("$200k mined, no sells", 200_000, 0);
row("$1M mined, $800k sold (net +$200k)", 1_000_000, 800_000);
row("$5M mined, $4.8M sold (net +$200k)", 5_000_000, 4_800_000);
row("sato 24h: $15M mined, $14M sold", 15_000_000, 14_000_000);
row("$50M mined, no sells", 50_000_000, 0);
row("$50M mined, $40M sold", 50_000_000, 40_000_000);

console.log();
console.log("=== (2) FDV milestones — required gross mining ===\n");

function findMineForFdv(targetFdv: number, redeemRatio: number) {
  let lo = 100;
  let hi = 1e12;
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi);
    const s = runV2(mid, mid * redeemRatio);
    if (fdv(s) > targetFdv) hi = mid;
    else lo = mid;
  }
  const mineUsd = (lo + hi) / 2;
  return { mineUsd, s: runV2(mineUsd, mineUsd * redeemRatio) };
}

console.log("regime A: 0% redemptions");
for (const target of [1_000_000, 10_000_000, 21_400_000, 100_000_000, 1_000_000_000]) {
  const { mineUsd, s } = findMineForFdv(target, 0);
  console.log(
    `  target FDV ${fmtUsd(target).padStart(8)}  →  mine ${fmtUsd(mineUsd).padStart(8)}  ` +
      `liq=${fmtUsd(liquidityUsd(s)).padStart(8)}  ` +
      `MC=${fmtUsd(mc(s)).padStart(9)}  ` +
      `floor=${fmtUsd(floorUsd(s)).padStart(8)}  ` +
      `circ=${fmtNum(circulating(s)).padStart(7)}  ` +
      `p/floor=${(priceUsd(s) / floorUsd(s)).toFixed(1)}×`,
  );
}

console.log("\nregime B: 80% redemptions (heavy churn)");
for (const target of [1_000_000, 10_000_000, 21_400_000, 100_000_000, 1_000_000_000]) {
  const { mineUsd, s } = findMineForFdv(target, 0.8);
  console.log(
    `  target FDV ${fmtUsd(target).padStart(8)}  →  mine ${fmtUsd(mineUsd).padStart(8)}  ` +
      `liq=${fmtUsd(liquidityUsd(s)).padStart(8)}  ` +
      `MC=${fmtUsd(mc(s)).padStart(9)}  ` +
      `floor=${fmtUsd(floorUsd(s)).padStart(8)}  ` +
      `circ=${fmtNum(circulating(s)).padStart(7)}  ` +
      `p/floor=${(priceUsd(s) / floorUsd(s)).toFixed(1)}×`,
  );
}

console.log("\n=== (3) v1 vs v2 head-to-head at matched volume ===\n");
console.log(`(v1 numbers from prior sims; v2 below)\n`);
console.log(`scenario              v1 MC      v1 spread   v2 MC      v2 liquidity   v2 chart`);
console.log(`────────────────────  ─────────  ──────────  ─────────  ─────────────  ───────────`);
const compareCases: [string, number, number, string, string][] = [
  ["$200k mine, 0 sells",      200_000,         0,    "$468k",  "2.5×"],
  ["$1M mine, $800k sells",    1_000_000,    800_000, "$889k",  "3.9×"],
  ["sato 24h ($15M / $14M)",   15_000_000, 14_000_000, "$46.8M", "29×"],
];
for (const [name, mine, redeem, v1mc, v1spread] of compareCases) {
  const s = runV2(mine, redeem);
  console.log(
    `${name.padEnd(20)}  ${v1mc.padStart(9)}  ${v1spread.padStart(10)}  ` +
      `${fmtUsd(mc(s)).padStart(9)}  ${fmtUsd(liquidityUsd(s)).padStart(13)}  single band`,
  );
}

console.log("\n=== (4) reflexivity — what fresh demand does to price ===\n");
console.log(`starting from the $200k-mined state, walk an additional buy through.`);

const after200k = runV2(200_000, 0);
console.log(`  state after $200k mined: price=${fmtUsd(priceUsd(after200k))}, MC=${fmtUsd(mc(after200k))}`);
const oneEth = v2Buy(after200k, 1); // 1 ETH = ~$2350
console.log(
  `  +1 ETH ($2,350) buy → new price=${fmtUsd((oneEth.Y / oneEth.X) * ETH_USD)}, ` +
    `Δprice=${(((oneEth.Y / oneEth.X) / spot(after200k) - 1) * 100).toFixed(1)}%`,
);
const tenEth = v2Buy(after200k, 10);
console.log(
  `  +10 ETH ($23,500) buy → new price=${fmtUsd((tenEth.Y / tenEth.X) * ETH_USD)}, ` +
    `Δprice=${(((tenEth.Y / tenEth.X) / spot(after200k) - 1) * 100).toFixed(1)}%`,
);
