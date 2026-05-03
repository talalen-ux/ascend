export const config = {
  hookAddress: process.env.NEXT_PUBLIC_HOOK_ADDRESS ?? "",
  tokenAddress: process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "",
  poolManagerAddress: process.env.NEXT_PUBLIC_POOL_MANAGER ?? "",
  indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:8787",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11_155_111),
};
