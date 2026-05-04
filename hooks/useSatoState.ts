"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { SATO_HOOK_ABI } from "@/lib/abi";
import { SATO_HOOK_ADDRESS, isConfigured } from "@/lib/config";
import { priceAt, supplyAt } from "@/lib/curve";

export interface SatoState {
  cumulativeEth: number;
  priceEth: number;
  supply: number;
  isDemo: boolean;
  isLoading: boolean;
}

export function useSatoState(demoCumulativeEth = 80): SatoState {
  const { data, isLoading } = useReadContracts({
    contracts: isConfigured
      ? [
          { address: SATO_HOOK_ADDRESS as `0x${string}`, abi: SATO_HOOK_ABI, functionName: "cumulativeEth" },
          { address: SATO_HOOK_ADDRESS as `0x${string}`, abi: SATO_HOOK_ABI, functionName: "price" },
          { address: SATO_HOOK_ADDRESS as `0x${string}`, abi: SATO_HOOK_ABI, functionName: "curveSupply" },
        ]
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) {
    return {
      cumulativeEth: demoCumulativeEth,
      priceEth: priceAt(demoCumulativeEth),
      supply: supplyAt(demoCumulativeEth),
      isDemo: true,
      isLoading: false,
    };
  }

  const cumE = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : 0;
  const price = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : 0;
  const supply = data?.[2]?.result ? Number(formatEther(data[2].result as bigint)) : 0;

  return {
    cumulativeEth: cumE,
    priceEth: price,
    supply,
    isDemo: false,
    isLoading,
  };
}
