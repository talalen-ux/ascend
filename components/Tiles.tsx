"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { useAccount } from "wagmi";
import { useTilesState, useClaimTile, addressTail, type TileSlot } from "@/hooks/useTiles";

interface TileReveal {
  tileIdx: number;
  multiplier: number;
  rewardEth: number;
}

const GRID_COLS = 12;
const GRID_ROWS = 12;
const TOTAL = GRID_COLS * GRID_ROWS;
const ETH_USD = 2_350;

/**
 * The connected wallet's status with respect to today's tile epoch.
 * Drives the back-face content of every OPEN tile so the user can see
 * at a glance whether they have a reward they can claim.
 *
 *   demo          contracts not yet wired (pre-launch)
 *   disconnected  wallet not connected
 *   not-selected  in the 32% who don't get a draw today
 *   claimed       already flipped a tile this epoch
 *   ineligible    other reason canClaim is false (no holding, etc.)
 *   ready         in today's draw, hasn't claimed yet — flip me!
 */
type UserStatus =
  | "demo"
  | "disconnected"
  | "not-selected"
  | "claimed"
  | "ineligible"
  | "ready";

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
  const { address, isConnected } = useAccount();
  const state = useTilesState();
  const { claim, pendingTile, pending, isSuccess, reveal, dismissReveal } = useClaimTile();

  // Demo reveal: a marketing-only "what does the claim screen look
  // like?" trigger. It mounts the same RevealModal component the live
  // claim flow uses, populated with sample data. No on-chain effect.
  const [demoReveal, setDemoReveal] = useState<TileReveal | null>(null);
  const activeReveal = reveal ?? demoReveal;
  const closeReveal = () => {
    if (demoReveal) setDemoReveal(null);
    else dismissReveal();
  };
  function showDemoReveal() {
    // Pick a believable mid-pool reward at typical mainnet volume
    // (~$1M/day → tile pool $3.6k → base reward ~0.0066 ETH × 3 ≈ 0.02).
    setDemoReveal({ tileIdx: 73, multiplier: 3, rewardEth: 0.0204 });
  }

  const epochLabel = useMemo(() => {
    if (!state.configured) return "demo";
    return `epoch #${state.currentEpoch.toString()}`;
  }, [state.configured, state.currentEpoch]);

  const remaining = useMemo(
    () => state.tiles.filter((t) => t.claimer === null).length,
    [state.tiles],
  );

  // Index of the tile (if any) the connected wallet has already
  // claimed this epoch. -1 if not claimed.
  const ownTileIdx = useMemo(() => {
    const me = address?.toLowerCase();
    if (!me) return -1;
    return state.tiles.findIndex((t) => t.claimer?.toLowerCase() === me);
  }, [state.tiles, address]);

  // Compact status used by every open tile's back face. Computed once
  // here so we don't recompute it 144 times.
  const userStatus: UserStatus = useMemo(() => {
    if (!state.configured) return "demo";
    if (!isConnected) return "disconnected";
    if (ownTileIdx >= 0) return "claimed";
    if (!state.isSelectedThisEpoch) return "not-selected";
    if (!state.canClaim) return "ineligible";
    return "ready";
  }, [state.configured, isConnected, ownTileIdx, state.isSelectedThisEpoch, state.canClaim]);

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
            Ascension Grid
          </h2>
          <p className="mt-2 text-[14px] text-bone">
            {state.configured
              ? `${remaining} of ${TOTAL} tiles open · ${epochLabel}`
              : "the cryptographic surface — live once contracts ship"}
          </p>
          <button
            type="button"
            onClick={showDemoReveal}
            className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest2 text-accent/80 transition hover:text-accent"
          >
            <span>preview a 3× claim</span>
            <span aria-hidden>→</span>
          </button>
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
          const isOwn =
            taken &&
            !!address &&
            tile.claimer?.toLowerCase() === address.toLowerCase();
          const isPending = pendingTile === i && pending;
          const delay = ((i % GRID_COLS) + Math.floor(i / GRID_COLS)) * 0.012;

          return (
            <Tile
              key={i}
              idx={i}
              tile={tile}
              taken={taken}
              isOwn={isOwn}
              isPending={isPending}
              entryDelay={delay}
              clickable={!taken && state.canClaim && state.configured && isConnected && !pending}
              userStatus={userStatus}
              userTail={address ? addressTail(address) : ""}
              baseRewardEth={state.baseRewardEth}
              onClick={() => handleClick(i)}
              tooltip={tooltipFor({
                taken,
                isOwn,
                userStatus,
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
        {activeReveal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
            onClick={closeReveal}
          >
            <motion.div
              initial={{ scale: 0.85, rotateY: -90 }}
              animate={{ scale: 1, rotateY: 0 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative panel mx-6 max-w-sm w-full p-8 text-center overflow-hidden"
            >
              {/* Halo glow behind the multiplier */}
              <motion.div
                aria-hidden
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 0.65, scale: 1 }}
                transition={{ duration: 0.9, delay: 0.15 }}
                className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
                style={{
                  background:
                    "radial-gradient(closest-side, rgba(197,238,71,0.55), transparent 70%)",
                }}
              />

              {demoReveal && (
                <div className="relative mb-3 inline-block rounded-full bg-bone/10 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-widest2 text-bone/70">
                  preview · sample data
                </div>
              )}

              <div className="relative text-[10px] font-medium uppercase tracking-widest2 text-ash">
                Tile #{activeReveal.tileIdx} flipped
              </div>

              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="relative mt-4 font-mono text-[72px] leading-none text-accent drop-shadow-[0_0_24px_rgba(197,238,71,0.45)]"
              >
                ×{activeReveal.multiplier}
              </motion.div>

              <div className="relative mt-3 text-[11px] uppercase tracking-widest2 text-ash">
                multiplier
              </div>
              <div className="relative hairline my-6" />
              <div className="relative text-[10px] font-medium uppercase tracking-widest2 text-ash">
                reward
              </div>
              <motion.div
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.35 }}
                className="relative mt-2 font-mono tabular text-[28px] text-bone"
              >
                {fmtEth(activeReveal.rewardEth)}
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.45 }}
                className="relative mt-1 font-mono text-[11px] text-ash"
              >
                ≈ {fmtUsd(activeReveal.rewardEth * ETH_USD)}
                {demoReveal ? " · this is what a real claim looks like" : " · sent to your wallet"}
              </motion.div>
              <button
                onClick={closeReveal}
                className="relative mt-7 w-full rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-[11px] font-medium uppercase tracking-widest text-accent transition hover:bg-accent/15"
              >
                {demoReveal ? "close preview" : "close"}
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
  isOwn: boolean;
  isPending: boolean;
  entryDelay: number;
  clickable: boolean;
  userStatus: UserStatus;
  userTail: string;
  baseRewardEth: number;
  onClick: () => void;
  tooltip: string;
}

/**
 * Individual tile cell. Two-layer DOM:
 *   - the halo (absolute, behind, only visible on hover)
 *   - the flip card (front + back faces, rotated on hover)
 *
 * The halo is a radial green gradient that fades in on hover. The
 * flip uses CSS 3D transforms with backface-visibility:hidden on each
 * face.
 *
 * The back face is contextual:
 *   - claimed by ANYONE: shows ×N · reward · claimer-tail
 *     (highlighted differently if `isOwn` is true — that tile is the
 *     connected wallet's own claim from this epoch)
 *   - OPEN tile: shows the connected wallet's status — "FLIP ME",
 *     "CLAIMED", "OUT TODAY", "CONNECT" — so users can check on any
 *     tile whether they have a claim available without needing to
 *     guess. Open-tile back-face data is identical for all 144
 *     because there's only one possible answer per wallet per epoch.
 */
function Tile({
  tile,
  taken,
  isOwn,
  isPending,
  entryDelay,
  clickable,
  userStatus,
  userTail,
  baseRewardEth,
  onClick,
  tooltip,
}: TileProps) {
  return (
    <motion.div
      className="relative aspect-square"
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: entryDelay, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Mesmerizing halo: radial green gradient that fades in on hover. */}
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
                ? isOwn
                  ? "bg-accent shadow-[0_0_14px_0_rgba(197,238,71,0.85)] ring-2 ring-bone"
                  : "bg-accent shadow-[0_0_8px_-1px_rgba(197,238,71,0.5)]"
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
                ? isOwn
                  ? "bg-accent/40 ring-1 ring-bone"
                  : "bg-accent/20 ring-1 ring-accent/60"
                : openBackBg(userStatus),
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
                <span
                  className={clsx(
                    "font-mono text-[6px] leading-tight tabular",
                    isOwn ? "font-bold text-bone" : "text-ash",
                  )}
                >
                  {isOwn ? "YOU" : addressTail(tile.claimer)}
                </span>
              </>
            ) : (
              <OpenBackContent
                status={userStatus}
                userTail={userTail}
                baseRewardEth={baseRewardEth}
              />
            )}
          </div>
        </div>
      </button>
    </motion.div>
  );
}

/**
 * Back-face content for an OPEN tile. Shows the connected wallet's
 * eligibility for the current epoch so a user can hover any tile and
 * see whether they can claim.
 */
function OpenBackContent({
  status,
  userTail,
  baseRewardEth,
}: {
  status: UserStatus;
  userTail: string;
  baseRewardEth: number;
}) {
  switch (status) {
    case "ready":
      return (
        <>
          <span className="font-mono text-[7px] uppercase tracking-widest2 text-accent">
            flip me
          </span>
          <span className="font-mono text-[6px] leading-tight tabular text-bone">
            ~{fmtEthMicro(baseRewardEth * 1.625)}
          </span>
          <span className="font-mono text-[6px] leading-tight tabular text-ash">
            {userTail}
          </span>
        </>
      );
    case "claimed":
      return (
        <>
          <span className="font-mono text-[7px] uppercase tracking-widest2 text-bone">
            already
          </span>
          <span className="font-mono text-[7px] uppercase tracking-widest2 text-bone">
            claimed
          </span>
          <span className="font-mono text-[6px] leading-tight tabular text-ash">
            {userTail}
          </span>
        </>
      );
    case "not-selected":
      return (
        <>
          <span className="font-mono text-[7px] uppercase tracking-widest2 text-ash">
            32% out
          </span>
          <span className="font-mono text-[6px] uppercase tracking-widest2 text-ash">
            try
          </span>
          <span className="font-mono text-[6px] uppercase tracking-widest2 text-ash">
            tomorrow
          </span>
        </>
      );
    case "ineligible":
      return (
        <>
          <span className="font-mono text-[7px] uppercase tracking-widest2 text-ash">
            no
          </span>
          <span className="font-mono text-[7px] uppercase tracking-widest2 text-ash">
            holding
          </span>
        </>
      );
    case "disconnected":
      return (
        <>
          <span className="font-mono text-[7px] uppercase tracking-widest2 text-ash">
            connect
          </span>
          <span className="font-mono text-[6px] uppercase tracking-widest2 text-ash">
            wallet
          </span>
        </>
      );
    case "demo":
    default:
      return (
        <span className="font-mono text-[7px] uppercase tracking-widest2 text-ash">
          open
        </span>
      );
  }
}

/** Background tint for the back-face of an OPEN tile, by user status. */
function openBackBg(status: UserStatus): string {
  switch (status) {
    case "ready":
      return "bg-accent/15 ring-1 ring-accent/60"; // inviting green
    case "claimed":
      return "bg-edge/80 ring-1 ring-bone/40";
    case "not-selected":
      return "bg-edge/60 ring-1 ring-ash/30";
    case "ineligible":
    case "disconnected":
      return "bg-edge/60 ring-1 ring-ash/30";
    case "demo":
    default:
      return "bg-edge/60 ring-1 ring-ash/30";
  }
}

function tooltipFor(s: {
  taken: boolean;
  isOwn: boolean;
  userStatus: UserStatus;
}): string {
  if (s.taken) {
    return s.isOwn
      ? "your claim this epoch — hover for details"
      : "claimed this epoch — hover for details";
  }
  switch (s.userStatus) {
    case "demo":
      return "v2 contracts not yet live";
    case "disconnected":
      return "connect a wallet with ascend to claim";
    case "not-selected":
      return "you're not in today's random 68% — back tomorrow";
    case "claimed":
      return "you've already claimed this epoch";
    case "ineligible":
      return "you don't meet the holding requirement";
    case "ready":
      return "click to flip";
  }
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
