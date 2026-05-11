"use client";

import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { useMemo } from "react";
import { useTilesState } from "@/hooks/useTiles";
import { useEthPrice } from "@/hooks/useEthPrice";
import { fmtUsd, fmtEthShort } from "@/lib/fmtUsd";

/// Multiplier distribution locked in TileEngine._drawMultiplier:
///   r mod 16:
///     0..9   → 1×  (10/16 = 62.50%)
///     A..C   → 2×  ( 3/16 = 18.75%)
///     D..E   → 3×  ( 2/16 = 12.50%)
///     F      → 4×  ( 1/16 =  6.25%)
/// E[mult] = 0.625·1 + 0.1875·2 + 0.125·3 + 0.0625·4 = 1.625
const TIER_DISTRIBUTION = [
  { mult: 1, probability: 0.625,  expectedTiles: 90, color: "#5d6678" },
  { mult: 2, probability: 0.1875, expectedTiles: 27, color: "#9caf3e" },
  { mult: 3, probability: 0.125,  expectedTiles: 18, color: "#c5ee47" },
  { mult: 4, probability: 0.0625, expectedTiles:  9, color: "#f6a93f" },
] as const;

const TOTAL_TILES = 144;
const EXPECTED_MULTIPLIER = 1.625;

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

export function RewardChart() {
  const tiles = useTilesState();
  const ethUsd = useEthPrice();

  // Live counts of claimed multipliers this epoch.
  const claimedByMult = useMemo(() => {
    const counts = [0, 0, 0, 0];
    for (const t of tiles.tiles) {
      if (t.claimer && t.multiplier >= 1 && t.multiplier <= 4) {
        counts[t.multiplier - 1]++;
      }
    }
    return counts;
  }, [tiles.tiles]);

  const totalClaimed = claimedByMult.reduce((a, b) => a + b, 0);

  // Build chart data: each tier gets a "potential" (expected) bar and
  // an "actual" (claimed-so-far this epoch) bar, plus the USD reward
  // a claim at that multiplier yields.
  const data = TIER_DISTRIBUTION.map((tier, i) => ({
    name: `×${tier.mult}`,
    expected: tier.expectedTiles,
    actual: claimedByMult[i],
    rewardEth: tiles.baseRewardEth * tier.mult,
    probability: tier.probability,
    color: tier.color,
  }));

  const expectedReward = tiles.baseRewardEth * EXPECTED_MULTIPLIER;
  const maxReward = tiles.baseRewardEth * 4;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="panel mt-6 p-5 md:p-6"
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 font-mono text-[11px]">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            tile reward distribution
          </span>
          <span className="text-ash">
            pool <span className="text-bone">{fmtUsd(tiles.poolEth, ethUsd)}</span>
          </span>
          <span className="text-ash">
            base <span className="text-bone">{fmtUsd(tiles.baseRewardEth, ethUsd)}</span>
          </span>
        </div>
        <div className="flex items-baseline gap-3 text-ash">
          <span>
            E[reward]{" "}
            <span className="text-accent">{fmtUsd(expectedReward, ethUsd)}</span>{" "}
            <span className="text-ash/60">(1.625×)</span>
          </span>
          <span>
            max <span className="text-bone">{fmtUsd(maxReward, ethUsd)}</span>
          </span>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        {/* Left: bar chart of multiplier distribution + actual claimed. */}
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 8, bottom: 22, left: 8 }}>
              <CartesianGrid stroke="#1f1f25" strokeDasharray="2 6" />
              <XAxis
                dataKey="name"
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                label={{
                  value: "multiplier  ·  height = tiles per epoch",
                  position: "insideBottom",
                  offset: -4,
                  fill: "#71717a",
                  fontSize: 10,
                }}
              />
              <YAxis
                stroke="#71717a"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={32}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
              />
              <Tooltip
                contentStyle={{
                  background: "#101013",
                  border: "1px solid #1f1f25",
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                formatter={(v: number, name: string, item) => {
                  if (name === "expected")
                    return [`${v} tiles (${fmtPct((item.payload as { probability: number }).probability)})`, "expected/epoch"];
                  if (name === "actual") return [`${v} tiles`, "claimed so far"];
                  return [v, name];
                }}
                labelFormatter={(v: string, payload) => {
                  if (!payload || !payload[0]) return v;
                  const p = payload[0].payload as { rewardEth: number };
                  return `${v} · ${fmtUsd(p.rewardEth, ethUsd)} per claim`;
                }}
              />
              {/* Expected (translucent) — what the distribution implies. */}
              <Bar dataKey="expected" radius={[2, 2, 0, 0]} fillOpacity={0.25}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
              {/* Actual claimed so far this epoch (solid). */}
              <Bar dataKey="actual" radius={[2, 2, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Right: per-tier breakdown card. */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            payout by tier
          </div>
          {TIER_DISTRIBUTION.map((tier, i) => (
            <div
              key={tier.mult}
              className="flex items-baseline justify-between gap-3 border-b border-edge/60 py-1.5 last:border-0"
            >
              <span className="flex items-center gap-2 font-mono text-[11px] text-ash">
                <span
                  aria-hidden
                  className="inline-block h-2 w-3 rounded-sm"
                  style={{ background: tier.color }}
                />
                <span className="text-bone">×{tier.mult}</span>
                <span className="text-ash/70">{fmtPct(tier.probability)}</span>
              </span>
              <span className="text-right font-mono text-[11px] tabular text-bone">
                {fmtUsd(tiles.baseRewardEth * tier.mult, ethUsd)}
                <div className="text-[9px] text-ash/70">
                  {fmtEthShort(tiles.baseRewardEth * tier.mult)}
                </div>
              </span>
            </div>
          ))}
          <div className="mt-3 rounded-md border border-edge bg-edge/40 p-2 font-mono text-[10px] text-ash">
            <div className="flex justify-between">
              <span>claimed</span>
              <span className="text-bone">{totalClaimed} / {TOTAL_TILES}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>selection rate</span>
              <span className="text-bone">68% per holder/epoch</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>routed via</span>
              <span className="text-bone">curve buyback</span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ash">
        every fee feeds this pool (0.2% tile share). each epoch the pool
        funds <span className="text-bone">144</span> claimable tiles with a
        locked multiplier distribution. expected payout per claim is{" "}
        <span className="text-bone">1.625×</span> the base — but the pool is
        sized so the protocol always pays out exactly the pool, not more.
        rewards are <span className="text-bone">not paid in ETH</span> —
        they're auto-routed back through the curve as a fresh mint that
        lifts the price for everyone, then issued to the claimer as ascend.
      </p>
    </motion.section>
  );
}
