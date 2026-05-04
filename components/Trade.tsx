"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import { useSatoState } from "@/hooks/useSatoState";
import { useTrade, type Side } from "@/hooks/useTrade";
import { quoteBuy, quoteSell, MAX_BUY_WEI } from "@/lib/curve";

const MAX_BUY_ETH = Number(MAX_BUY_WEI) / 1e18;

export function Trade() {
  const { cumulativeEth, isDemo } = useSatoState();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("0.5");
  const { execute, pending, error, ready, isSuccess } = useTrade();

  const isBuy = side === "buy";

  const quote = useMemo(() => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return null;
    return isBuy ? quoteBuy(cumulativeEth, a) : quoteSell(cumulativeEth, a);
  }, [amount, isBuy, cumulativeEth]);

  const overCap = isBuy && Number(amount) > MAX_BUY_ETH;

  return (
    <section className="panel p-7">
      <header className="flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">Trade</h2>
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
        <label className="flex items-baseline justify-between text-[10px] font-medium uppercase tracking-widest2 text-ash">
          <span>{isBuy ? "ETH In" : "sato In"}</span>
          {isBuy && (
            <span className="text-[10px] text-ash">cap: {MAX_BUY_ETH} Ξ / buy</span>
          )}
        </label>
        <div className="mt-2 flex items-baseline gap-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="tabular w-full bg-transparent font-mono text-[40px] leading-none text-bone outline-none placeholder:text-ash/40"
            placeholder="0.00"
          />
          <span className="font-mono text-sm text-ash">{isBuy ? "Ξ" : "sato"}</span>
        </div>
      </div>

      <div className="hairline my-7" />

      <div className="space-y-3 font-mono text-[13px]">
        <Row
          label="You receive"
          value={quote ? (isBuy ? (quote as ReturnType<typeof quoteBuy>).satoOut : (quote as ReturnType<typeof quoteSell>).ethOut) : 0}
          suffix={isBuy ? "sato" : "Ξ"}
          accent
          big
        />
        <Row label="Effective price" value={quote?.effectivePriceEth ?? 0} suffix="Ξ / sato" muted small />
        <Row label="Fee (0.3%)" value={quote?.fee ?? 0} suffix={isBuy ? "Ξ" : "Ξ"} muted small />
      </div>

      <button
        onClick={() => execute(side, amount).catch(() => {})}
        disabled={!ready || pending || isDemo || overCap || !quote}
        className={clsx(
          "mt-7 w-full rounded-lg px-4 py-3.5 text-[12px] font-medium uppercase tracking-widest transition",
          isDemo
            ? "border border-edge bg-glass text-ash"
            : "border border-accent/40 bg-accent/10 text-accent hover:bg-accent/15 hover:shadow-glow",
          (pending || (!ready && !isDemo) || overCap) && "opacity-50",
        )}
      >
        {isDemo
          ? "Demo · set NEXT_PUBLIC_SATO_HOOK to enable"
          : overCap
          ? `Over 5 Ξ cap`
          : pending
          ? "Pending…"
          : ready
          ? side === "buy"
            ? "Buy"
            : "Sell"
          : "Connect wallet"}
      </button>

      {isSuccess && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-2 text-[11px] text-emerald-400"
        >
          confirmed.
        </motion.div>
      )}
      {error && <div className="mt-2 text-[11px] text-accent2">{error}</div>}

      <p className="mt-5 text-[11px] leading-relaxed text-ash">
        {isBuy
          ? "5 ETH max per buy. The contract takes a 0.3% fee, then mints sato priced by the function."
          : "Selling in the same block as your last buy reverts. The contract pays you ETH from its balance, minus 0.3%."}
      </p>
    </section>
  );
}

function Row({
  label,
  value,
  suffix,
  accent,
  muted,
  big,
  small,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: boolean;
  muted?: boolean;
  big?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">{label}</span>
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
          small && "text-[12px]",
        )}
      >
        {Number.isFinite(value)
          ? value < 1e-4 && value > 0
            ? value.toExponential(3)
            : value.toLocaleString(undefined, { maximumFractionDigits: 6 })
          : "—"}
        {suffix ? ` ${suffix}` : ""}
      </motion.span>
    </div>
  );
}
