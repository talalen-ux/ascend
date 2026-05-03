"use client";

import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { config } from "@/lib/config";
import { ascentQuoterAbi } from "@/lib/abis";

interface QuoteArgs {
  isBuy: boolean;
  amountIn: string;
  /** ETH addr is treated as currency0 (zero address). */
  ethAddress?: Address;
}

interface Quote {
  multiplier: number;
  adjustedOut: bigint;
  hookCharge: bigint;
  treasuryCapped: boolean;
}

/**
 * Live on-chain quote via AscentQuoter. The base AMM output is approximated
 * here with `amountIn` to keep the example dependency-free; in production wire
 * the v4 quoter for `key` and pass its result as `baseOut`.
 */
export function useQuoter(args: QuoteArgs) {
  const client = usePublicClient();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    if (config.quoterAddress === "0x0000000000000000000000000000000000000000") return;
    let cancelled = false;

    const run = async () => {
      try {
        const amountIn = parseEther(args.amountIn || "0");
        if (amountIn === 0n) {
          setQuote(null);
          return;
        }
        const baseOut = amountIn; // placeholder for v4 quoter result

        const result = await client.readContract({
          address: config.quoterAddress,
          abi: ascentQuoterAbi,
          functionName: "quoteExactInput",
          args: [
            {
              currency0: (args.ethAddress ?? "0x0000000000000000000000000000000000000000") as Address,
              currency1: config.tokenAddress,
              fee: config.poolFee,
              tickSpacing: config.poolTickSpacing,
              hooks: config.hookAddress,
            },
            args.isBuy,
            amountIn,
            baseOut,
          ],
        });

        if (cancelled) return;
        const r = result as {
          multiplier: bigint;
          adjustedOut: bigint;
          hookCharge: bigint;
          treasuryCapped: boolean;
        };
        setQuote({
          multiplier: Number(r.multiplier) / 1e18,
          adjustedOut: r.adjustedOut,
          hookCharge: r.hookCharge,
          treasuryCapped: r.treasuryCapped,
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };

    const id = setTimeout(run, 250); // debounce keystrokes
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [args.amountIn, args.isBuy, args.ethAddress, client]);

  return { quote, error };
}
