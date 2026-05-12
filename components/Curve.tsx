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
import { useAccount, useBlockNumber, useReadContract } from "wagmi";
import { useAscendState } from "@/hooks/useAscendState";
import {
  K,
  S,
  BURN_FEE_RATE,
  BURN_TOKEN_FEE_RATE,
  PENALTY_MILESTONES,
  PENALTY_CAP_BLOCKS,
  penaltyMultBps,
  marginalMintPriceAt,
  livePerTokenBurnAt,
} from "@/lib/floor_v3";
import { ASCEND_HOOK_V3_ABI } from "@/lib/abi";
import { ASCEND_HOOK_ADDRESS, CHAIN_ID, isConfigured } from "@/lib/config";
import { useEthPrice } from "@/hooks/useEthPrice";
import { useActivity } from "@/hooks/useActivity";
import { EthIcon } from "@/components/EthIcon";

const COLORS = {
  payout: "#c5ee47",   // ascend green — held payout
  flip: "#f06292",     // pink — flipper payout (low)
  mint: "#f6a93f",     // orange — mint cost (ceiling)
  bone: "#ededf0",
  ash: "#71717a",
  edge: "#1f1f25",
  premiumFill: "rgba(197, 238, 71, 0.10)",
  costFill: "rgba(240, 98, 146, 0.08)",
};

/// Pretty USD with the right precision per magnitude.
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

function fmtSupply(n: number, places = 1): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(places) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return n.toFixed(0);
}

/// Format block-age in human time @12s blocks.
function fmtAge(blocks: number): string {
  if (blocks < 1) return "0";
  const sec = blocks * 12;
  if (sec < 60) return `${sec}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(0)}m`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(1)}h`;
  return `${(hr / 24).toFixed(1)}d`;
}

export function Curve() {
  const state = useAscendState();
  const ethUsd = useEthPrice();
  const { address } = useAccount();
  const { burnHistory } = useActivity();

  // Pull the connected wallet's weightedReceiveBlock from the hook —
  // this is the per-holder timestamp the burn penalty actually keys off.
  // Refetched whenever the latest block changes so the dot crawls forward
  // in real time.
  const { data: blockNumberBig } = useBlockNumber({
    chainId: CHAIN_ID,
    watch: true,
  });
  const { data: wrbBig } = useReadContract({
    address: ASCEND_HOOK_ADDRESS as `0x${string}`,
    abi: ASCEND_HOOK_V3_ABI,
    functionName: "weightedReceiveBlock",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: isConfigured && !!address,
      refetchInterval: 12_000,
    },
  });

  // holdAge = currentBlock − wrb. null if wallet not connected, holds
  // nothing tracked, or env not configured.
  const userHoldAge =
    address && wrbBig && blockNumberBig && wrbBig > 0n
      ? Number(blockNumberBig - (wrbBig as bigint))
      : null;

  // Per-ascend marginal payout components, evaluated at current state.
  // We hold supply/mF fixed and walk hold-age across the four tiers to
  // build a step trace. The forward marginal burn (S/(K-mF)) only depends
  // on mF, so it's constant across hold-ages here.
  const mF = state.mintedFair > 0 ? state.mintedFair : K * (1 - Math.exp(-state.ethCum / S));
  const mintPriceEth = marginalMintPriceAt(state.ethCum);
  const liveBurnEth = livePerTokenBurnAt(state); // tier-1, current state

  // Forward marginal burn after the 1% token fee + 0.7% protocol fee,
  // before tier penalty and bonus. This is the tier-4 ceiling per ascend.
  const baseBurnEth =
    mF > 0 && mF < K
      ? (S / (K - mF)) * (1 - BURN_TOKEN_FEE_RATE) * (1 - BURN_FEE_RATE)
      : 0;

  // Build a smooth payout-vs-hold-time trace. The on-chain penalty is
  // piecewise-linear between PENALTY_ANCHORS, so the curve is continuous.
  // Sample densely near transitions for clean rendering on log X-axis.
  const bonusBps = state.bonusBps ?? 0;
  const bonusMult = 1 + bonusBps / 10_000;

  function payoutAt(blocks: number): number {
    return baseBurnEth * (penaltyMultBps(blocks) / 10_000) * bonusMult;
  }

  // Cap X at 500 blocks (~1.7 hr) — past this the curve is within a few
  // bps of the asymptote so cropping there keeps the bend dominant on
  // screen. Linear X (not log) so the exponential character of the decay
  // reads as a properly steep curve instead of compressed S-shape.
  const X_MAX = 500;

  // Sample evenly on a linear scale, densely near 0 where the curve is
  // steepest. Pushing extra points in [0, 50] gives a clean leading slope.
  const blockSamples = (() => {
    const points: number[] = [];
    for (let b = 0; b <= 50; b += 0.5) points.push(b);
    for (let b = 50; b <= X_MAX; b += 4) points.push(b);
    return Array.from(new Set(points)).sort((a, b) => a - b);
  })();

  const data = blockSamples.map((b) => ({
    blocks: b,
    payout: payoutAt(b),
    mint: mintPriceEth,
  }));

  // Domain bounds: extend slightly above mint price (the ceiling).
  const yMax = mintPriceEth * 1.05;
  const yMin = baseBurnEth * 0.85;

  // Current state marker — 0 blocks held = tier-1 (the conservative
  // assumption that matches Trade.tsx's default quote).
  const currentTierPayout = liveBurnEth;

  // Round-trip cost % at each tier (for the mini stat row).
  const flipCostPct =
    mintPriceEth > 0 ? ((mintPriceEth - liveBurnEth) / mintPriceEth) * 100 : 0;
  const heldCostPct =
    mintPriceEth > 0
      ? ((mintPriceEth - baseBurnEth * bonusMult) / mintPriceEth) * 100
      : 0;

  // Supply progress for the inset bar.
  const supplyPct = (state.supply / K) * 100;
  const fairPct = (mF / K) * 100;

  // Combined bonding-curve + burn visualization as a stacked area:
  //   • bottom layer (green) = currentSupply at each cumEth
  //   • top layer (pink)     = burned amount = q(e) − supply
  //   • their sum equals q(e), so the silhouette IS the bonding curve
  //
  // Past `state.ethCum` we project the curve forward assuming no future
  // burns (supply = q, burned = 0) so the green keeps tracing the curve.
  const eMax = S * 5;
  const TRACE_POINTS = 140;

  // Sorted history with the live state appended — gives us a stepwise
  // (ethCum, supply) function we can sample at any e. NO synthetic genesis
  // sentinel — that would falsely report supply = 0 for small e values
  // before our event window starts.
  const sortedHistory = [
    ...burnHistory.map((p) => ({ ethCum: p.ethCum, supply: p.supply })),
    { ethCum: state.ethCum, supply: state.supply },
  ]
    .filter((p) => p.ethCum > 0)
    .sort((a, b) => a.ethCum - b.ethCum);

  // Step lookup: supply at cumEth e = supply of the latest event with
  // ethCum ≤ e. If no event matches (e is before our event window OR we
  // have no events at all), fall back to q(e) — i.e. assume no burns.
  // This means the pink "burned" slice only renders where we have actual
  // event evidence of burns.
  function supplyAt(e: number): number {
    const qE = K * (1 - Math.exp(-e / S));
    if (e >= state.ethCum) return qE;
    let s = -1;
    for (const p of sortedHistory) {
      if (p.ethCum > e) break;
      s = p.supply;
    }
    return s < 0 ? qE : s;
  }

  const curveTrace: Array<{ e: number; supply: number; burned: number }> = [];
  // Smooth analytical sampling.
  for (let i = 0; i <= TRACE_POINTS; i++) {
    const e = (i / TRACE_POINTS) * eMax;
    const q = K * (1 - Math.exp(-e / S));
    const supply = supplyAt(e);
    curveTrace.push({ e, supply, burned: Math.max(0, q - supply) });
  }
  // Inject exact event points for crisp vertical "burn drops" — same
  // ethCum repeated with the post-burn supply value.
  for (const p of sortedHistory) {
    if (p.ethCum <= 0 || p.ethCum > eMax) continue;
    const q = K * (1 - Math.exp(-p.ethCum / S));
    curveTrace.push({ e: p.ethCum, supply: p.supply, burned: Math.max(0, q - p.supply) });
  }
  curveTrace.sort((a, b) => a.e - b.e);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="panel p-5 md:p-6"
    >
      <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col">
      <header className="mb-4 space-y-2 font-mono text-[11px]">
        <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          payout vs hold-time
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-3">
            <span className="text-ash">
              mint <span style={{ color: COLORS.mint }}>{fmtUsd(mintPriceEth, ethUsd)}</span>
            </span>
            <span className="text-ash">
              now <span style={{ color: COLORS.flip }}>{fmtUsd(currentTierPayout, ethUsd)}</span>
            </span>
            <span className="text-ash">
              held <span style={{ color: COLORS.payout }}>{fmtUsd(baseBurnEth * bonusMult, ethUsd)}</span>
            </span>
          </div>
          <div className="flex items-baseline gap-3 text-ash">
            {userHoldAge !== null && (
              <span>
                you{" "}
                <span style={{ color: COLORS.payout }}>
                  {userHoldAge.toLocaleString()}b
                </span>{" "}
                <span className="text-ash/70">
                  ({(penaltyMultBps(userHoldAge) / 100).toFixed(2)}%)
                </span>
              </span>
            )}
            <span>
              flip cost <span className="text-bone">{flipCostPct.toFixed(2)}%</span>
            </span>
            <span>
              held cost <span className="text-bone">{heldCostPct.toFixed(2)}%</span>
            </span>
          </div>
        </div>
      </header>

      <div className="h-72 md:h-[22rem] -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 16, bottom: 30, left: 8 }}>
            <defs>
              <linearGradient id="payoutFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.payout} stopOpacity={0.20} />
                <stop offset="100%" stopColor={COLORS.payout} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={COLORS.edge} strokeDasharray="2 6" />

            <XAxis
              dataKey="blocks"
              type="number"
              domain={[0, X_MAX]}
              ticks={[0, 100, 200, 300, 400, X_MAX]}
              tickFormatter={(v) => (v === 0 ? "0" : `${Math.round(v)}b · ${fmtAge(v)}`)}
              stroke={COLORS.ash}
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: COLORS.edge }}
              label={{
                value: "blocks since last receive  ·  longer hold = better payout",
                position: "insideBottom",
                offset: -8,
                fill: COLORS.ash,
                fontSize: 10,
              }}
            />

            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={(v) => fmtUsd(v, ethUsd)}
              stroke={COLORS.ash}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={70}
            />

            <Tooltip
              contentStyle={{
                background: "#101013",
                border: `1px solid ${COLORS.edge}`,
                borderRadius: 8,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
              labelFormatter={(v: number) => `held ${v} blk · ${fmtAge(v)}`}
              formatter={(v: number, name: string) => {
                if (name === "payout") return [fmtUsd(v, ethUsd), "burn payout"];
                if (name === "mint") return [fmtUsd(v, ethUsd), "mint price"];
                return [fmtUsd(v, ethUsd), name];
              }}
            />

            {/* Mint price ceiling — what you paid to enter. */}
            <Line
              type="monotone"
              dataKey="mint"
              stroke={COLORS.mint}
              strokeWidth={1.25}
              strokeDasharray="3 4"
              dot={false}
              isAnimationActive={false}
            />

            {/* Smooth piecewise-linear burn payout vs hold-age. */}
            <Area
              type="monotone"
              dataKey="payout"
              stroke={COLORS.payout}
              strokeWidth={1.5}
              fill="url(#payoutFill)"
              isAnimationActive={false}
            />

            {/* Decay milestones — where the smooth curve crosses 95% / 99%. */}
            {PENALTY_MILESTONES.filter((m) => m.blocks <= X_MAX).map((m, i) => (
              <ReferenceLine
                key={i}
                x={m.blocks}
                stroke={COLORS.ash}
                strokeOpacity={0.35}
                strokeDasharray="2 4"
                label={{
                  value: `${(m.payoutBps / 100).toFixed(0)}%`,
                  position: "top",
                  fill: COLORS.ash,
                  fontSize: 9,
                }}
              />
            ))}

            {/* Default "fresh wallet" dot at block 0 (max penalty). Only
                rendered when no wallet is connected — once connected, the
                green "you" dot below makes this baseline marker redundant. */}
            {userHoldAge === null && (
              <ReferenceDot
                x={0}
                y={currentTierPayout}
                r={4}
                fill={COLORS.flip}
                stroke="none"
                isFront
              />
            )}

            {/* Connected wallet's actual hold-age — pulled from the hook's
                weightedReceiveBlock. Plotted as a ringed accent dot so it
                visually reads as "you are here". */}
            {userHoldAge !== null && (
              <>
                <ReferenceLine
                  x={Math.min(userHoldAge, X_MAX)}
                  stroke={COLORS.payout}
                  strokeOpacity={0.55}
                  strokeDasharray="3 3"
                />
                <ReferenceDot
                  x={Math.min(userHoldAge, X_MAX)}
                  y={
                    baseBurnEth *
                    (penaltyMultBps(userHoldAge) / 10_000) *
                    bonusMult
                  }
                  r={6}
                  fill={COLORS.payout}
                  stroke={COLORS.bone}
                  strokeWidth={2}
                  isFront
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      </div>{/* end of left column */}

      {/* Bonding-curve thumbnail — sits in the right column of the same
          row as the patience chart on lg+. Stacks below on smaller screens. */}
      <div className="flex flex-col">
        <header className="mb-4 space-y-2 font-mono text-[11px]">
          <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            curve & burns
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-3">
              <span className="text-ash">
                mF{" "}
                <span style={{ color: COLORS.payout }}>{fmtSupply(mF, 2)}</span>
              </span>
              <span className="text-ash">
                circ{" "}
                <span style={{ color: COLORS.payout }}>
                  {fmtSupply(state.supply, 2)}
                </span>
              </span>
              <span className="text-ash">
                burned{" "}
                <span style={{ color: COLORS.flip }}>
                  {fmtSupply(Math.max(0, mF - state.supply), 2)}
                </span>
              </span>
            </div>
            <div className="flex items-baseline gap-3 text-ash">
              <span>
                cumEth{" "}
                <span className="text-bone">{state.ethCum.toFixed(3)} <EthIcon size={10} /></span>
              </span>
              <span>
                progress{" "}
                <span className="text-bone">
                  {((state.supply / K) * 100).toFixed(2)}%
                </span>
              </span>
              <span>
                of <span className="text-bone">{fmtSupply(K, 0)}</span>
              </span>
            </div>
          </div>
        </header>
        <div className="h-72 md:h-[22rem] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={curveTrace}
              margin={{ top: 18, right: 16, bottom: 30, left: 8 }}
            >
              <defs>
                <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.payout} stopOpacity={0.20} />
                  <stop offset="100%" stopColor={COLORS.payout} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={COLORS.edge} strokeDasharray="2 6" />
              <XAxis
                dataKey="e"
                type="number"
                domain={[0, S * 5]}
                ticks={[0, S, 2 * S, 3 * S, 4 * S, 5 * S]}
                tickFormatter={(v) => (v === 0 ? "0" : `${v.toFixed(2)} Ξ`)}
                stroke={COLORS.ash}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: COLORS.edge }}
                label={{
                  value: "cumulative eth  ·  curve advances on every mint",
                  position: "insideBottom",
                  offset: -8,
                  fill: COLORS.ash,
                  fontSize: 10,
                }}
              />
              <YAxis
                type="number"
                domain={[0, K]}
                ticks={[0, K * 0.25, K * 0.5, K * 0.75, K]}
                tickFormatter={(v) => fmtSupply(v, 0)}
                stroke={COLORS.ash}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  background: "#101013",
                  border: `1px solid ${COLORS.edge}`,
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                labelFormatter={(v: number) => `cumEth ${v.toFixed(3)} Ξ`}
                formatter={(v: number, name: string) => {
                  if (name === "supply") return [fmtSupply(v, 2), "circulating"];
                  if (name === "burned") return [fmtSupply(v, 2), "burned"];
                  return [fmtSupply(v, 2), name];
                }}
              />
              {/* Render order matters here. The "burned" area is stacked
                  above "supply", so its top edge is q(e) (the curve top)
                  and its stroke is pink. The "supply" area's top edge is
                  the circulating supply line and its stroke is green.
                  In no-burn regions the two strokes coincide at q(e);
                  drawing supply AFTER burned makes the green stroke win
                  there, so the silhouette stays green wherever burns
                  haven't happened. In burn regions both strokes are
                  visible — pink at the curve top, green at the supply
                  boundary, with the pink fill between them. */}
              <Area
                type="monotone"
                dataKey="burned"
                stackId="curve"
                stroke={COLORS.flip}
                strokeWidth={1.5}
                fill={COLORS.flip}
                fillOpacity={0.35}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="supply"
                stackId="curve"
                stroke={COLORS.payout}
                strokeWidth={1.5}
                fill="url(#curveFill)"
                isAnimationActive={false}
              />
              {/* "You are here" cumEth marker — vertical dashed line.
                  The bone-ringed dot sits on the green supply line at
                  y=currentSupply, so it's centered on the line. The pink
                  curve top sits above it; the gap between them = burns. */}
              <ReferenceLine
                x={Math.min(state.ethCum, S * 5)}
                stroke={COLORS.ash}
                strokeOpacity={0.55}
                strokeDasharray="3 3"
              />
              {(() => {
                if (state.ethCum <= 0) return null;
                // Always plot the dot on the analytical curve top so it
                // sits exactly on the rendered q(e) silhouette, regardless
                // of any historical burn dip at the current cumEth.
                const xClamped = Math.min(state.ethCum, S * 5);
                const yOnCurve = K * (1 - Math.exp(-xClamped / S));
                return (
                  <ReferenceDot
                    x={xClamped}
                    y={yOnCurve}
                    r={6}
                    fill={COLORS.payout}
                    stroke={COLORS.bone}
                    strokeWidth={2}
                    isFront
                  />
                );
              })()}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>{/* end of grid */}

      {/* Supply progress strip — full width below the chart row. */}
      <div className="mt-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between font-mono text-[10px] text-ash">
            <span className="uppercase tracking-widest2">supply progress</span>
            <span className="text-bone">{supplyPct.toFixed(2)}%</span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-sm bg-edge">
            {/* Minted (mintedFair) — dimmer. */}
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${Math.min(100, fairPct)}%`,
                background: COLORS.flip,
                opacity: 0.25,
              }}
            />
            {/* Currently circulating — bright. */}
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${Math.min(100, supplyPct)}%`,
                background: COLORS.payout,
              }}
            />
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-ash">
            circulating <span style={{ color: COLORS.payout }}>{fmtSupply(state.supply, 2)}</span>
            {fairPct - supplyPct > 0.1 && (
              <>
                {" "}· minted{" "}
                <span style={{ color: COLORS.flip }}>{fmtSupply(mF, 2)}</span>
                {" "}· burned{" "}
                <span className="text-bone">{fmtSupply(mF - state.supply, 2)}</span>
              </>
            )}
            {" "}of <span className="text-bone">{fmtSupply(K, 0)}</span>
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ash">
        the green curve is your burn payout per ascend — smooth exponential
        decay, no cliffs. flippers at 0 blocks lose{" "}
        <span style={{ color: COLORS.flip }}>10%</span> to the penalty;
        every additional block recovers part of that loss continuously,
        crossing 95% at ~69 blocks (~14 min) and ~99.93% by 500 blocks (~1.7 hrs).
        the dashed orange ceiling is what you paid to mint; the gap below it
        is the round-trip cost the protocol structurally extracts and
        recycles into the surplus reserve.
      </p>
    </motion.section>
  );
}
