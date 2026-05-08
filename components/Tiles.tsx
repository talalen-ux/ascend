"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { useAccount } from "wagmi";
import { useTilesState, useClaimTile, addressTail, type TileSlot } from "@/hooks/useTiles";

const GRID_COLS = 12;
const GRID_ROWS = 12;
const TOTAL = GRID_COLS * GRID_ROWS;
const ETH_USD = 2_350;

/**
 * The tile-flip game. A 12×12 grid where each tile is claimable once
 * per 24h epoch by any holder of ≥ 1 ascend who is in the random 68%
 * selection cohort for that epoch. Click → flip → reveal a 1×–4×
 * multiplier on the base reward (LP fee share).
 *
 * Hover behaviour:
 *   - claimed tiles  → flip to reveal the claimer's address tail and
 *                      the reward they pulled
 *   - open tiles     → mesmerizing green halo glow behind the tile
 */
export function Tiles() {
  const { isConnected } = useAccount();
  const state = useTilesState();
  const { claim, pendingTile, pending, isSuccess, reveal, dismissReveal } = useClaimTile();

  const epochLabel = useMemo(() => {
    if (!state.configured) return "demo";
    return `epoch #${state.currentEpoch.toString()}`;
  }, [state.configured, state.currentEpoch]);

  const remaining = useMemo(
    () => state.tiles.filter((t) => t.claimer === null).length,
    [state.tiles],
  );

  function handleClick(idx: number) {
    if (!state.configured || !isConnected || !state.canClaim) return;
    if (state.tiles[idx]?.claimer !== null) return;
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
        {state.tiles.map((tile, i) => {
          const taken = tile.claimer !== null;
          const isPending = pendingTile === i && pending;
          const delay = ((i % GRID_COLS) + Math.floor(i / GRID_COLS)) * 0.012;

          return (
            <Tile
              key={i}
              idx={i}
              tile={tile}
              taken={taken}
              isPending={isPending}
              entryDelay={delay}
              clickable={!taken && state.canClaim && state.configured && isConnected && !pending}
              onClick={() => handleClick(i)}
              tooltip={tooltipFor({
                taken,
                configured: state.configured,
                isConnected,
                canClaim: state.canClaim,
                isSelected: state.isSelectedThisEpoch,
              })}
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
          hint={
            !isConnected
              ? "connect wallet"
              : !state.isSelectedThisEpoch
                ? "you're not in today's draw"
                : state.canClaim
                  ? "you can claim one"
                  : "claimed this epoch"
          }
        />
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-ash">
        {state.configured
          ? "every swap on the ascend pool funds this pool with 30% of the trade fee (≈ 0.3% of volume). 68% of holders are randomly selected each epoch — only the chosen can flip a tile that day. unclaimed share rolls into tomorrow. payouts are in ETH."
          : "the tile game runs on a separate contract that's funded by every ascend swap. live once the v2 hook is deployed; for now, this shows the layout and the empty state."}
      </p>

      <AnimatePresence>
        {isSuccess && !reveal && (
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

      <AnimatePresence>
        {reveal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
            onClick={dismissReveal}
          >
            <motion.div
              initial={{ scale: 0.85, rotateY: -90 }}
              animate={{ scale: 1, rotateY: 0 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="panel mx-6 max-w-sm w-full p-8 text-center"
            >
              <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
                Tile #{reveal.tileIdx} flipped
              </div>
              <div className="mt-4 font-mono text-[64px] leading-none text-accent">
                ×{reveal.multiplier}
              </div>
              <div className="mt-3 text-[11px] uppercase tracking-widest2 text-ash">
                multiplier
              </div>
              <div className="hairline my-6" />
              <div className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
                reward
              </div>
              <div className="mt-2 font-mono tabular text-[28px] text-bone">
                {fmtEth(reveal.rewardEth)}
              </div>
              <div className="mt-1 font-mono text-[11px] text-ash">
                ≈ {fmtUsd(reveal.rewardEth * ETH_USD)} · sent to your wallet
              </div>
              <button
                onClick={dismissReveal}
                className="mt-7 w-full rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-[11px] font-medium uppercase tracking-widest text-accent transition hover:bg-accent/15"
              >
                close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

interface TileProps {
  idx: number;
  tile: TileSlot;
  taken: boolean;
  isPending: boolean;
  entryDelay: number;
  clickable: boolean;
  onClick: () => void;
  tooltip: string;
}

/**
 * Individual tile cell. Two-layer DOM:
 *   - the halo (absolute, behind, only visible on hover)
 *   - the flip card (front + back faces, rotated on hover when taken)
 *
 * The halo is a radial gradient that pulses subtly via animate-breathe.
 * The flip uses CSS 3D transforms with backface-visibility:hidden on
 * each face. Open tiles flip too, but their back is intentionally
 * sparse ("OPEN") since there's nothing to reveal yet.
 */
function Tile({ tile, taken, isPending, entryDelay, clickable, onClick, tooltip }: TileProps) {
  return (
    <motion.div
      className="relative aspect-square"
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: entryDelay, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Mesmerizing halo: radial green gradient that fades in on hover.
          Sized larger than the tile so it bleeds into the surroundings. */}
      <div
        aria-hidden
        className={clsx(
          "pointer-events-none absolute -inset-3 rounded-full opacity-0 blur-md transition-opacity duration-300",
          "group-hover/tile:opacity-100",
        )}
        style={{
          background:
            "radial-gradient(closest-side, rgba(197,238,71,0.55), rgba(197,238,71,0.18) 55%, transparent 75%)",
        }}
      />

      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        title={tooltip}
        className={clsx(
          "group/tile relative h-full w-full cursor-pointer disabled:cursor-not-allowed",
          "[perspective:600px]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        {/* Flip container: rotates on hover (always for taken tiles, so you
            can read the reveal; muted for open tiles since back is sparse). */}
        <div
          className={clsx(
            "relative h-full w-full transition-transform duration-500 ease-out",
            "[transform-style:preserve-3d]",
            "group-hover/tile:[transform:rotateY(180deg)]",
            isPending && "[transform:rotateY(180deg)]",
          )}
        >
          {/* FRONT face */}
          <div
            className={clsx(
              "absolute inset-0 rounded-[2px] [backface-visibility:hidden]",
              taken
                ? "bg-accent shadow-[0_0_8px_-1px_rgba(197,238,71,0.5)]"
                : "bg-edge",
              isPending && "ring-1 ring-accent",
            )}
          />

          {/* BACK face */}
          <div
            className={clsx(
              "absolute inset-0 flex flex-col items-center justify-center rounded-[2px]",
              "[backface-visibility:hidden] [transform:rotateY(180deg)]",
              taken
                ? "bg-accent/20 ring-1 ring-accent/60"
                : "bg-edge/60 ring-1 ring-ash/40",
            )}
          >
            {taken ? (
              <>
                <span className="font-mono text-[8px] leading-tight tabular text-accent">
                  ×{tile.multiplier}
                </span>
                <span className="font-mono text-[7px] leading-tight tabular text-bone">
                  {fmtEthMicro(tile.rewardEth)}
                </span>
                <span className="font-mono text-[6px] leading-tight tabular text-ash">
                  {addressTail(tile.claimer)}
                </span>
              </>
            ) : (
              <span className="font-mono text-[7px] uppercase tracking-widest2 text-ash">
                open
              </span>
            )}
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function tooltipFor(s: {
  taken: boolean;
  configured: boolean;
  isConnected: boolean;
  canClaim: boolean;
  isSelected: boolean;
}): string {
  if (s.taken) return "claimed this epoch — hover for details";
  if (!s.configured) return "v2 contracts not yet live";
  if (!s.isConnected) return "connect a wallet with ascend to claim";
  if (!s.isSelected) return "you're not in today's random 68% — back tomorrow";
  if (!s.canClaim) return "you've already claimed this epoch";
  return "click to flip";
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

/** Compact ETH for tile-back-face: one or two characters of value */
function fmtEthMicro(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n < 0.0001) return n.toExponential(0).replace("e", "e");
  if (n < 0.01) return n.toFixed(3);
  if (n < 1) return n.toFixed(2);
  return n.toFixed(1);
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}
