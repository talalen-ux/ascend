"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { ASCEND_HOOK_ABI } from "@/lib/abi";
import { ASCEND_HOOK_ADDRESS, isConfigured } from "@/lib/config";
import {
  BOOTSTRAP_ETH,
  BOOTSTRAP_ASCEND,
  BASE_PREMIUM_BPS,
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

const BASE_PREMIUM_FRACTION = 1 + BASE_PREMIUM_BPS / BPS_DENOM;

const DEMO_STATE: AscendState = {
  reserveEth: BOOTSTRAP_ETH,
  supply: BOOTSTRAP_ASCEND,
  cumulativeEthIn: 0,
  floorEth: BOOTSTRAP_ETH / BOOTSTRAP_ASCEND,
  priceEth: (BOOTSTRAP_ETH / BOOTSTRAP_ASCEND) * BASE_PREMIUM_FRACTION,
  marketCapEth:
    BOOTSTRAP_ASCEND * (BOOTSTRAP_ETH / BOOTSTRAP_ASCEND) * BASE_PREMIUM_FRACTION,
  premiumPct: BASE_PREMIUM_BPS / 100,
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
          { address: ASCEND_HOOK_ADDRESS as `0x${string}`, abi: ASCEND_HOOK_ABI, functionName: "premiumBps" },
          { address: ASCEND_HOOK_ADDRESS as `0x${string}`, abi: ASCEND_HOOK_ABI, functionName: "cumulativeEthIn" },
        ]
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) return DEMO_STATE;

  const reserveEth = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : BOOTSTRAP_ETH;
  const floorEth = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : BOOTSTRAP_ETH / BOOTSTRAP_ASCEND;
  const priceEth = data?.[2]?.result ? Number(formatEther(data[2].result as bigint)) : floorEth * BASE_PREMIUM_FRACTION;
  const marketCapEth = data?.[3]?.result ? Number(formatEther(data[3].result as bigint)) : reserveEth * BASE_PREMIUM_FRACTION;
  const premiumBps = data?.[4]?.result ? Number(data[4].result as bigint) : BASE_PREMIUM_BPS;
  const cumulativeEthIn = data?.[5]?.result ? Number(formatEther(data[5].result as bigint)) : 0;
  const supply = floorEth > 0 ? reserveEth / floorEth : BOOTSTRAP_ASCEND;

  return {
    reserveEth,
    supply,
    cumulativeEthIn,
    floorEth,
    priceEth,
    marketCapEth,
    premiumPct: premiumBps / 100,
    isDemo: false,
    isLoading,
  };
}
