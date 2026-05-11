"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { ASCEND_HOOK_V3_ABI } from "@/lib/abi";
import {
  ASCEND_HOOK_ADDRESS,
  CHAIN_ID,
  isConfigured,
} from "@/lib/config";
import { K as CURVE_K, S as CURVE_S, marginalMintPriceAt, type StateV3 } from "@/lib/floor_v3";

export interface AscendState extends StateV3 {
  /// ETH per ascend (the burn floor — what one ascend redeems for).
  floorEth: number;
  /// Spot mint price on the curve. ETH per ascend.
  priceEth: number;
  /// Market cap = price × current supply, in ETH.
  marketCapEth: number;
  /// Fully-diluted value = price × asymptotic cap, in ETH.
  fdvEth: number;
  /// Number of ascend currently in user wallets (= currentSupply).
  circulating: number;
  /// Forward supply: q(cumulativeEthIn) computed from the formula.
  forwardSupply: number;
  /// Structural drift = forwardSupply − mintedFair. PRBMath rounding gap.
  drift: number;
  /// Overcollateralization buffer (3% of every mint plus burn penalties).
  surplusEth: number;
  /// surplusReserve / cumulativeEthIn in basis points (1bp = 0.01%).
  surplusRatioBps: number;
  /// Active reserve-aware burn bonus in basis points.
  bonusBps: number;
  /// True when the dapp is showing pre-deploy demo numbers.
  isDemo: boolean;
  /// True while contracts are loading.
  isLoading: boolean;
}

const DEMO_STATE: AscendState = {
  ethCum: 0,
  supply: 0,
  reserveEth: 0,
  floorEth: 0,
  priceEth: CURVE_S / CURVE_K,
  marketCapEth: 0,
  fdvEth: 0,
  circulating: 0,
  forwardSupply: 0,
  drift: 0,
  surplusEth: 0,
  surplusRatioBps: 0,
  bonusBps: 0,
  isDemo: true,
  isLoading: false,
};

export function useAscendState(): AscendState {
  const { data, isLoading } = useReadContracts({
    contracts: isConfigured
      ? ([
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "currentSupply",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "cumulativeEthIn",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "reserveEth",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "floor",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "mintedFair",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "forwardSupply",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "drift",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "surplusReserve",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "surplusRatioBps",
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V3_ABI,
            functionName: "currentBonusBps",
            chainId: CHAIN_ID,
          },
        ] as const)
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) return DEMO_STATE;

  const supply = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : 0;
  const ethCum = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : 0;
  const reserveEth = data?.[2]?.result ? Number(formatEther(data[2].result as bigint)) : 0;
  const floorEth = data?.[3]?.result ? Number(formatEther(data[3].result as bigint)) : 0;
  const mintedFair = data?.[4]?.result ? Number(formatEther(data[4].result as bigint)) : 0;
  const forwardSupply = data?.[5]?.result ? Number(formatEther(data[5].result as bigint)) : 0;
  const drift = data?.[6]?.result ? Number(formatEther(data[6].result as bigint)) : 0;
  const surplusEth = data?.[7]?.result ? Number(formatEther(data[7].result as bigint)) : 0;
  const surplusRatioBps = data?.[8]?.result ? Number(data[8].result as bigint) : 0;
  const bonusBps = data?.[9]?.result ? Number(data[9].result as bigint) : 0;

  const priceEth = marginalMintPriceAt(ethCum);
  const circulating = supply;
  const marketCapEth = priceEth * circulating;
  const fdvEth = priceEth * CURVE_K;

  return {
    ethCum,
    supply,
    reserveEth,
    mintedFair,
    forwardSupply,
    drift,
    surplusEth,
    surplusRatioBps,
    bonusBps,
    floorEth,
    priceEth,
    marketCapEth,
    fdvEth,
    circulating,
    isDemo: false,
    isLoading,
  };
}
