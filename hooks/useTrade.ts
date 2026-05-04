"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { RISE_ENGINE_ABI } from "@/lib/abi";
import { RISE_ENGINE_ADDRESS, isConfigured } from "@/lib/config";

export type Side = "buy" | "sell";

export function useTrade() {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [error, setError] = useState<string | null>(null);

  async function execute(side: Side, amount: string) {
    setError(null);
    try {
      if (!isConfigured) throw new Error("contract not configured");
      if (!address) throw new Error("connect wallet");
      const value = parseEther(amount);

      if (side === "buy") {
        writeContract({
          address: RISE_ENGINE_ADDRESS as `0x${string}`,
          abi: RISE_ENGINE_ABI,
          functionName: "buy",
          value,
        });
      } else {
        writeContract({
          address: RISE_ENGINE_ADDRESS as `0x${string}`,
          abi: RISE_ENGINE_ABI,
          functionName: "sell",
          args: [value],
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "unknown error");
    }
  }

  return {
    execute,
    pending: isPending || isMining,
    isSuccess,
    hash,
    error: error ?? (writeError ? writeError.message : null),
    reset,
    ready: !!address && isConfigured,
  };
}
