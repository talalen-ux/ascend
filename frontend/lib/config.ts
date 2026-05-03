import type { Address } from "viem";

const addr = (s: string | undefined): Address =>
  ((s && /^0x[0-9a-fA-F]{40}$/.test(s) ? s : "0x0000000000000000000000000000000000000000") as Address);

export const config = {
  hookAddress: addr(process.env.NEXT_PUBLIC_HOOK_ADDRESS),
  tokenAddress: addr(process.env.NEXT_PUBLIC_TOKEN_ADDRESS),
  quoterAddress: addr(process.env.NEXT_PUBLIC_QUOTER_ADDRESS),
  poolManagerAddress: addr(process.env.NEXT_PUBLIC_POOL_MANAGER),
  swapRouterAddress: addr(process.env.NEXT_PUBLIC_SWAP_ROUTER),
  poolId: (process.env.NEXT_PUBLIC_POOL_ID ?? `0x${"0".repeat(64)}`) as `0x${string}`,
  poolFee: Number(process.env.NEXT_PUBLIC_POOL_FEE ?? 3000),
  poolTickSpacing: Number(process.env.NEXT_PUBLIC_POOL_TICK_SPACING ?? 60),
  indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:8787",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11_155_111),
};

export const poolKey = {
  currency0: config.tokenAddress, // overridden in UI when ETH is currency0
  currency1: config.tokenAddress,
  fee: config.poolFee,
  tickSpacing: config.poolTickSpacing,
  hooks: config.hookAddress,
} as const;
