"use client";

import { useEffect, useState } from "react";
import { config } from "@/lib/config";

export interface HistoryPoint {
  poolId: string;
  blockNumber: number;
  timestamp: number;
  multiplier: number;
  treasury: number;
  F: number;
  V: number;
  D: number;
  C: number;
}

export function useMultiplierHistory() {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const url = new URL(`${config.indexerUrl}/history`);
        url.searchParams.set("limit", "200");
        if (config.poolId) url.searchParams.set("poolId", config.poolId);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`indexer: ${res.status}`);
        const json = (await res.json()) as HistoryPoint[];
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { data, error };
}
