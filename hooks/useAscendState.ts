"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { ASCEND_HOOK_V2_ABI, ERC20_ABI } from "@/lib/abi";
import { ASCEND_HOOK_ADDRESS, ASCEND_TOKEN_ADDRESS, isConfigured } from "@/lib/config";
import { SUPPLY_CAP, BOOTSTRAP_ETH, type State } from "@/lib/floor";

export interface AscendState extends State {
  /// ETH per circulating ascend (1e18-fixed → float ETH).
  floorEth: number;
  /// Spot price on the LP curve, ETH per ascend.
  priceEth: number;
  /// Market cap = price × circulating, in ETH.
  marketCapEth: number;
  /// Fully-diluted value = price × SUPPLY_CAP, in ETH.
  fdvEth: number;
  /// Number of ascend held by user wallets (= SUPPLY_CAP − reserveAscend).
  circulating: number;
  /// True when the dapp is showing pre-deploy demo numbers.
  isDemo: boolean;
  /// True while contracts are loading.
  isLoading: boolean;
}

/// Demo state at genesis: all 122M ascend in LP, 1 ETH bootstrap.
const DEMO_STATE: AscendState = {
  reserveEth: BOOTSTRAP_ETH,
  reserveAscend: SUPPLY_CAP,
  floorEth: 0,
  priceEth: BOOTSTRAP_ETH / SUPPLY_CAP,
  marketCapEth: 0,
  fdvEth: BOOTSTRAP_ETH, // price × supplyCap = (1/122M) × 122M = 1 ETH at genesis
  circulating: 0,
  isDemo: true,
  isLoading: false,
};

export function useAscendState(): AscendState {
  const { data, isLoading } = useReadContracts({
    contracts: isConfigured
      ? ([
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V2_ABI,
            functionName: "floor",
          },
          {
            address: ASCEND_TOKEN_ADDRESS as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [ASCEND_HOOK_ADDRESS as `0x${string}`],
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V2_ABI,
            functionName: "liquidityHeld",
          },
        ] as const)
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) return DEMO_STATE;

  // floor() returns ETH-per-ascend in 1e18 fixed-point.
  const floorEth = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : 0;
  // The hook holds 0 ascend in steady state — but if it does, that's
  // not circulating. (It's also unused after the LP seed; included for
  // completeness and parity with the on-chain _floor() formula.)
  const ascendOnHook = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : 0;

  // We don't fetch the live LP composition directly here — that would
  // require a poolManager state read. Instead, we approximate using the
  // floor and the circulating quantity.
  //
  // We don't have a direct read of `reserveAscend` on-chain via the
  // hook (would require a custom view), so we fall back to a rough
  // approximation: assume circulating ≈ totalSupply - ascendOnHook for
  // now, and reserveEth from the hook's external balance.
  //
  // For an accurate dapp, slice 9 added _floor() with all the math; an
  // off-chain RPC read of pool slot0 + StateLibrary positions can give
  // exact (X, Y). The fields below are best-effort until that's wired.
  const reserveAscend = SUPPLY_CAP - ascendOnHook; // upper bound; LP holds the rest
  const circulating = ascendOnHook;
  const reserveEth = floorEth * Math.max(circulating, 1);
  const priceEth = reserveAscend > 0 ? reserveEth / reserveAscend : 0;
  const marketCapEth = priceEth * circulating;
  const fdvEth = priceEth * SUPPLY_CAP;

  return {
    reserveEth,
    reserveAscend,
    floorEth,
    priceEth,
    marketCapEth,
    fdvEth,
    circulating,
    isDemo: false,
    isLoading,
  };
}
