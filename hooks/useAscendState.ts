"use client";

import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { ASCEND_HOOK_V2_ABI, ERC20_ABI } from "@/lib/abi";
import {
  ASCEND_HOOK_ADDRESS,
  ASCEND_TOKEN_ADDRESS,
  POOL_MANAGER_ADDRESS,
  CHAIN_ID,
  isConfigured,
} from "@/lib/config";
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
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_TOKEN_ADDRESS as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [ASCEND_HOOK_ADDRESS as `0x${string}`],
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_TOKEN_ADDRESS as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [POOL_MANAGER_ADDRESS as `0x${string}`],
            chainId: CHAIN_ID,
          },
          {
            address: ASCEND_HOOK_ADDRESS as `0x${string}`,
            abi: ASCEND_HOOK_V2_ABI,
            functionName: "liquidityHeld",
            chainId: CHAIN_ID,
          },
        ] as const)
      : [],
    query: { enabled: isConfigured, refetchInterval: 12_000 },
  });

  if (!isConfigured) return DEMO_STATE;

  // floor() returns ETH-per-ascend in 1e18 fixed-point.
  const floorEth = data?.[0]?.result ? Number(formatEther(data[0].result as bigint)) : 0;
  // Hook normally holds only the genesis dust from LiquidityAmounts rounding.
  const ascendOnHook = data?.[1]?.result ? Number(formatEther(data[1].result as bigint)) : 0;
  // The bulk of supply lives on the V4 PoolManager — that's the LP-side balance.
  const ascendInLP = data?.[2]?.result ? Number(formatEther(data[2].result as bigint)) : 0;

  // Circulating = supply held outside the LP and outside the hook.
  // Reserve (LP-side ascend) comes straight from PoolManager's balance
  // since the hook is the only LP on this pool. ETH-side LP depth is
  // implied by the floor identity Y = floor × circulating; a direct
  // read of PoolManager's native balance would mix in every other V4
  // pool's ETH so we don't use it here.
  const circulating = Math.max(0, SUPPLY_CAP - ascendInLP - ascendOnHook);
  const reserveAscend = ascendInLP;
  const reserveEth = circulating > 0 ? floorEth * circulating : BOOTSTRAP_ETH;
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
