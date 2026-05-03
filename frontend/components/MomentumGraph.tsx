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
  const { data, error } = useMultiplierHistory();

  return (
    <section className="rounded-2xl border border-edge bg-panel/80 p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-[0.22em] text-ash">Momentum</h2>
        <span className="text-xs text-ash">{error ? "indexer offline" : `${data.length} pts`}</span>
      </header>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff5b3a" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#ff5b3a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1a1a22" strokeDasharray="2 4" />
            <XAxis dataKey="blockNumber" stroke="#6a6a78" fontSize={10} />
            <YAxis stroke="#6a6a78" fontSize={10} domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{
                background: "#0b0b10",
                border: "1px solid #1a1a22",
                fontSize: 12,
              }}
              labelStyle={{ color: "#6a6a78" }}
            />
            <Area
              type="monotone"
              dataKey="multiplier"
              stroke="#ff5b3a"
              strokeWidth={1.5}
              fill="url(#ember)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
