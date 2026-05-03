"use client";

import { useReadContracts } from "wagmi";
import { config } from "@/lib/config";
import { ascentHookAbi } from "@/lib/abis";
import { formatEther } from "viem";

export function useAscentState() {
  const hook = config.hookAddress as `0x${string}`;
  const enabled = !!hook;

  const { data, isLoading, refetch } = useReadContracts({
    query: { enabled, refetchInterval: 6_000 },
    contracts: [
      { address: hook, abi: ascentHookAbi, functionName: "F" },
      { address: hook, abi: ascentHookAbi, functionName: "D" },
      { address: hook, abi: ascentHookAbi, functionName: "C" },
      { address: hook, abi: ascentHookAbi, functionName: "computeMultiplier" },
      { address: hook, abi: ascentHookAbi, functionName: "treasury" },
    ],
  });

  const [F, D, C, m, treasury] = data ?? [];
  const toEth = (r: any) => Number(formatEther((r?.result as bigint) ?? 0n));

  return {
    isLoading,
    refetch,
    F: toEth(F),
    D: toEth(D),
    C: toEth(C),
    multiplier: toEth(m),
    treasury: toEth(treasury),
  };
}
