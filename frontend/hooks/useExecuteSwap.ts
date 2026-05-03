"use client";

import { useCallback, useState } from "react";
import { parseEther, type Address } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { config } from "@/lib/config";
import { poolSwapTestAbi } from "@/lib/abis";

const MIN_SQRT_PRICE = 4295128739n;
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

export function useExecuteSwap() {
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async ({ isBuy, amountIn }: { isBuy: boolean; amountIn: string }) => {
      if (!wallet || !address) throw new Error("connect wallet");
      if (config.swapRouterAddress === "0x0000000000000000000000000000000000000000")
        throw new Error("swap router not configured");

      setPending(true);
      setError(null);
      try {
        const amount = parseEther(amountIn);
        const hash = await wallet.writeContract({
          address: config.swapRouterAddress,
          abi: poolSwapTestAbi,
          functionName: "swap",
          value: isBuy ? amount : 0n,
          args: [
            {
              currency0: "0x0000000000000000000000000000000000000000" as Address,
              currency1: config.tokenAddress,
              fee: config.poolFee,
              tickSpacing: config.poolTickSpacing,
              hooks: config.hookAddress,
            },
            {
              zeroForOne: isBuy,
              amountSpecified: -amount, // exact-input
              sqrtPriceLimitX96: isBuy ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n,
            },
            { takeClaims: false, settleUsingBurn: false },
            "0x",
          ],
        });
        return hash;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [wallet, address],
  );

  return { execute, pending, error, ready: !!wallet && !!address };
}
