"use client";

import { motion } from "framer-motion";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAscendState } from "@/hooks/useAscendState";
import {
  K,
  S,
  BURN_FEE_RATE,
  marginalMintPriceAt,
  livePerTokenBurnAt,
} from "@/lib/floor_v3";
import { useEthPrice } from "@/hooks/useEthPrice";

/// Adaptive: if the live cursor sits past 60% of the default range,
/// stretch the chart so it lands around the 50% mark.
function adaptiveEMax(ethCum: number): number {
  const minEMax = E_MAX_DEFAULT;
  if (ethCum > 0.6 * minEMax) return Math.max(minEMax, ethCum * 2);
  return minEMax;
}

function buildXTicks(eMax: number): number[] {
  const step = eMax / 5;
  return [0, step, 2 * step, 3 * step, 4 * step, eMax];
}

/// Default cumulative-ETH horizon. The curve is asymptotic at K supply;
/// at e ≈ 5·S supply reaches ~99% of K. We plot at least up to 5·S and
/// stretch further if the live cursor would otherwise hug the right
/// edge — keeps the "you are here" marker visible inside the panel.
const E_MAX_DEFAULT = S * 5;
const POINTS = 240;

const COLORS = {
  supply: "#c5ee47",
  supplyDim: "#7fa12c",
  price: "#f6a93f",
  burn: "#f06292",
  bone: "#ededf0",
  ash: "#71717a",
  edge: "#1f1f25",
};

function fmtSupply(n: number, places = 1): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(places) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(places) + "k";
  return n.toFixed(0);
}

function fmtPriceEth(eth: number): string {
  if (!Number.isFinite(eth) || eth <= 0) return "0";
  if (eth < 1e-4) return eth.toExponential(2);
  if (eth < 1) return eth.toFixed(5);
  return eth.toFixed(3);
}

// Burn vs mint differ by exactly 0.7% — at small magnitudes the two
// collide visually unless we keep enough precision to show the gap.
function fmtUsd(eth: number, rate: number): string {
  if (!Number.isFinite(eth) || eth <= 0) return "$0";
  const usd = eth * rate;
  if (usd < 1e-5) return "$" + usd.toExponential(3);
  if (usd < 1e-3) return "$" + usd.toFixed(7);
  if (usd < 0.01) return "$" + usd.toFixed(6);
  if (usd < 1) return "$" + usd.toFixed(4);
  if (usd < 100) return "$" + usd.toFixed(2);
  if (usd < 10_000) return "$" + usd.toFixed(0);
  if (usd < 1e6) return "$" + (usd / 1e3).toFixed(1) + "k";
  return "$" + (usd / 1e6).toFixed(2) + "m";
}

function fmtEth(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function Curve() {
  const state = useAscendState();
  const ethUsd = useEthPrice();

  const E_MAX = adaptiveEMax(state.ethCum);
  const X_TICKS = buildXTicks(E_MAX);

  // Generate the full curve trace.
  const data = Array.from({ length: POINTS + 1 }, (_, i) => {
    const e = (i / POINTS) * E_MAX;
    const supply = K * (1 - Math.exp(-e / S));
    const price = (S / K) * Math.exp(e / S);
    return { e, supply, price };
  });

  // Current state markers.
  const ethCum = state.ethCum;
  const supplyActual = state.supply;
  const supplyFair = state.mintedFair > 0 ? state.mintedFair : K * (1 - Math.exp(-ethCum / S));
  // mintedFair − currentSupply: how much has been burned cumulatively.
  // Not to be confused with on-chain `drift()`, which is the PRBMath
  // rounding gap between the curve formula and stored mintedFair.
  const burned = Math.max(0, supplyFair - supplyActual);
  // Sato-style chart convention: place the "circulating" dot at the
  // cumEth that maps to current supply via the curve formula. Both dots
  // then sit on the curve and the horizontal gap visualizes the burned
  // position in cumEth-equivalent units.
  //     e_eq = −S · ln(1 − supply/K)
  const supplyEquivE =
    supplyActual > 0 && supplyActual < K ? -S * Math.log(1 - supplyActual / K) : 0;

  const priceMint = marginalMintPriceAt(ethCum);
  // Sato monotone floor: (S/(K−mF)) · (mF/supply) · (1−fee). Conceptual
  // long-term anchor — equals per-token average if all supply were
  // liquidated at the frozen mintedFair. Only ever rises.
  const priceFloor =
    supplyFair > 0 && supplyFair < K && supplyActual > 0
      ? (S / (K - supplyFair)) * (supplyFair / supplyActual) * (1 - BURN_FEE_RATE)
      : 0;
  // Live burn payout per ascend: what a small burn RIGHT NOW pays after
  // 1% token fee + 0.7% protocol fee + tier-1 90% block-age penalty.
  const priceLiveBurn = livePerTokenBurnAt(state);

  // Y-axis bounds. Cap price domain so the curve fits visually.
  const priceMaxOnScreen = data[data.length - 1].price;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="panel p-5 md:p-6"
    >
      <header className="mb-4 space-y-2 font-mono text-[11px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            curve
          </span>
          <span className="flex items-center gap-1.5 text-ash">
            <span
              aria-hidden
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: COLORS.supply }}
            />
            supply
          </span>
          <span className="flex items-center gap-1.5 text-ash">
            <span
              aria-hidden
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: COLORS.price }}
            />
            price
          </span>
          <span className="flex items-center gap-1.5 text-ash">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full border-2"
              style={{ borderColor: COLORS.supply }}
            />
            minted
          </span>
          <span className="flex items-center gap-1.5 text-ash">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COLORS.supply }}
            />
            circulating
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="text-ash">
            supply{" "}
            <span style={{ color: COLORS.supply }}>{fmtSupply(supplyActual)}</span>{" "}
            of <span className="text-bone">{fmtSupply(K, 0)}</span>
            {burned > 1 && (
              <>
                {" "}
                <span className="text-ash">
                  (burned <span style={{ color: COLORS.burn }}>{fmtSupply(burned)}</span>)
                </span>
              </>
            )}
          </span>

          <span className="text-ash">
            price <span style={{ color: COLORS.price }}>{fmtUsd(priceMint, ethUsd)}</span>
          </span>

          <span
            className="rounded-md border px-2 py-1"
            style={{ borderColor: COLORS.edge }}
          >
            mint <span style={{ color: COLORS.supply }}>{fmtUsd(priceMint, ethUsd)}</span>
            {" "}/{" "}
            live burn <span style={{ color: COLORS.burn }}>{fmtUsd(priceLiveBurn, ethUsd)}</span>
            {" "}/{" "}
            floor <span className="text-bone/80">{fmtUsd(priceFloor, ethUsd)}</span>
          </span>
        </div>
      </header>

      <div className="h-80 md:h-[26rem] -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 12, left: 0 }}>
            <defs>
              <linearGradient id="supplyArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.supply} stopOpacity={0.32} />
                <stop offset="100%" stopColor={COLORS.supply} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={COLORS.edge} strokeDasharray="2 6" />

            <XAxis
              dataKey="e"
              type="number"
              domain={[0, E_MAX]}
              ticks={X_TICKS}
              tickFormatter={(v) => (v >= E_MAX - 0.01 ? "∞" : fmtEth(v))}
              stroke={COLORS.ash}
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: COLORS.edge }}
              label={{
                value: "cumulative eth",
                position: "insideBottom",
                offset: -2,
                fill: COLORS.ash,
                fontSize: 10,
              }}
            />

            <YAxis
              yAxisId="supply"
              dataKey="supply"
              domain={[0, K]}
              ticks={[0, 5e6, 1e7, 1.5e7, 2e7, K]}
              tickFormatter={(v) => fmtSupply(v, 0)}
              stroke={COLORS.supply}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={40}
            />

            <YAxis
              yAxisId="price"
              orientation="right"
              dataKey="price"
              domain={[0, priceMaxOnScreen]}
              tickFormatter={(v) => (v >= priceMaxOnScreen * 0.99 ? "∞" : fmtUsd(v, ethUsd))}
              stroke={COLORS.price}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={64}
            />

            <Tooltip
              contentStyle={{
                background: "#101013",
                border: `1px solid ${COLORS.edge}`,
                borderRadius: 8,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
              labelStyle={{ color: COLORS.ash }}
              labelFormatter={(v: number) => `cumEth: ${fmtEth(v)} Ξ`}
              formatter={(v: number, name: string) => {
                if (name === "supply") return [fmtSupply(v, 2), "supply"];
                return [`${fmtUsd(v, ethUsd)} (${fmtPriceEth(v)} Ξ)`, "price"];
              }}
            />

            <Area
              yAxisId="supply"
              type="monotone"
              dataKey="supply"
              stroke={COLORS.supply}
              strokeWidth={1.5}
              fill="url(#supplyArea)"
              isAnimationActive={false}
            />

            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              stroke={COLORS.price}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />

            {/* Vertical dashed line at the actual cumEth (where mintedFair sits on the curve). */}
            <ReferenceLine
              x={ethCum}
              stroke={COLORS.ash}
              strokeDasharray="2 4"
              yAxisId="supply"
            />

            {/* Second dashed line at the cumEth-equivalent of currentSupply.
                When burns > rounding gap, this falls left of the main "now" line. */}
            {burned > 1 && supplyEquivE > 0 && (
              <ReferenceLine
                x={supplyEquivE}
                stroke={COLORS.burn}
                strokeOpacity={0.35}
                strokeDasharray="2 4"
                yAxisId="supply"
              />
            )}

            {/* Hollow circle: fair supply at current cumEth (where the curve says we are). */}
            <ReferenceDot
              x={ethCum}
              y={supplyFair}
              yAxisId="supply"
              r={5}
              fill={"#0a0a0c"}
              stroke={COLORS.supply}
              strokeWidth={2}
              isFront
            />

            {/* Filled dot: on-chain currentSupply plotted at its cumEth-equivalent
                so it sits on the curve (Sato convention). Horizontal gap to the
                hollow dot visualizes burned position in cumEth units. */}
            <ReferenceDot
              x={supplyEquivE}
              y={supplyActual}
              yAxisId="supply"
              r={4}
              fill={COLORS.supply}
              stroke="none"
              isFront
            />

            {/* Live burn payout per ascend (tier-1, after all fees + penalty). */}
            <ReferenceDot
              x={ethCum}
              y={priceLiveBurn}
              yAxisId="price"
              r={4}
              fill={COLORS.burn}
              stroke="none"
              isFront
            />

            {/* Mint quote on the price line — current marginal mint cost. */}
            <ReferenceDot
              x={ethCum}
              y={priceMint}
              yAxisId="price"
              r={4}
              fill={COLORS.supply}
              stroke="none"
              isFront
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ash">
        <span className="text-bone">{fmtSupply(K, 0)}</span> pure-math asymptote
        that the curve approaches but never touches. minting continues
        indefinitely; price grows exponentially with cumulative eth.
      </p>
    </motion.section>
  );
}
