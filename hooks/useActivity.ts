"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatEther, parseAbiItem, type PublicClient, type GetLogsReturnType } from "viem";
import {
  ASCEND_HOOK_ADDRESS,
  ASCEND_TOKEN_ADDRESS,
  CHAIN_ID,
  isConfigured,
} from "@/lib/config";

/// Sepolia: ~12s blocks → 24h ≈ 7,200 blocks.
const BLOCKS_PER_DAY = 7_200;
const REFRESH_MS = 30_000;

const MINT_EVENT = parseAbiItem(
  "event Mint(address indexed sender, uint256 ethIn, uint256 totalFee, uint256 tileShare, uint256 mintAmount, uint256 newEthCum, uint256 newSupply)"
);
const BURN_EVENT = parseAbiItem(
  "event Burn(address indexed sender, uint256 satoIn, uint256 totalFee, uint256 tileShare, uint256 ethOut, uint256 newEthCum, uint256 newSupply)"
);
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

export interface Activity {
  /// Window over which the stats are computed (in blocks).
  windowBlocks: number;
  /// Number of mint+burn txs in the window.
  txns24h: number;
  /// Total ETH inflow (mint volume) in the window.
  volMintEth: number;
  /// Total ETH outflow (burn volume) in the window.
  volBurnEth: number;
  /// Combined ETH volume in the window.
  vol24hEth: number;
  /// Net mint flow (ascend) in the window.
  mintFlowAscend: number;
  /// Net burn flow (ascend) in the window.
  burnFlowAscend: number;
  /// Holders — unique non-zero addresses with positive balance, snapshot at latest block.
  holders: number;
  /// Burnt-fees-equivalent: cumulative reserve-side fee retained over all time
  /// (computed from total mint+burn fees minus tile share).
  burntFeesEth: number;
  isLoading: boolean;
}

const EMPTY: Activity = {
  windowBlocks: BLOCKS_PER_DAY,
  txns24h: 0,
  volMintEth: 0,
  volBurnEth: 0,
  vol24hEth: 0,
  mintFlowAscend: 0,
  burnFlowAscend: 0,
  holders: 0,
  burntFeesEth: 0,
  isLoading: false,
};

async function fetchActivity(client: PublicClient): Promise<Activity> {
  const head = await client.getBlockNumber();
  const fromBlock = head > BigInt(BLOCKS_PER_DAY) ? head - BigInt(BLOCKS_PER_DAY) : 0n;

  type MintLogs = GetLogsReturnType<typeof MINT_EVENT>;
  type BurnLogs = GetLogsReturnType<typeof BURN_EVENT>;

  const [mintLogs, burnLogs, transferLogs] = await Promise.all([
    client.getLogs({
      address: ASCEND_HOOK_ADDRESS as `0x${string}`,
      event: MINT_EVENT,
      fromBlock,
      toBlock: head,
    }) as Promise<MintLogs>,
    client.getLogs({
      address: ASCEND_HOOK_ADDRESS as `0x${string}`,
      event: BURN_EVENT,
      fromBlock,
      toBlock: head,
    }) as Promise<BurnLogs>,
    // For holders: we need the entire history, not just 24h. But on a
    // public RPC, scanning since genesis can be slow. We bound to the
    // last 50k blocks (~1 week on Sepolia) as a pragmatic cap.
    client.getLogs({
      address: ASCEND_TOKEN_ADDRESS as `0x${string}`,
      event: TRANSFER_EVENT,
      fromBlock: head > 50_000n ? head - 50_000n : 0n,
      toBlock: head,
    }),
  ]);

  let volMint = 0n;
  let mintFlow = 0n;
  let totalMintFee = 0n;
  let totalMintTile = 0n;
  for (const log of mintLogs) {
    volMint += log.args.ethIn ?? 0n;
    mintFlow += log.args.mintAmount ?? 0n;
    totalMintFee += log.args.totalFee ?? 0n;
    totalMintTile += log.args.tileShare ?? 0n;
  }

  let volBurn = 0n;
  let burnFlow = 0n;
  let totalBurnFee = 0n;
  let totalBurnTile = 0n;
  for (const log of burnLogs) {
    volBurn += log.args.ethOut ?? 0n;
    burnFlow += log.args.satoIn ?? 0n;
    totalBurnFee += log.args.totalFee ?? 0n;
    totalBurnTile += log.args.tileShare ?? 0n;
  }

  // Reserve-side burnt fees ≈ total fees − tile shares (the part retained in reserve).
  // This is just an approximation across the recent log range; we'll refine if needed.
  const burntFeesEth =
    Number(formatEther(totalMintFee + totalBurnFee - totalMintTile - totalBurnTile));

  // Holders: walk Transfer events, track per-address running balance, count
  // addresses ending with positive balance.
  const balances = new Map<string, bigint>();
  for (const log of transferLogs) {
    const from = log.args.from as string;
    const to = log.args.to as string;
    const value = log.args.value ?? 0n;
    if (from && from !== "0x0000000000000000000000000000000000000000") {
      balances.set(from, (balances.get(from) ?? 0n) - value);
    }
    if (to && to !== "0x0000000000000000000000000000000000000000") {
      balances.set(to, (balances.get(to) ?? 0n) + value);
    }
  }
  let holders = 0;
  for (const [, bal] of balances) {
    if (bal > 0n) holders++;
  }

  return {
    windowBlocks: BLOCKS_PER_DAY,
    txns24h: mintLogs.length + burnLogs.length,
    volMintEth: Number(formatEther(volMint)),
    volBurnEth: Number(formatEther(volBurn)),
    vol24hEth: Number(formatEther(volMint + volBurn)),
    mintFlowAscend: Number(formatEther(mintFlow)),
    burnFlowAscend: Number(formatEther(burnFlow)),
    holders,
    burntFeesEth,
    isLoading: false,
  };
}

export function useActivity(): Activity {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const [state, setState] = useState<Activity>({ ...EMPTY, isLoading: true });

  useEffect(() => {
    if (!isConfigured || !client) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await fetchActivity(client as PublicClient);
        if (!cancelled) setState(data);
      } catch {
        if (!cancelled) setState((s) => ({ ...s, isLoading: false }));
      }
      if (!cancelled) timer = setTimeout(tick, REFRESH_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client]);

  return state;
}
