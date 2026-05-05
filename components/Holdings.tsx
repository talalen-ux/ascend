"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useAccount, useReadContract } from "wagmi";
import { formatEther } from "viem";
import clsx from "clsx";
import { ASCEND_TOKEN_ADDRESS, isConfigured } from "@/lib/config";
import { ERC20_ABI } from "@/lib/abi";
import { useAscendState } from "@/hooks/useAscendState";

const GRID_COLS = 16;
const GRID_ROWS = 10;
const TOTAL_SQUARES = GRID_COLS * GRID_ROWS; // 160
const ETH_PRICE_USD = 2_350;

const truncate = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export function Holdings() {
  const { address, isConnected } = useAccount();
  const state = useAscendState();

  const { data: balanceData } = useReadContract({
    address: isConfigured ? (ASCEND_TOKEN_ADDRESS as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address && isConfigured ? [address] : undefined,
    query: { enabled: !!address && isConfigured, refetchInterval: 12_000 },
  });

  const balance = balanceData ? Number(formatEther(balanceData as bigint)) : 0;
  const filled = useMemo(() => {
    // every square = 1/TOTAL_SQUARES of the user's balance.
    // squares are filled until balance reaches the cap; if balance is 0, none.
    if (balance <= 0 || !isConnected) return 0;
    // For visual interest: cap at TOTAL_SQUARES squares, all lit, when balance > 0.
    return TOTAL_SQUARES;
  }, [balance, isConnected]);

  const valueEth = balance * state.floorEth;
  const valueUsd = valueEth * ETH_PRICE_USD;
  const sharePct = state.supply > 0 ? (balance / state.supply) * 100 : 0;
  const perSquareEth = balance / TOTAL_SQUARES;
  const perSquareUsd = perSquareEth * ETH_PRICE_USD;

  return (
    <section className="panel mt-12 p-7">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
            Position
          </h2>
          <p className="mt-2 text-[14px] text-bone">
            {isConnected ? truncate(address) : "no wallet connected"}
          </p>
        </div>
        <div className="font-mono text-[11px] text-ash">
          {balance > 0
            ? `each tile ≈ ${perSquareEth < 1e-4 ? perSquareEth.toExponential(2) : perSquareEth.toFixed(6)} ascend ($${perSquareUsd.toFixed(2)})`
            : "tiles unfilled — mine ascend to claim them"}
        </div>
      </header>

      <div
        className="mt-6 grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: TOTAL_SQUARES }).map((_, i) => {
          const isLit = i < filled;
          const delay = ((i % GRID_COLS) + Math.floor(i / GRID_COLS)) * 0.012;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{
                opacity: isLit ? 1 : 0.18,
                scale: 1,
              }}
              transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
              className={clsx(
                "aspect-square rounded-[2px] transition-colors",
                isLit
                  ? "bg-accent shadow-[0_0_8px_-1px_rgba(197,238,71,0.4)]"
                  : "bg-edge",
              )}
              title={
                isLit
                  ? `${perSquareEth < 1e-4 ? perSquareEth.toExponential(3) : perSquareEth.toFixed(8)} ascend`
                  : ""
              }
            />
          );
        })}
      </div>

      <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge md:grid-cols-4">
        <Stat
          label="Holdings"
          value={`${balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}
          hint="ascend mined to your wallet"
        />
        <Stat
          label="Floor value"
          value={`${valueEth < 1e-4 ? valueEth.toExponential(2) : valueEth.toFixed(4)} Ξ`}
          hint="redemption at current floor"
        />
        <Stat
          label="USD"
          value={`$${valueUsd >= 1000 ? Math.round(valueUsd).toLocaleString() : valueUsd.toFixed(2)}`}
          hint={`@ $${ETH_PRICE_USD.toLocaleString()}/ETH`}
        />
        <Stat
          label="Share of supply"
          value={`${sharePct < 0.0001 && sharePct > 0 ? sharePct.toExponential(2) : sharePct.toFixed(4)}%`}
          hint={`of ${state.supply.toLocaleString(undefined, { maximumFractionDigits: 2 })} total`}
        />
      </div>

      {!isConnected && (
        <p className="mt-5 text-center text-[11px] text-ash">
          connect your wallet to see your tiles fill in.
        </p>
      )}
      {isConnected && balance === 0 && (
        <p className="mt-5 text-center text-[11px] text-ash">
          no ascend yet — every square fills as you mine.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-canvas px-5 py-4">
      <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">{label}</div>
      <div className="mt-1.5 font-mono tabular text-[16px] text-bone">{value}</div>
      <div className="mt-1 font-mono text-[10px] text-ash">{hint}</div>
    </div>
  );
}
