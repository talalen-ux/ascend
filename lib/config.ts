export const ASCEND_HOOK_ADDRESS = (process.env.NEXT_PUBLIC_ASCEND_HOOK ?? "") as `0x${string}` | "";
export const ASCEND_ROUTER_ADDRESS = (process.env.NEXT_PUBLIC_ASCEND_ROUTER ?? "") as `0x${string}` | "";
export const ASCEND_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_ASCEND_TOKEN ?? "") as `0x${string}` | "";
export const TILE_ENGINE_ADDRESS = (process.env.NEXT_PUBLIC_TILE_ENGINE ?? "") as `0x${string}` | "";
export const POOL_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_POOL_MANAGER ?? "") as `0x${string}` | "";
export const POOL_ID = (process.env.NEXT_PUBLIC_POOL_ID ?? "") as `0x${string}` | "";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);

export const isConfigured =
  ASCEND_HOOK_ADDRESS !== "" &&
  ASCEND_ROUTER_ADDRESS !== "" &&
  ASCEND_TOKEN_ADDRESS !== "" &&
  ASCEND_HOOK_ADDRESS.startsWith("0x") &&
  ASCEND_ROUTER_ADDRESS.startsWith("0x");

/**
 * Build a Uniswap.org V4 swap URL for the ascend pool. When V4 support
 * is fully rolled out across Uniswap's UI, this URL will route swaps
 * through the same hook the dapp uses, with identical pricing.
 */
export function uniswapSwapUrl(): string {
  if (!isConfigured) return "https://app.uniswap.org/";
  const chain = CHAIN_ID === 11155111 ? "sepolia" : "mainnet";
  return `https://app.uniswap.org/swap?chain=${chain}&inputCurrency=ETH&outputCurrency=${ASCEND_TOKEN_ADDRESS}`;
}

export function dexscreenerUrl(): string {
  if (!POOL_ID) return "";
  return `https://dexscreener.com/ethereum/${POOL_ID}`;
}
