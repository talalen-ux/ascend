"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { useAccount } from "wagmi";
import { useTilesState, useClaimTile } from "@/hooks/useTiles";

const GRID_COLS = 12;
const GRID_ROWS = 12;
const TOTAL = GRID_COLS * GRID_ROWS;
const ETH_USD = 2_350;

/**
 * The tile-flip game. A 12×12 grid where each tile is claimable once
 * per 24h epoch by any holder of ≥ 1 ascend. Click → flip → reveal a
 * 1×–4× multiplier on the base reward (LP fee share). The lit tiles
 * are taken; the dim ones are still available.
 *
 * Future: parse the TileClaimed event from the receipt to populate a
 * reveal modal with the actual multiplier and reward. For now, the
 * confirmation message just acknowledges the flip.
 */
export function Tiles() {
  const { isConnected } = useAccount();
  const state = useTilesState();
  const { claim, pendingTile, pending, isSuccess } = useClaimTile();

  const epochLabel = useMemo(() => {
    if (!state.configured) return "demo";
    return `epoch #${state.currentEpoch.toString()}`;
  }, [state.configured, state.currentEpoch]);

  const remaining = useMemo(() => state.claimed.filter((c) => !c).length, [state.claimed]);

  function handleClick(idx: number) {
    if (!state.configured || !isConnected || !state.canClaim) return;
    if (state.claimed[idx]) return;
    claim(idx);
  }

  return (
    <section className="panel mt-10 p-7">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-widest2 text-accent">
            Tiles · the share
          </h2>
          <p className="mt-2 text-[14px] text-bone">
            {state.configured
              ? `${remaining} of ${TOTAL} tiles open · ${epochLabel}`
              : "tiles unlock when the v2 contracts are live"}
          </p>
        </div>
        <div className="flex flex-col items-end font-mono text-[11px] text-ash">
          <span>
            pool: <span className="text-bone">{fmtEth(state.poolEth)}</span>
          </span>
          <span>
            base reward:{" "}
            <span className="text-bone">{fmtEth(state.baseRewardEth)}</span> · 1×
          </span>
          <span className="text-ash/70">×1, ×2, ×3, or ×4 on flip</span>
        </div>
      </header>

      <div
        className="relative mt-6 grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: TOTAL }).map((_, i) => {
          const taken = state.claimed[i] ?? false;
          const isPending = pendingTile === i && pending;
          const delay = ((i % GRID_COLS) + Math.floor(i / GRID_COLS)) * 0.012;

          return (
            <motion.button
              key={i}
              onClick={() => handleClick(i)}
              disabled={
                !state.configured ||
                !isConnected ||
                !state.canClaim ||
                taken ||
                pending
              }
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{
                opacity: taken ? 1 : 0.32,
                scale: 1,
                rotateY: isPending ? 180 : 0,
              }}
              transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
              whileHover={
                !taken && state.canClaim && state.configured
                  ? { opacity: 0.85, scale: 1.04 }
                  : undefined
              }
              className={clsx(
                "aspect-square rounded-[2px] transition-colors",
                taken
                  ? "bg-accent shadow-[0_0_8px_-1px_rgba(197,238,71,0.4)]"
                  : "bg-edge hover:bg-edge/70",
                isPending && "ring-1 ring-accent",
                "disabled:cursor-not-allowed cursor-pointer",
              )}
              title={
                taken
                  ? "claimed this epoch"
                  : state.canClaim
                    ? "click to flip"
                    : isConnected
                      ? "you've claimed this epoch — back next cycle"
                      : "connect a wallet with ascend to claim"
              }
            />
          );
        })}
      </div>

      <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge md:grid-cols-4">
        <Stat
          label="Pool"
          value={fmtEth(state.poolEth)}
          hint={`≈ ${fmtUsd(state.poolEth * ETH_USD)}`}
        />
        <Stat
          label="Base reward"
          value={fmtEth(state.baseRewardEth)}
          hint="payout at 1× multiplier"
        />
        <Stat
          label="Best case"
          value={fmtEth(state.baseRewardEth * 4)}
          hint="if you flip a 4×"
        />
        <Stat
          label="Tiles left"
          value={`${remaining} / ${TOTAL}`}
          hint={state.canClaim ? "you can claim one" : "claimed this epoch"}
        />
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-ash">
        {state.configured
          ? "every swap on the ascend pool funds this pool with 1% of the trade fee. once per 24h epoch, any holder can flip one tile and reveal a random 1× to 4× multiplier on their share. unclaimed tiles roll forward into next epoch."
          : "the tile game runs on a separate contract that's funded by every ascend swap. live once the v2 hook is deployed; for now, this shows the layout and the empty state."}
      </p>

      <AnimatePresence>
        {isSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-[11px] text-emerald-400"
          >
            tile flipped. reward sent to your wallet.
          </motion.div>
        )}
      </AnimatePresence>
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

function fmtEth(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 Ξ";
  if (n < 1e-4) return `${n.toExponential(2)} Ξ`;
  if (n < 1) return `${n.toFixed(4)} Ξ`;
  return `${n.toFixed(2)} Ξ`;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}
