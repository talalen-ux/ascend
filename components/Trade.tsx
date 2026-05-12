"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import { parseEther } from "viem";
import { useAscendState } from "@/hooks/useAscendState";
import { useTrade, type Side } from "@/hooks/useTrade";
import { useEthPrice } from "@/hooks/useEthPrice";
import { quoteBuy, quoteSell } from "@/lib/floor";
import { MAX_MINT_PER_TX } from "@/lib/floor_v3";
import { fmtUsd, fmtEthShort } from "@/lib/fmtUsd";
import { EthIcon } from "@/components/EthIcon";

export function Trade() {
  const state = useAscendState();
  const ethUsd = useEthPrice();
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
            surplusTake: q.surplusTake,
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
          tokenBurnFee: q.tokenBurnFee,
          penalty: q.penalty,
          bonus: q.bonus,
          payoutMultBps: q.payoutMultBps,
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
          <span className="font-mono text-sm text-ash">
            {isBuy ? <EthIcon size={14} /> : "ascend"}
          </span>
        </div>
        {/* Anti-vacuum cap warning. The contract reverts above MAX_MINT_PER_TX
            so we surface the limit instead of silently quoting zero. */}
        {isBuy && Number(amount) > MAX_MINT_PER_TX && (
          <div className="mt-2 flex items-baseline gap-2 text-[11px] text-accent2">
            <span>⚠</span>
            <span>
              max <span className="font-mono">{MAX_MINT_PER_TX} <EthIcon size={10} /></span> per mint
              <span className="text-ash"> · split across multiple txs to mint more</span>
            </span>
          </div>
        )}
      </div>

      <div className="hairline my-7" />

      <div className="space-y-3 font-mono text-[13px]">
        {/* Sell side renders the ETH "you receive" in USD-primary. Buy side
            keeps the ascend token count as-is. */}
        {isBuy ? (
          <Row
            label="You receive"
            value={quote?.received ?? 0}
            suffix="ascend"
            accent
            big
          />
        ) : (
          <Row
            label="You receive"
            value={quote?.received ?? 0}
            accent
            big
            usd
            rate={ethUsd}
          />
        )}
        <Row
          label={isBuy ? "Trading price" : "Floor"}
          value={isBuy ? state.priceEth : state.floorEth}
          suffix="/ ascend"
          muted
          small
          usd
          rate={ethUsd}
        />
        <Row
          label={isBuy ? "Mint fee (0.7%)" : "Burn fee (0.7%)"}
          value={quote?.fee ?? 0}
          muted
          small
          usd
          rate={ethUsd}
        />
        {isBuy && (
          <Row
            label="Surplus take (3% post-fee)"
            value={isBuy ? (quote && "surplusTake" in quote ? quote.surplusTake ?? 0 : 0) : 0}
            suffix="→ reserve"
            muted
            small
            usd
            rate={ethUsd}
          />
        )}
        {!isBuy && (
          <>
            <Row
              label="Token burn fee (1%)"
              value={
                quote && "tokenBurnFee" in quote
                  ? quote.tokenBurnFee ?? 0
                  : Number(amount || "0") * 0.01
              }
              suffix="ascend"
              muted
              small
            />
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-ash">Block-age penalty</span>
              <span className="text-bone">
                {(() => {
                  const m = quote && "payoutMultBps" in quote ? quote.payoutMultBps : undefined;
                  const pct = m !== undefined ? (m / 100).toFixed(2) : "90";
                  const pen = m !== undefined ? ((10000 - m) / 100).toFixed(2) : "10";
                  return (
                    <>
                      {pct}% payout, {pen}% penalty{" "}
                      <span className="text-ash">— smooth ramp 0→500 blk</span>
                    </>
                  );
                })()}
              </span>
            </div>
            {state.bonusBps > 0 && (
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-ash">Reserve-aware bonus</span>
                <span className="text-accent">+{(state.bonusBps / 100).toFixed(2)}%</span>
              </div>
            )}
          </>
        )}
        <Row
          label="Floor after"
          value={quote?.floorAfter ?? state.floorEth}
          suffix="/ ascend"
          muted
          small
          usd
          rate={ethUsd}
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
          : isBuy && Number(amount) > MAX_MINT_PER_TX
          ? `Over ${MAX_MINT_PER_TX} Ξ cap`
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
          ? "mint new ascend against the bonding curve. 0.7% fee + 3% surplus take. surplus accumulates as overcollateralization that pays bonus on long-hold burns. no LP, no pre-mint, no admin path."
          : "redeem ascend through the inverse curve. 0.7% protocol fee + 1% token-side burn + smooth block-age penalty that ramps from 10% (block 0) down to 0% (block 500, ~1.7 hrs at 12s blocks). penalties go to surplus reserve, which pays a bonus once over-collateralization tops 10%. patient holders are subsidized by impatient flippers."}
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
  /// Treat `value` as ETH and render USD-primary with Ξ underneath.
  /// Requires `rate` (ETH→USD).
  usd,
  rate,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: boolean;
  muted?: boolean;
  big?: boolean;
  small?: boolean;
  usd?: boolean;
  rate?: number;
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
          "tabular text-right",
          accent && "text-accent",
          muted && "text-bone/80",
          big && "text-[18px]",
          small && "text-[12px]",
        )}
      >
        {usd && rate ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <span>
              {fmtUsd(value, rate)}
              {suffix ? ` ${suffix}` : ""}
            </span>
            <span className="text-[10px] text-ash/80">{fmtEthShort(value)}</span>
          </span>
        ) : (
          <>
            {Number.isFinite(value)
              ? value < 1e-4 && value > 0
                ? value.toExponential(3)
                : value.toLocaleString(undefined, { maximumFractionDigits: 6 })
              : "—"}
            {suffix ? ` ${suffix}` : ""}
          </>
        )}
      </motion.span>
    </div>
  );
}
