"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { simulateFloor } from "@/lib/floor";
import { useAscendState } from "@/hooks/useAscendState";

const SCENARIOS = [
  { label: "Light volume", buy: 0.1, sells: 0.5 },
  { label: "Medium volume", buy: 1, sells: 0.5 },
  { label: "Heavy volume", buy: 5, sells: 0.5 },
];

export function Projection() {
  const state = useAscendState();
  const [scenario, setScenario] = useState(0);
  const cfg = SCENARIOS[scenario];

  const data = simulateFloor(
    { reserveEth: state.reserveEth, supply: state.supply },
    100,
    cfg.buy,
    cfg.sells,
  );

  return (
    <section className="panel mt-6 p-6">
      <header className="mb-5 flex items-baseline justify-between">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Projection
          </h2>
          <p className="mt-1 text-[11px] text-ash">
            simulated floor over 100 alternating trades — illustration, not a price prediction.
          </p>
        </div>
        <div className="flex rounded-md border border-edge p-0.5 text-[11px]">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setScenario(i)}
              className={`px-3 py-1 uppercase tracking-widest transition ${
                scenario === i ? "bg-bone text-ink" : "text-ash hover:text-bone"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 12 }}>
            <defs>
              <linearGradient id="ascendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f4a261" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#f4a261" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ascendStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#e76f51" />
                <stop offset="100%" stopColor="#f4a261" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f1f25" strokeDasharray="2 6" />
            <XAxis
              dataKey="step"
              stroke="#71717a"
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#71717a"
              fontSize={10}
              tickFormatter={(v: number) => (v < 1e-4 ? v.toExponential(0) : v.toFixed(5))}
              tickLine={false}
              axisLine={false}
              width={56}
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
              formatter={(v: number) => [
                v < 1e-4 ? `${v.toExponential(4)} Ξ` : `${v.toFixed(8)} Ξ`,
                "floor",
              ]}
            />
            <Area
              type="monotone"
              dataKey="floor"
              stroke="url(#ascendStroke)"
              strokeWidth={1.5}
              fill="url(#ascendFill)"
              isAnimationActive
              animationDuration={500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
