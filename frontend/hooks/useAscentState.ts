"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { config } from "@/lib/config";
import { ascentHookAbi } from "@/lib/abis";
import { isDemoMode, simulate } from "@/lib/demo";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface AscentSnapshot {
  isLoading: boolean;
  isDemo: boolean;
  F: number;
  V: number;
  D: number;
  C: number;
  multiplier: number;
  treasury: number;
  refetch: () => void;
}

export function useAscentState(): AscentSnapshot {
  const demo = isDemoMode(config.hookAddress);

  // ---- live mode ----
  const { data, isLoading, refetch } = useReadContracts({
    query: { enabled: !demo, refetchInterval: 6_000 },
    contracts: [
      { address: config.hookAddress, abi: ascentHookAbi, functionName: "F", args: [config.poolId] },
      { address: config.hookAddress, abi: ascentHookAbi, functionName: "V", args: [config.poolId] },
      { address: config.hookAddress, abi: ascentHookAbi, functionName: "D", args: [config.poolId] },
      { address: config.hookAddress, abi: ascentHookAbi, functionName: "C", args: [config.poolId] },
      { address: config.hookAddress, abi: ascentHookAbi, functionName: "computeMultiplier", args: [config.poolId] },
      { address: config.hookAddress, abi: ascentHookAbi, functionName: "treasury", args: [config.poolId] },
    ],
  });

  // ---- demo mode (simulated frame walking forward) ----
  const frames = useMemo(() => (demo ? simulate({ steps: 240 }) : []), [demo]);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    if (!demo) return;
    const id = setInterval(() => setCursor((c) => (c + 1) % frames.length), 2_000);
    return () => clearInterval(id);
  }, [demo, frames.length]);

  if (demo) {
    const f = frames[cursor] ?? frames[0];
    return {
      isLoading: false,
      isDemo: true,
      F: f?.state.F ?? 0,
      V: f?.state.V ?? 0,
      D: f?.state.D ?? 0,
      C: f?.state.C ?? 0,
      multiplier: f?.multiplier ?? 1,
      treasury: f?.treasury ?? 0,
      refetch: () => {},
    };
  }

  const r = (i: number) => Number(formatEther(((data?.[i]?.result as bigint) ?? 0n) as bigint));
  return {
    isLoading,
    isDemo: false,
    F: r(0),
    V: r(1),
    D: r(2),
    C: r(3),
    multiplier: r(4),
    treasury: r(5),
    refetch,
  };
}

export const ZERO_ADDRESS = ZERO;
