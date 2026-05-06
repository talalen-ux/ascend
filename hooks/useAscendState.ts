"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { ASCEND_HOOK_ABI } from "@/lib/abi";
import { ASCEND_HOOK_ADDRESS, isConfigured } from "@/lib/config";
import {
  BOOTSTRAP_ETH,
  BOOTSTRAP_ASCEND,
  MINING_PREMIUM_BPS,
  BPS_DENOM,
  type State,
} from "@/lib/floor";

export interface AscendState extends State {
  floorEth: number;
  priceEth: number;
  marketCapEth: number;
  premiumPct: number;
  isDemo: boolean;
  isLoading: boolean;
}

const PREMIUM = 1 + MINING_PREMIUM_BPS / BPS_DENOM;

const DEMO_STATE: AscendState = {
  reserveEth: BOOTSTRAP_ETH,
  supply: BOOTSTRAP_ASCEND,
  floorEth: BOOTSTRAP_ETH / BOOTSTRAP_ASCEND,
  priceEth: (BOOTSTRAP_ETH / BOOTSTRAP_ASCEND) * PREMIUM,
  marketCapEth: BOOTSTRAP_ASCEND * (BOOTSTRAP_ETH / BOOTSTRAP_ASCEND) * PREMIUM,
  premiumPct: (PREMIUM - 1) * 100,
  isDemo: true,
  isLoading: false,
};

export function useAscendState(): AscendState {
  const { data, isLoading } = useReadContracts({
    contracts: isConfigured
      ? [
          { address: ASCEND_HOOK_ADDRESS as `0x${string}`, abi: ASCEND_HOOK_ABI, functionName: "reserve" },
          { address: ASCEND_HOOK_ADDRESS as `0x${string}`, abi: ASCEND_HOOK_ABI, functionName: "floor" },
          { address: ASCEND_HOOK_ADDRESS as `0x${string}`, abi: ASCEND_HOOK_ABI, functionName: "price" },
          { address: ASCEND_HOOK_ADDRESS as `0x${string}`, abi: ASCEND_HOOK_ABI, functionName: "marketCap" },
        ]
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) return DEMO_STATE;

  const reserveEth = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : BOOTSTRAP_ETH;
  const floorEth = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : BOOTSTRAP_ETH / BOOTSTRAP_ASCEND;
  const priceEth = data?.[2]?.result ? Number(formatEther(data[2].result as bigint)) : floorEth * PREMIUM;
  const marketCapEth = data?.[3]?.result ? Number(formatEther(data[3].result as bigint)) : reserveEth * PREMIUM;
  const supply = floorEth > 0 ? reserveEth / floorEth : BOOTSTRAP_ASCEND;

  return {
    reserveEth,
    supply,
    floorEth,
    priceEth,
    marketCapEth,
    premiumPct: floorEth > 0 ? ((priceEth / floorEth) - 1) * 100 : (PREMIUM - 1) * 100,
    isDemo: false,
    isLoading,
  };
}
