"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import { priceCurve } from "@/lib/curve";
import { useSatoState } from "@/hooks/useSatoState";

type Mode = "price" | "supply";

const RANGES = [
  { label: "0–500 Ξ", value: 500 },
  { label: "0–2k Ξ", value: 2_000 },
  { label: "0–10k Ξ", value: 10_000 },
];

export function Curve() {
  const { cumulativeEth } = useSatoState();
  const [mode, setMode] = useState<Mode>("price");
  const [range, setRange] = useState(500);

  const data = useMemo(() => priceCurve(range, 240), [range]);
  const here = useMemo(() => {
    const eClamped = Math.min(cumulativeEth, range);
    const sample = data.find((d) => d.e >= eClamped) ?? data[data.length - 1];
    return { ...sample, e: eClamped };
  }, [cumulativeEth, range, data]);

  return (
    <section className="panel mt-6 p-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            {mode === "price" ? "Price function" : "Supply function"}
          </h2>
          <p className="mt-1 text-[11px] text-ash">
            {mode === "price"
              ? "p(E) = (S/K) · e^(E/S)  ·  marginal ETH per sato"
              : "N(E) = K · (1 − e^(−E/S))  ·  total sato issued"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-edge p-0.5 text-[11px]">
            {(["price", "supply"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 uppercase tracking-widest transition ${
                  mode === m ? "bg-bone text-ink" : "text-ash hover:text-bone"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-edge p-0.5 text-[11px]">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-2 py-1 font-mono transition ${
                  range === r.value ? "text-accent" : "text-ash hover:text-bone"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 12 }}>
            <defs>
              <linearGradient id="satoFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f4a261" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#f4a261" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="satoStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#e76f51" />
                <stop offset="100%" stopColor="#f4a261" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f1f25" strokeDasharray="2 6" />
            <XAxis
              dataKey="e"
              stroke="#71717a"
              fontSize={10}
              tickFormatter={(v: number) => `${v.toLocaleString()} Ξ`}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              dataKey={mode}
              stroke="#71717a"
              fontSize={10}
              tickFormatter={(v: number) =>
                mode === "supply"
                  ? v >= 1e6
                    ? `${(v / 1e6).toFixed(1)}M`
                    : v >= 1e3
                    ? `${(v / 1e3).toFixed(0)}k`
                    : v.toFixed(0)
                  : v < 1e-4
                  ? v.toExponential(0)
                  : v.toFixed(5)
              }
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "#101013",
                border: "1px solid #1f1f25",
                borderRadius: 8,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
              labelStyle={{ color: "#71717a" }}
              labelFormatter={(v: number) => `${v.toFixed(1)} Ξ cumulative`}
              formatter={(v: number) => [
                mode === "price"
                  ? v < 1e-4
                    ? `${v.toExponential(4)} Ξ`
                    : `${v.toFixed(8)} Ξ`
                  : `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} sato`,
                mode === "price" ? "price" : "supply",
              ]}
            />
            <Area
              type="monotone"
              dataKey={mode}
              stroke="url(#satoStroke)"
              strokeWidth={1.5}
              fill="url(#satoFill)"
              isAnimationActive
              animationDuration={500}
            />
            <ReferenceDot
              x={here.e}
              y={mode === "price" ? here.price : here.supply}
              r={4}
              fill="#f4a261"
              stroke="#070708"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
