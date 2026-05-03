"use client";

import { useEffect, useMemo, useState } from "react";
import { config } from "@/lib/config";
import { isDemoMode, simulate } from "@/lib/demo";

export interface HistoryPoint {
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
  const demo = isDemoMode(config.hookAddress);
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const demoFrames = useMemo(() => (demo ? simulate({ steps: 240 }) : []), [demo]);

  useEffect(() => {
    if (demo) {
      setData(
        demoFrames.map((f) => ({
          blockNumber: f.blockNumber,
          timestamp: f.timestamp,
          multiplier: f.multiplier,
          treasury: f.treasury,
          F: f.state.F,
          V: f.state.V,
          D: f.state.D,
          C: f.state.C,
        })),
      );
      return;
    }

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
  }, [demo, demoFrames]);

  return { data, error: demo ? null : error, isDemo: demo };
}
