/**
 * v2 LP concentration sweep.
 *
 * V4 concentrated LPs have a "depth multiplier" c ≥ 1: the position
 * behaves as if it held c× more reserves than its physical capital. c
 * is determined by the range tightness:
 *
 *   c ≈ 1                  full range (V2-equivalent)
 *   c ≈ 2                  range ≈ [P/4, 4P]    (P range factor 16×)
 *   c ≈ 5                  range ≈ [P/25, 25P]  (P range factor 625×)
 *   c ≈ 10                 range ≈ [P/100, 100P] (range factor 10⁴)
 *   c ≈ 50                 ultra-tight, range factor ≈ 10⁶
 *
 * For a launch with a HARD CONSTRAINT of 1 ETH bootstrap, concentration
 * controls how slippy the early trades are. Wider range = more slippy,
 * faster price discovery. Tighter = deeper at current price, less price
 * impact per dollar.
 */

const ETH_USD = 2_350;
const SUPPLY_CAP = 122_000_000;
const FEE = 0.01;
const MINT_FEE_ETH = 0.001;
const BOOTSTRAP_ETH = 1;
const STEPS = 1_000;

type V2 = { X: number; Y: number };
const initialV2 = (): V2 => ({ X: SUPPLY_CAP, Y: BOOTSTRAP_ETH });

/** Concentrated-LP buy. c=1 reduces to plain constant-product.
 *  Includes the option-A fee model (1% + $2 surcharge, mint-cap-clamped). */
function v2Buy(s: V2, ethIn: number, c: number): V2 {
  if (ethIn <= MINT_FEE_ETH) return s;
  const fee = ethIn * FEE + MINT_FEE_ETH;
  const net = ethIn - fee;
  if (net <= 0) return s;
  const Yv = s.Y * c;
  const Xv = s.X * c;
  const newYv = Yv + net;
  const newXv = (Xv * Yv) / newYv;
  const dX = Xv - newXv; // physical decrease in ascend
  return { X: s.X - dX, Y: s.Y + ethIn };
}

function v2Sell(s: V2, ethValue: number, c: number): V2 {
  const price = s.Y / s.X;
  const ascendIn = ethValue / price;
  const fee = ascendIn * FEE;
  const net = ascendIn - fee;
  const Yv = s.Y * c;
  const Xv = s.X * c;
  const newXv = Xv + net;
  const newYv = (Xv * Yv) / newXv;
  const dY = Yv - newYv; // physical decrease in ETH
  return { X: s.X + ascendIn, Y: s.Y - dY };
}

function run(mineUsd: number, redeemUsd: number, c: number): V2 {
  let s = initialV2();
  const ethPerBuy = mineUsd / ETH_USD / STEPS;
  const ratio = mineUsd > 0 ? redeemUsd / mineUsd : 0;
  for (let i = 0; i < STEPS; i++) {
    s = v2Buy(s, ethPerBuy, c);
    if (ratio > 0) s = v2Sell(s, ethPerBuy * ratio, c);
  }
  return s;
}

const spot = (s: V2) => s.Y / s.X;
const fdv = (s: V2) => spot(s) * SUPPLY_CAP * ETH_USD;
const circ = (s: V2) => SUPPLY_CAP - s.X;
const mc = (s: V2) => spot(s) * circ(s) * ETH_USD;
const liq = (s: V2) => s.Y * ETH_USD;
const floor = (s: V2) => (circ(s) > 0 ? (s.Y / circ(s)) * ETH_USD : 0);
const price = (s: V2) => spot(s) * ETH_USD;

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.001) return `$${n.toFixed(4)}`;
  return `$${n.toExponential(2)}`;
}

const concentrations = [1, 2, 5, 10, 25];
const cases: [string, number, number][] = [
  ["$50k mined, no sells",   50_000,         0],
  ["$200k mined, no sells",  200_000,        0],
  ["$1M / $800k sold",       1_000_000,      800_000],
  ["sato 24h ($15M / $14M)", 15_000_000,     14_000_000],
  ["aggressive: $50M / $40M", 50_000_000,    40_000_000],
];

console.log(`v2 concentration sweep — bootstrap 1 ETH, supply 122M\n`);
console.log(`c=1   full range  (V2-equivalent)`);
console.log(`c=2   range factor 16×  (price walks within [genesis/4, 4×ceiling])`);
console.log(`c=5   range factor 625× (looser, more headroom)`);
console.log(`c=10  range factor 10⁴  (typical concentrated launch)`);
console.log(`c=25  range factor 6×10⁵ (tight, low slippage but fast cap-out)\n`);

for (const [name, mine, redeem] of cases) {
  console.log(`--- ${name} ---`);
  console.log(`  c    MC          FDV         liq       price       floor      liq/MC   p/floor`);
  for (const c of concentrations) {
    const s = run(mine, redeem, c);
    console.log(
      `  ${c.toString().padStart(2)}   ` +
        `${fmtUsd(mc(s)).padStart(10)}  ${fmtUsd(fdv(s)).padStart(10)}  ` +
        `${fmtUsd(liq(s)).padStart(8)}  ${fmtUsd(price(s)).padStart(10)}  ` +
        `${fmtUsd(floor(s)).padStart(9)}  ` +
        `${((liq(s) / mc(s)) * 100).toFixed(1).padStart(5)}%  ` +
        `${(price(s) / floor(s)).toFixed(1).padStart(6)}×`,
    );
  }
  console.log();
}

console.log(`=== reflexivity check across c, from $200k-mined state ===`);
console.log(`  c    +1 ETH buy Δprice    +10 ETH buy Δprice`);
for (const c of concentrations) {
  const after = run(200_000, 0, c);
  const after1 = v2Buy(after, 1, c);
  const after10 = v2Buy(after, 10, c);
  const d1 = (spot(after1) / spot(after) - 1) * 100;
  const d10 = (spot(after10) / spot(after) - 1) * 100;
  console.log(
    `  ${c.toString().padStart(2)}   ${d1.toFixed(2).padStart(8)}%${" ".repeat(12)}` +
      `${d10.toFixed(2).padStart(8)}%`,
  );
}

console.log(`\n=== sato comparability — liq/MC ratio across c ===\n`);
console.log(`sato observed: liq/MC ≈ 6.5%\n`);
console.log(`scenario              c=1     c=2     c=5     c=10    c=25`);
for (const [name, mine, redeem] of cases) {
  const ratios = concentrations.map((c) => {
    const s = run(mine, redeem, c);
    return ((liq(s) / mc(s)) * 100).toFixed(1) + "%";
  });
  console.log(`  ${name.padEnd(20)}  ${ratios.map((r) => r.padStart(6)).join("  ")}`);
}
