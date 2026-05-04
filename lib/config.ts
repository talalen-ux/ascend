export const RISE_ENGINE_ADDRESS = (process.env.NEXT_PUBLIC_RISE_ENGINE ?? "") as `0x${string}` | "";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);
export const isConfigured = RISE_ENGINE_ADDRESS !== "" && RISE_ENGINE_ADDRESS.startsWith("0x");
