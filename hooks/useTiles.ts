"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { formatEther } from "viem";
import { TILE_ENGINE_ABI } from "@/lib/abi";
import { TILE_ENGINE_ADDRESS, isConfigured } from "@/lib/config";

const GRID_SIZE = 144;

export interface TilesState {
  configured: boolean;
  currentEpoch: bigint;
  poolEth: number;
  baseRewardEth: number;
  canClaim: boolean;
  claimed: boolean[]; // length 144; true if tile is taken this epoch
  isLoading: boolean;
}

const DEMO_TILES_STATE: TilesState = {
  configured: false,
  currentEpoch: 0n,
  poolEth: 0,
  baseRewardEth: 0,
  canClaim: false,
  claimed: Array.from({ length: GRID_SIZE }, () => false),
  isLoading: false,
};

const tileEngineConfigured = (): boolean =>
  isConfigured && TILE_ENGINE_ADDRESS !== "" && TILE_ENGINE_ADDRESS.startsWith("0x");

/**
 * Reads the live tile-game state: current epoch, pool size, base reward,
 * which tiles have been claimed. Refetches every 12s. Demo mode returns
 * a stable empty grid until the dapp is wired to live addresses.
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

  // canClaim view (depends on user address)
  const { data: canClaimData } = useReadContract({
    address: live ? (TILE_ENGINE_ADDRESS as `0x${string}`) : undefined,
    abi: TILE_ENGINE_ABI,
    functionName: "canClaim",
    args: address ? [address] : undefined,
    query: { enabled: !!address && live, refetchInterval: 12_000 },
  });

  // Per-tile claimedBy lookups, batched. Returns address(0) for available.
  const tileCalls = live
    ? Array.from({ length: GRID_SIZE }, (_, i) => ({
        address: TILE_ENGINE_ADDRESS as `0x${string}`,
        abi: TILE_ENGINE_ABI,
        functionName: "claimedBy" as const,
        args: [i, currentEpoch] as const,
      }))
    : [];

  const { data: tileDataRaw, isLoading: tilesLoading } = useReadContracts({
    contracts: tileCalls as readonly unknown[] as never,
    query: { enabled: live && currentEpoch !== undefined, refetchInterval: 12_000 },
  });
  const tileData = tileDataRaw as Array<{ result?: unknown }> | undefined;

  if (!live) return DEMO_TILES_STATE;

  const claimed: boolean[] = Array.from({ length: GRID_SIZE }, (_, i) => {
    const r = tileData?.[i]?.result as `0x${string}` | undefined;
    return !!r && r !== "0x0000000000000000000000000000000000000000";
  });

  return {
    configured: true,
    currentEpoch,
    poolEth: Number(formatEther(poolWei)),
    baseRewardEth: Number(formatEther(baseRewardWei)),
    canClaim: !!canClaimData,
    claimed,
    isLoading: headerLoading || tilesLoading,
  };
}

/**
 * Mutation hook for claiming a tile. Tracks pending tx state so the UI
 * can disable buttons during the flip animation.
 */
export function useClaimTile() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [pendingTile, setPendingTile] = useState<number | null>(null);

  function claim(idx: number) {
    if (!tileEngineConfigured()) return;
    setPendingTile(idx);
    writeContract({
      address: TILE_ENGINE_ADDRESS as `0x${string}`,
      abi: TILE_ENGINE_ABI,
      functionName: "claimTile",
      args: [idx],
    });
  }

  return {
    claim,
    pendingTile,
    pending: isPending || isMining,
    isSuccess,
    hash,
    error,
  };
}
