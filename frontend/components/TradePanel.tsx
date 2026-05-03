"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { formatEther } from "viem";
import clsx from "clsx";
import { useAscentState } from "@/hooks/useAscentState";
import { useQuoter } from "@/hooks/useQuoter";
import { useExecuteSwap } from "@/hooks/useExecuteSwap";
import { previewOutput } from "@/lib/math";

type Side = "buy" | "sell";

export function TradePanel() {
  const { F, V, D, C, multiplier, treasury } = useAscentState();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("1");
  const isBuy = side === "buy";

  const { quote, error: quoteError } = useQuoter({ isBuy, amountIn: amount });
  const { execute, pending, ready, error: execError } = useExecuteSwap();

  // Local preview for instant typing feedback; on-chain quoter overrides once it lands.
  const localPreview = useMemo(() => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return null;
    return previewOutput({
      state: { F, V, D, C },
      baseOut: a,
      amountIn: a,
      treasury,
      isBuy,
    });
  }, [amount, isBuy, F, V, D, C, treasury]);

  const m = quote?.multiplier ?? localPreview?.m ?? multiplier;
  const adjusted = quote ? Number(formatEther(quote.adjustedOut)) : localPreview?.adjusted ?? 0;
  const charge = quote ? Number(formatEther(quote.hookCharge)) : localPreview?.hookCharge ?? 0;
  const capped = quote?.treasuryCapped ?? localPreview?.treasuryCapped ?? false;

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
        {isBuy ? "ETH In" : "ASCENT In"}
      </label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        className="mt-1 w-full bg-transparent font-mono text-3xl text-bone outline-none"
        placeholder="0.00"
      />

      <motion.div layout className="mt-6 space-y-3 border-t border-edge pt-4 font-mono text-sm">
        <Row label="Adjusted output" value={adjusted} suffix={isBuy ? "ASCENT" : "ETH"} accent />
        <Row label="Multiplier" value={m} prefix="×" />
        <Row
          label={isBuy ? "Pressure tax" : "Pressure bonus"}
          value={charge}
          suffix="ETH"
          accent={charge > 0}
        />
        {capped && (
          <div className="rounded border border-ember/40 bg-ember/5 px-3 py-2 text-xs text-ember">
            Treasury depleted — bonus capped at available reserves.
          </div>
        )}
        {quoteError && (
          <div className="text-xs text-ash">quoter offline; showing local preview</div>
        )}
      </motion.div>

      <button
        onClick={() => execute({ isBuy, amountIn: amount }).catch(() => {})}
        disabled={!ready || pending}
        className="mt-6 w-full rounded-md border border-ember/60 bg-ember/10 px-4 py-3 text-sm uppercase tracking-[0.22em] text-ember transition hover:bg-ember/20 disabled:opacity-40"
      >
        {pending ? "Executing…" : ready ? "Execute" : "Connect wallet"}
      </button>
      {execError && <div className="mt-2 text-xs text-ember">{execError}</div>}
    </section>
  );
}

function Row({
  label,
  value,
  prefix,
  suffix,
  accent,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs uppercase tracking-[0.18em] text-ash">{label}</span>
      <span className={clsx(accent && "text-ember")}>
        {prefix ?? ""}
        {Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}
