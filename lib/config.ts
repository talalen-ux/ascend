/**
 * Single source of truth for chain + contract addresses. The dapp falls
 * back to demo state (no RPC, hardcoded curve) when the address isn't set.
 */

export const SATO_HOOK_ADDRESS = (process.env.NEXT_PUBLIC_SATO_HOOK ?? "") as `0x${string}` | "";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);

export const isConfigured = SATO_HOOK_ADDRESS !== "" && SATO_HOOK_ADDRESS.startsWith("0x");
