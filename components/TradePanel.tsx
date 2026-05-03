"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatEther } from "viem";
import clsx from "clsx";
import { useAscentState } from "@/hooks/useAscentState";
import { useQuoter } from "@/hooks/useQuoter";
import { useExecuteSwap } from "@/hooks/useExecuteSwap";
import { previewOutput } from "@/lib/math";

type Side = "buy" | "sell";

export function TradePanel() {
  const { F, V, D, C, multiplier, treasury, isDemo } = useAscentState();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("1");
  const isBuy = side === "buy";

  const { quote } = useQuoter({ isBuy, amountIn: amount });
  const { execute, pending, ready, error: execError } = useExecuteSwap();

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
    <section className="panel p-7">
      <header className="flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          Trade
        </h2>
        <div className="flex rounded-md border border-edge p-0.5 text-[11px]">
          {(["buy", "sell"] as Side[]).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={clsx(
                "px-3 py-1 uppercase tracking-widest transition",
                side === s ? "bg-bone text-ink" : "text-ash hover:text-bone",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <div className="mt-7">
        <label className="block text-[10px] font-medium uppercase tracking-widest2 text-ash">
          {isBuy ? "ETH In" : "ASCENT In"}
        </label>
        <div className="mt-2 flex items-baseline gap-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="tabular w-full bg-transparent font-mono text-[40px] leading-none text-bone outline-none placeholder:text-ash/40"
            placeholder="0.00"
          />
          <span className="font-mono text-sm text-ash">{isBuy ? "Ξ" : "ASC"}</span>
        </div>
      </div>

      <div className="hairline my-7" />

      <motion.div layout className="space-y-3 font-mono text-[13px]">
        <Row
          label="You receive"
          value={adjusted}
          suffix={isBuy ? "ASCENT" : "ETH"}
          accent
          big
        />
        <Row label="Demand premium" value={m} prefix="×" muted />
        <Row
          label={isBuy ? "Premium paid" : "Patience bonus"}
          value={charge}
          suffix="Ξ"
          muted
        />

        <AnimatePresence>
          {capped && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] text-accent"
            >
              Treasury depleted — bonus capped at available reserves.
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <button
        onClick={() => execute({ isBuy, amountIn: amount }).catch(() => {})}
        disabled={!ready || pending || isDemo}
        className={clsx(
          "mt-7 w-full rounded-lg px-4 py-3.5 text-[12px] font-medium uppercase tracking-widest transition",
          isDemo
            ? "border border-edge bg-glass text-ash"
            : "border border-accent/40 bg-accent/10 text-accent hover:bg-accent/15 hover:shadow-glow",
          (pending || (!ready && !isDemo)) && "opacity-50",
        )}
      >
        {isDemo
          ? "Demo · Configure addresses to enable"
          : pending
          ? "Executing…"
          : ready
          ? "Execute Swap"
          : "Connect Wallet"}
      </button>
      {execError && <div className="mt-2 text-[11px] text-accent2">{execError}</div>}
    </section>
  );
}

function Row({
  label,
  value,
  prefix,
  suffix,
  accent,
  muted,
  big,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  accent?: boolean;
  muted?: boolean;
  big?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
        {label}
      </span>
      <motion.span
        key={value}
        initial={{ opacity: 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className={clsx(
          "tabular",
          accent && "text-accent",
          muted && "text-bone/80",
          big && "text-[18px]",
        )}
      >
        {prefix ?? ""}
        {Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
        {suffix ? ` ${suffix}` : ""}
      </motion.span>
    </div>
  );
}
