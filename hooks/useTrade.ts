"use client";

import { useState } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { ASCEND_ROUTER_ABI, ERC20_ABI } from "@/lib/abi";
import {
  ASCEND_ROUTER_ADDRESS,
  ASCEND_TOKEN_ADDRESS,
  CHAIN_ID,
  isConfigured,
} from "@/lib/config";

export type Side = "buy" | "sell";

export function useTrade() {
  const { address } = useAccount();
  const connectedChainId = useChainId();
  const wrongChain = !!address && connectedChainId !== CHAIN_ID;
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });
  const [error, setError] = useState<string | null>(null);

  // Read the user's current router allowance for ascend (only matters on sells).
  const { data: allowance } = useReadContract({
    address: isConfigured ? (ASCEND_TOKEN_ADDRESS as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && isConfigured ? [address, ASCEND_ROUTER_ADDRESS as `0x${string}`] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && isConfigured },
  });

  async function execute(side: Side, amount: string) {
    setError(null);
    try {
      if (!isConfigured) throw new Error("contract not configured");
      if (!address) throw new Error("connect wallet");
      if (wrongChain) throw new Error(`switch your wallet to chain ${CHAIN_ID} (Sepolia)`);
      const value = parseEther(amount);

      if (side === "buy") {
        writeContract({
          chainId: CHAIN_ID,
          address: ASCEND_ROUTER_ADDRESS as `0x${string}`,
          abi: ASCEND_ROUTER_ABI,
          functionName: "buy",
          args: [0n, address], // minOut=0 (hook has no MEV-extractable slippage)
          value,
        });
      } else {
        // For sells: ensure allowance is sufficient. If not, the dapp surfaces
        // a separate "Approve" step (see Trade.tsx).
        const have = (allowance as bigint | undefined) ?? 0n;
        if (have < value) {
          throw new Error("approve the router for ascend first");
        }
        writeContract({
          chainId: CHAIN_ID,
          address: ASCEND_ROUTER_ADDRESS as `0x${string}`,
          abi: ASCEND_ROUTER_ABI,
          functionName: "sell",
          args: [value, 0n, address],
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "unknown error");
    }
  }

  async function approve(amount: string) {
    setError(null);
    try {
      if (!isConfigured) throw new Error("contract not configured");
      if (!address) throw new Error("connect wallet");
      if (wrongChain) throw new Error(`switch your wallet to chain ${CHAIN_ID} (Sepolia)`);
      writeContract({
        chainId: CHAIN_ID,
        address: ASCEND_TOKEN_ADDRESS as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ASCEND_ROUTER_ADDRESS as `0x${string}`, parseEther(amount)],
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "unknown error");
    }
  }

  return {
    execute,
    approve,
    pending: isPending || isMining,
    isSuccess,
    hash,
    error: error ?? (writeError ? writeError.message : null),
    reset,
    ready: !!address && isConfigured && !wrongChain,
    wrongChain,
    allowance: (allowance as bigint | undefined) ?? 0n,
  };
}
