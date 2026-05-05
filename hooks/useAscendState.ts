"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { ASCEND_ENGINE_ABI } from "@/lib/abi";
import { ASCEND_ENGINE_ADDRESS, isConfigured } from "@/lib/config";
import { BOOTSTRAP_ETH, BOOTSTRAP_ASCEND, type State } from "@/lib/floor";

export interface AscendState extends State {
  floorEth: number;
  isDemo: boolean;
  isLoading: boolean;
}

const DEMO_STATE: AscendState = {
  reserveEth: BOOTSTRAP_ETH,
  supply: BOOTSTRAP_ASCEND,
  floorEth: BOOTSTRAP_ETH / BOOTSTRAP_ASCEND,
  isDemo: true,
  isLoading: false,
};

export function useAscendState(): AscendState {
  const { data, isLoading } = useReadContracts({
    contracts: isConfigured
      ? [
          { address: ASCEND_ENGINE_ADDRESS as `0x${string}`, abi: ASCEND_ENGINE_ABI, functionName: "reserve" },
          { address: ASCEND_ENGINE_ADDRESS as `0x${string}`, abi: ASCEND_ENGINE_ABI, functionName: "floor" },
        ]
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) return DEMO_STATE;

  const reserveEth = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : BOOTSTRAP_ETH;
  const floorEth = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : BOOTSTRAP_ETH / BOOTSTRAP_ASCEND;
  const supply = floorEth > 0 ? reserveEth / floorEth : BOOTSTRAP_ASCEND;

  return {
    reserveEth,
    supply,
    floorEth,
    isDemo: false,
    isLoading,
  };
}
