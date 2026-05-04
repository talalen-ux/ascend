"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { RISE_ENGINE_ABI } from "@/lib/abi";
import { RISE_ENGINE_ADDRESS, isConfigured } from "@/lib/config";
import { BOOTSTRAP_ETH, BOOTSTRAP_RISE, type State } from "@/lib/floor";

export interface RiseState extends State {
  floorEth: number;
  isDemo: boolean;
  isLoading: boolean;
}

const DEMO_STATE: RiseState = {
  reserveEth: BOOTSTRAP_ETH,
  supply: BOOTSTRAP_RISE,
  floorEth: BOOTSTRAP_ETH / BOOTSTRAP_RISE,
  isDemo: true,
  isLoading: false,
};

export function useRiseState(): RiseState {
  const { data, isLoading } = useReadContracts({
    contracts: isConfigured
      ? [
          { address: RISE_ENGINE_ADDRESS as `0x${string}`, abi: RISE_ENGINE_ABI, functionName: "reserve" },
          { address: RISE_ENGINE_ADDRESS as `0x${string}`, abi: RISE_ENGINE_ABI, functionName: "floor" },
        ]
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) return DEMO_STATE;

  const reserveEth = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : BOOTSTRAP_ETH;
  const floorEth = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : BOOTSTRAP_ETH / BOOTSTRAP_RISE;
  const supply = floorEth > 0 ? reserveEth / floorEth : BOOTSTRAP_RISE;

  return {
    reserveEth,
    supply,
    floorEth,
    isDemo: false,
    isLoading,
  };
}
