"use client";

import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAscendState } from "@/hooks/useAscendState";
import { K, S } from "@/lib/floor_v3";

const C = {
  ascend: "#c5ee47",
  bitcoin: "#f6a93f",
  edge: "#1f1f25",
  ash: "#71717a",
};

// Marginal ascend issuance rate (ascend per next ETH at cumulative e).
// dq/de = (K/S) · e^(−e/S)
function issuanceAt(e: number): number {
  return (K / S) * Math.exp(-e / S);
}

function fmtAsc(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return n.toFixed(0);
}

const BTC = [
  { era: "2009", reward: 50 },
  { era: "2012", reward: 25 },
  { era: "2016", reward: 12.5 },
  { era: "2020", reward: 6.25 },
  { era: "2024", reward: 3.125 },
  { era: "2028", reward: 1.5625 },
  { era: "2032", reward: 0.78 },
  { era: "2036", reward: 0.39 },
];

export function Issuance() {
  const state = useAscendState();
  const ethCumNow = state.ethCum;

  // Build ascend issuance bins. 8 bars at multiples of S/2 starting from 0.
  // Matches Sato's halving-style visual where each bar is a discrete window.
  const STEP = S / 2;
  const ASCEND = Array.from({ length: 8 }, (_, i) => {
    const e = i * STEP;
    return {
      bin: e === 0 ? "0" : e.toFixed(2),
      eth: e,
      rate: issuanceAt(e),
    };
  });

  // Find the "now" position to mark with a reference line on ascend chart.
  const nowIdx = Math.min(
    Math.max(0, Math.round(ethCumNow / STEP)),
    ASCEND.length - 1
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="panel mt-6 p-5 md:p-6"
    >
      <header className="mb-2 text-[10px] font-medium uppercase tracking-widest2 text-ash">
        issuance comparison
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Bitcoin issuance */}
        <div>
          <div className="flex items-baseline justify-between text-[11px] font-mono">
            <span className="text-ash">bitcoin issuance</span>
            <span className="text-ash">now: 3.125 btc/block</span>
          </div>

          <div className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={BTC} margin={{ top: 12, right: 8, bottom: 28, left: 8 }}>
                <CartesianGrid stroke={C.edge} strokeDasharray="2 6" />
                <XAxis
                  dataKey="era"
                  stroke={C.ash}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke={C.bitcoin}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "#101013",
                    border: `1px solid ${C.edge}`,
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                  formatter={(v: number) => [`${v} btc/block`, "subsidy"]}
                />
                <Bar dataKey="reward" fill={C.bitcoin} fillOpacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-center text-[11px] text-ash">halving epochs · ~4y each</p>
        </div>

        {/* Ascend issuance */}
        <div>
          <div className="flex items-baseline justify-between text-[11px] font-mono">
            <span className="text-ash">ascend issuance</span>
            <span className="text-ash">
              now: {fmtAsc(issuanceAt(ethCumNow))} ascend/eth
            </span>
          </div>

          <div className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ASCEND} margin={{ top: 12, right: 8, bottom: 28, left: 8 }}>
                <CartesianGrid stroke={C.edge} strokeDasharray="2 6" />
                <XAxis
                  dataKey="bin"
                  stroke={C.ash}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke={C.ascend}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={fmtAsc}
                />
                <Tooltip
                  contentStyle={{
                    background: "#101013",
                    border: `1px solid ${C.edge}`,
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                  labelFormatter={(v) => `cumEth: ${v} Ξ`}
                  formatter={(v: number) => [`${fmtAsc(v)} ascend/eth`, "marginal rate"]}
                />
                <Bar dataKey="rate" fill={C.ascend} fillOpacity={0.7} />
                {/* dashed line at the "now" bin */}
                {nowIdx > 0 && (
                  <ReferenceLine
                    x={ASCEND[nowIdx].bin}
                    stroke={C.ash}
                    strokeDasharray="2 4"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke={C.ascend}
                  strokeWidth={1.5}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-center text-[11px] text-ash">
            cumulative eth (0 to ∞)
          </p>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ash">
        bitcoin issues in discrete halving epochs (50, 25, 12.5 btc per block, every ~4
        years; subsidy reaches zero around 2140). ascend issues continuously: the
        marginal mint rate (ascend per eth) decays smoothly with each eth of inflow and
        never reaches zero. both asymptote at <span className="text-bone">21m</span>,
        neither ever reaches it.
      </p>
    </motion.section>
  );
}
