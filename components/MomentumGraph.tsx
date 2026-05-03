"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMultiplierHistory } from "@/hooks/useMultiplierHistory";

export function MomentumGraph() {
  const { data, error, isDemo } = useMultiplierHistory();

  return (
    <section className="panel p-6">
      <header className="mb-5 flex items-baseline justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          Momentum
        </h2>
        <span className="text-[11px] text-ash">
          {error ? "indexer offline" : isDemo ? `${data.length} simulated` : `${data.length} pts`}
        </span>
      </header>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f4a261" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#f4a261" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#e76f51" />
                <stop offset="100%" stopColor="#f4a261" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f1f25" strokeDasharray="2 6" />
            <XAxis
              dataKey="blockNumber"
              stroke="#71717a"
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#71717a"
              fontSize={10}
              domain={[0, "auto"]}
              tickLine={false}
              axisLine={false}
              width={28}
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
              formatter={(v: number) => [v.toFixed(3), "m"]}
            />
            <Area
              type="monotone"
              dataKey="multiplier"
              stroke="url(#lineStroke)"
              strokeWidth={1.5}
              fill="url(#areaFill)"
              isAnimationActive
              animationDuration={600}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
