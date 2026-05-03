"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useAscentState } from "@/hooks/useAscentState";
import { previewOutput } from "@/lib/math";
import clsx from "clsx";

type Side = "buy" | "sell";

export function TradePanel() {
  const { F, D, C, multiplier } = useAscentState();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("1");

  const preview = useMemo(() => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return null;
    // Naive baseOut placeholder: the real curve quote comes from the v4 quoter.
    // This panel demonstrates the *hook adjustment*, not the AMM math itself.
    const baseOut = a;
    return previewOutput({
      state: { F, D, C },
      baseOut,
      isBuy: side === "buy",
    });
  }, [amount, side, F, D, C]);

  return (
    <section className="rounded-2xl border border-edge bg-panel/80 p-6">
      <header className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.22em] text-ash">Trade</h2>
        <div className="flex rounded-md border border-edge p-0.5 text-xs">
          {(["buy", "sell"] as Side[]).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={clsx(
                "px-3 py-1 uppercase tracking-widest transition",
                side === s ? "bg-ember text-ink" : "text-ash hover:text-bone",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <label className="mt-6 block text-[11px] uppercase tracking-[0.18em] text-ash">
        {side === "buy" ? "ETH In" : "ASCENT In"}
      </label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        className="mt-1 w-full bg-transparent font-mono text-3xl text-bone outline-none"
        placeholder="0.00"
      />

      <motion.div
        layout
        className="mt-6 space-y-3 border-t border-edge pt-4 font-mono text-sm"
      >
        <Row label="Base output" value={preview ? preview.adjusted * preview.m : 0} suffix={side === "buy" ? "ASCENT" : "ETH"} dim />
        <Row
          label="Adjusted output"
          value={preview?.adjusted ?? 0}
          suffix={side === "buy" ? "ASCENT" : "ETH"}
          accent
        />
        <Row label="Multiplier" value={multiplier} prefix="×" />
        <Row
          label={side === "buy" ? "Pressure penalty" : "Pressure bonus"}
          value={preview ? Math.abs(preview.penaltyBps) / 100 : 0}
          suffix="%"
          accent
        />
      </motion.div>

      <button
        disabled
        title="Wire to v4 router after deployment"
        className="mt-6 w-full rounded-md border border-ember/60 bg-ember/10 px-4 py-3 text-sm uppercase tracking-[0.22em] text-ember disabled:opacity-50"
      >
        Execute
      </button>
    </section>
  );
}

function Row({
  label,
  value,
  prefix,
  suffix,
  dim,
  accent,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  dim?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs uppercase tracking-[0.18em] text-ash">{label}</span>
      <span className={clsx(dim && "text-ash", accent && "text-ember")}>
        {prefix ?? ""}
        {Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}
