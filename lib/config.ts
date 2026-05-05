export const ASCEND_ENGINE_ADDRESS = (process.env.NEXT_PUBLIC_ASCEND_ENGINE ?? "") as `0x${string}` | "";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);
export const isConfigured = ASCEND_ENGINE_ADDRESS !== "" && ASCEND_ENGINE_ADDRESS.startsWith("0x");
