"use client";

import { useEffect, useState } from "react";
import { config } from "@/lib/config";

export interface HistoryPoint {
  blockNumber: number;
  timestamp: number;
  multiplier: number;
  F: number;
}

export function useMultiplierHistory() {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${config.indexerUrl}/history?limit=200`);
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
