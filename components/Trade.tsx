"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import { parseEther } from "viem";
import { useAscendState } from "@/hooks/useAscendState";
import { useTrade, type Side } from "@/hooks/useTrade";
import { quoteBuy, quoteSell } from "@/lib/floor";

export function Trade() {
  const state = useAscendState();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("0.1");
  const { execute, approve, pending, error, ready, isSuccess, allowance, wrongChain } = useTrade();

  const isBuy = side === "buy";
  const amountWei = (() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  })();
  const needsApproval = !isBuy && amountWei > 0n && allowance < amountWei;

  const quote = useMemo(() => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return null;
    if (isBuy) {
      const q = quoteBuy(state, a);
      return q
        ? {
            received: q.ascendOut,
            fee: q.fee,
            floorAfter: q.floorAfter,
            priceAfter: q.priceAfter,
          }
        : null;
    }
    const q = quoteSell(state, a);
    return q
      ? {
          received: q.ethOut,
          fee: q.fee,
          floorAfter: q.floorAfter,
          priceAfter: q.priceAfter,
        }
      : null;
  }, [amount, isBuy, state]);

  return (
    <section className="panel p-5 md:p-7">
      <header className="flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          Issuance
        </h2>
        <div className="flex rounded-md border border-edge p-0.5 text-[11px]">
          {([
            { key: "buy" as Side, label: "mine" },
            { key: "sell" as Side, label: "redeem" },
          ]).map((s) => (
            <button
              key={s.key}
              onClick={() => setSide(s.key)}
              className={clsx(
                "px-3 py-1 uppercase tracking-widest transition",
                side === s.key ? "bg-bone text-ink" : "text-ash hover:text-bone",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mt-7">
        <label className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          {isBuy ? "ETH to mine with" : "ascend to redeem"}
        </label>
        <div className="mt-2 flex items-baseline gap-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="tabular w-full bg-transparent font-mono text-[32px] leading-none text-bone outline-none placeholder:text-ash/40 md:text-[40px]"
            placeholder="0.00"
          />
          <span className="font-mono text-sm text-ash">{isBuy ? "Ξ" : "ascend"}</span>
        </div>
      </div>

      <div className="hairline my-7" />

      <div className="space-y-3 font-mono text-[13px]">
        <Row
          label="You receive"
          value={quote?.received ?? 0}
          suffix={isBuy ? "ascend" : "Ξ"}
          accent
          big
        />
        <Row
          label={isBuy ? "Trading price" : "Floor"}
          value={isBuy ? state.priceEth : state.floorEth}
          suffix="Ξ / ascend"
          muted
          small
        />
        <Row
          label={isBuy ? "Buy fee (1% + ~$2)" : "Sell fee (1%)"}
          value={quote?.fee ?? 0}
          suffix="Ξ"
          muted
          small
        />
        <Row
          label="Floor after"
          value={quote?.floorAfter ?? state.floorEth}
          suffix="Ξ / ascend"
          muted
          small
        />
      </div>

      <button
        onClick={() => {
          if (needsApproval) approve(amount).catch(() => {});
          else execute(side, amount).catch(() => {});
        }}
        disabled={!ready || pending || state.isDemo || !quote}
        className={clsx(
          "mt-7 w-full rounded-lg px-4 py-3.5 text-[12px] font-medium uppercase tracking-widest transition",
          state.isDemo
            ? "border border-edge bg-glass text-ash"
            : "border border-accent/40 bg-accent/10 text-accent hover:bg-accent/15 hover:shadow-glow",
          (pending || (!ready && !state.isDemo)) && "opacity-50",
        )}
      >
        {state.isDemo
          ? "Demo · configure addresses to enable"
          : pending
          ? "Pending…"
          : wrongChain
          ? "Switch wallet to Sepolia"
          : !ready
          ? "Connect wallet"
          : needsApproval
          ? "Approve ascend → router"
          : side === "buy"
          ? "Mine ascend"
          : "Redeem ascend"}
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
      {error && <div className="mt-2 text-[11px] text-accent2 break-words">{error}</div>}

      <p className="mt-5 text-[11px] leading-relaxed text-ash">
        {isBuy
          ? "you swap ETH for ascend on the V4 pool. 1% base fee + a flat ~$2 surcharge per buy. 70% of the fee deepens the LP (raises the floor for every holder); 30% funds the tile-flip pool. same curve, same price, both sides — no spread, no special routing."
          : "you swap ascend for ETH on the same V4 pool. flat 1% fee, no surcharge. 70% deepens the LP, 30% funds the tile pool. selling lifts the floor too — the fee compounds in either direction."}
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
