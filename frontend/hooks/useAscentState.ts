"use client";

import { useReadContracts } from "wagmi";
import { config } from "@/lib/config";
import { ascentHookAbi } from "@/lib/abis";
import { formatEther } from "viem";

const SCALE = (n: bigint) => Number(formatEther(n));

export function useAscentState() {
  const hook = config.hookAddress;
  const poolId = config.poolId;
  const enabled = hook !== "0x0000000000000000000000000000000000000000";

  const { data, isLoading, refetch } = useReadContracts({
    query: { enabled, refetchInterval: 6_000 },
    contracts: [
      { address: hook, abi: ascentHookAbi, functionName: "F", args: [poolId] },
      { address: hook, abi: ascentHookAbi, functionName: "V", args: [poolId] },
      { address: hook, abi: ascentHookAbi, functionName: "D", args: [poolId] },
      { address: hook, abi: ascentHookAbi, functionName: "C", args: [poolId] },
      { address: hook, abi: ascentHookAbi, functionName: "computeMultiplier", args: [poolId] },
      { address: hook, abi: ascentHookAbi, functionName: "treasury", args: [poolId] },
    ],
  });

  const r = (i: number) => SCALE(((data?.[i]?.result as bigint) ?? 0n) as bigint);

  return {
    isLoading,
    refetch,
    F: r(0),
    V: r(1),
    D: r(2),
    C: r(3),
    multiplier: r(4),
    treasury: r(5),
  };
}
