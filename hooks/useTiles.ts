"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { decodeEventLog, formatEther, type Log } from "viem";
import { TILE_ENGINE_ABI } from "@/lib/abi";
import { TILE_ENGINE_ADDRESS, isConfigured } from "@/lib/config";

const GRID_SIZE = 144;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export interface TileReveal {
  tileIdx: number;
  multiplier: number;
  rewardEth: number;
}

/**
 * Per-tile state for the current epoch. `claimer == null` means the
 * tile is open. When taken, the dapp shows last-4 of the claimer
 * address + the reward they pulled on hover-flip.
 */
export interface TileSlot {
  claimer: `0x${string}` | null;
  multiplier: number;
  rewardEth: number;
}

export interface TilesState {
  configured: boolean;
  currentEpoch: bigint;
  poolEth: number;
  baseRewardEth: number;
  canClaim: boolean;
  isSelectedThisEpoch: boolean;
  tiles: TileSlot[]; // length 144
  isLoading: boolean;
}

const emptyTiles = (): TileSlot[] =>
  Array.from({ length: GRID_SIZE }, () => ({
    claimer: null,
    multiplier: 0,
    rewardEth: 0,
  }));

const DEMO_TILES_STATE: TilesState = {
  configured: false,
  currentEpoch: 0n,
  poolEth: 0,
  baseRewardEth: 0,
  canClaim: false,
  isSelectedThisEpoch: false,
  tiles: emptyTiles(),
  isLoading: false,
};

const tileEngineConfigured = (): boolean =>
  isConfigured && TILE_ENGINE_ADDRESS !== "" && TILE_ENGINE_ADDRESS.startsWith("0x");

/// Format the last 4 hex chars of an address as `0x…ABCD`.
export function addressTail(addr: `0x${string}` | null | undefined): string {
  if (!addr) return "";
  return `0x…${addr.slice(-4).toUpperCase()}`;
}

/**
 * Reads the live tile-game state in one batched RPC call:
 *   - currentEpoch / pool / baseReward (header)
 *   - canClaim + isSelected for the connected user
 *   - currentEpochTiles() returns all 144 ClaimRecord structs
 *
 * Refetches every 12s. Demo mode returns a stable empty grid until
 * the dapp is wired to live addresses.
 */
export function useTilesState(): TilesState {
  const { address } = useAccount();
  const live = tileEngineConfigured();

  const headerCalls = live
    ? ([
        {
          address: TILE_ENGINE_ADDRESS as `0x${string}`,
          abi: TILE_ENGINE_ABI,
          functionName: "currentEpoch" as const,
        },
        {
          address: TILE_ENGINE_ADDRESS as `0x${string}`,
          abi: TILE_ENGINE_ABI,
          functionName: "currentEpochPool" as const,
        },
        {
          address: TILE_ENGINE_ADDRESS as `0x${string}`,
          abi: TILE_ENGINE_ABI,
          functionName: "currentBaseReward" as const,
        },
        {
          address: TILE_ENGINE_ADDRESS as `0x${string}`,
          abi: TILE_ENGINE_ABI,
          functionName: "currentEpochTiles" as const,
        },
      ] as const)
    : ([] as const);

  const { data: headerData, isLoading: headerLoading } = useReadContracts({
    contracts: headerCalls as readonly unknown[] as never,
    query: { enabled: live, refetchInterval: 12_000 },
  });
  const header = headerData as Array<{ result?: unknown }> | undefined;

  const currentEpoch = (header?.[0]?.result as bigint | undefined) ?? 0n;
  const poolWei = (header?.[1]?.result as bigint | undefined) ?? 0n;
  const baseRewardWei = (header?.[2]?.result as bigint | undefined) ?? 0n;
  const tilesRaw = (header?.[3]?.result as
    | ReadonlyArray<{ claimer: `0x${string}`; multiplier: number; reward: bigint }>
    | undefined) ?? undefined;

  // user-specific reads
  const { data: canClaimData } = useReadContract({
    address: live ? (TILE_ENGINE_ADDRESS as `0x${string}`) : undefined,
    abi: TILE_ENGINE_ABI,
    functionName: "canClaim",
    args: address ? [address] : undefined,
    query: { enabled: !!address && live, refetchInterval: 12_000 },
  });

  const { data: isSelectedData } = useReadContract({
    address: live ? (TILE_ENGINE_ADDRESS as `0x${string}`) : undefined,
    abi: TILE_ENGINE_ABI,
    functionName: "isSelected",
    args: address ? [address, currentEpoch] : undefined,
    query: { enabled: !!address && live, refetchInterval: 12_000 },
  });

  if (!live) return DEMO_TILES_STATE;

  const tiles: TileSlot[] = tilesRaw
    ? tilesRaw.map((r) => ({
        claimer:
          r.claimer && r.claimer.toLowerCase() !== ZERO_ADDR ? r.claimer : null,
        multiplier: Number(r.multiplier ?? 0),
        rewardEth: Number(formatEther(r.reward ?? 0n)),
      }))
    : emptyTiles();

  return {
    configured: true,
    currentEpoch,
    poolEth: Number(formatEther(poolWei)),
    baseRewardEth: Number(formatEther(baseRewardWei)),
    canClaim: !!canClaimData,
    isSelectedThisEpoch: !!isSelectedData,
    tiles,
    isLoading: headerLoading,
  };
}

/**
 * Mutation hook for claiming a tile. Tracks pending tx state, parses
 * the TileClaimed event from the receipt to surface the revealed
 * multiplier and reward, and exposes dismissReveal() to clear the
 * modal.
 */
export function useClaimTile() {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isMining, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash });
  const [pendingTile, setPendingTile] = useState<number | null>(null);
  const [reveal, setReveal] = useState<TileReveal | null>(null);

  useEffect(() => {
    if (!isSuccess || !receipt || !address) return;
    if (reveal !== null) return; // already parsed
    for (const log of receipt.logs as Log[]) {
      try {
        const decoded = decodeEventLog({
          abi: TILE_ENGINE_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "TileClaimed") continue;
        const args = decoded.args as unknown as {
          claimer: `0x${string}`;
          tileIdx: number;
          epoch: bigint;
          multiplier: number;
          reward: bigint;
        };
        if (args.claimer.toLowerCase() !== address.toLowerCase()) continue;
        setReveal({
          tileIdx: Number(args.tileIdx),
          multiplier: Number(args.multiplier),
          rewardEth: Number(formatEther(args.reward)),
        });
        return;
      } catch {
        // Not a TileEngine event; skip.
      }
    }
  }, [isSuccess, receipt, address, reveal]);

  function claim(idx: number) {
    if (!tileEngineConfigured()) return;
    setPendingTile(idx);
    setReveal(null);
    writeContract({
      address: TILE_ENGINE_ADDRESS as `0x${string}`,
      abi: TILE_ENGINE_ABI,
      functionName: "claimTile",
      args: [idx],
    });
  }

  function dismissReveal() {
    setReveal(null);
    setPendingTile(null);
  }

  return {
    claim,
    pendingTile,
    pending: isPending || isMining,
    isSuccess,
    reveal,
    dismissReveal,
    hash,
    error,
  };
}
