"use client";

import { useQuery } from "@tanstack/react-query";

/// Fallback rate used before the first CoinGecko response lands or if the
/// API errors. Overridable via NEXT_PUBLIC_USD_PER_ETH at build time.
export const FALLBACK_USD_PER_ETH = Number(
  process.env.NEXT_PUBLIC_USD_PER_ETH ?? 3500,
);

/// CoinGecko free public endpoint — no API key required, ~30 req/min limit.
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

interface CoingeckoResponse {
  ethereum?: { usd?: number };
}

async function fetchEthPriceUsd(): Promise<number> {
  const res = await fetch(COINGECKO_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const json = (await res.json()) as CoingeckoResponse;
  const price = json.ethereum?.usd;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error("coingecko bad payload");
  }
  return price;
}

/// Live ETH/USD price. Refetches every 60s, dedupes across the tree via
/// react-query cache. Returns the FALLBACK rate immediately so the first
/// paint isn't blank; the real rate hydrates as soon as the fetch lands.
export function useEthPrice(): number {
  const { data } = useQuery({
    queryKey: ["eth-usd-price"],
    queryFn: fetchEthPriceUsd,
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: 2,
  });
  return data ?? FALLBACK_USD_PER_ETH;
}
