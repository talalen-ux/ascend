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

export interface TileReveal {
  tileIdx: number;
  multiplier: number;
  rewardEth: number;
}

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
 * Mutation hook for claiming a tile. Tracks pending tx state, parses
 * the TileClaimed event from the receipt to surface the revealed
 * multiplier and reward, and exposes a reset() to dismiss the modal.
 */
export function useClaimTile() {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isMining, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash });
  const [pendingTile, setPendingTile] = useState<number | null>(null);
  const [reveal, setReveal] = useState<TileReveal | null>(null);

  // Parse TileClaimed from the receipt logs once the tx confirms.
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
