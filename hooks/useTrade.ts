"use client";

import { useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { ASCEND_ENGINE_ABI } from "@/lib/abi";
import { ASCEND_ENGINE_ADDRESS, CHAIN_ID, isConfigured } from "@/lib/config";

export type Side = "buy" | "sell";

export function useTrade() {
  const { address } = useAccount();
  const activeChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [error, setError] = useState<string | null>(null);

  const wrongChain = !!address && activeChainId !== CHAIN_ID;

  async function execute(side: Side, amount: string) {
    setError(null);
    try {
      if (!isConfigured) throw new Error("contract not configured");
      if (!address) throw new Error("connect wallet");
      if (activeChainId !== CHAIN_ID) {
        await switchChainAsync({ chainId: CHAIN_ID });
      }
      const value = parseEther(amount);

      if (side === "buy") {
        writeContract({
          address: ASCEND_ENGINE_ADDRESS as `0x${string}`,
          abi: ASCEND_ENGINE_ABI,
          functionName: "buy",
          value,
        });
      } else {
        writeContract({
          address: ASCEND_ENGINE_ADDRESS as `0x${string}`,
          abi: ASCEND_ENGINE_ABI,
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
    wrongChain,
    expectedChainId: CHAIN_ID,
  };
}
