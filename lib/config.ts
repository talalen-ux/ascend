const RAW_ENGINE = (process.env.NEXT_PUBLIC_ASCEND_ENGINE ?? "").trim();
const ZERO = "0x0000000000000000000000000000000000000000";

const isHexAddress = /^0x[0-9a-fA-F]{40}$/.test(RAW_ENGINE);

export const ASCEND_ENGINE_ADDRESS = (isHexAddress ? RAW_ENGINE : "") as
  | `0x${string}`
  | "";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);

export const isConfigured =
  isHexAddress && RAW_ENGINE.toLowerCase() !== ZERO;
