// Demo-mode state generator. When no hook address is configured, the UI runs
// against a deterministic simulation so the design is fully explorable without
// any chain integration. Mirrors the on-chain state shape exactly.

import { multiplier as computeM, applySwap, type AscentState } from "./math";

export interface DemoFrame {
  state: AscentState;
  treasury: number;
  multiplier: number;
  blockNumber: number;
  timestamp: number;
}

interface SimOptions {
  startBlock?: number;
  startTime?: number;
  steps?: number;
  seed?: number;
}

// Simple LCG for determinism — we want the chart to look the same every refresh.
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

export function simulate({
  startBlock = 18_000_000,
  startTime = Math.floor(Date.now() / 1000) - 60 * 60 * 6,
  steps = 200,
  seed = 7,
}: SimOptions = {}): DemoFrame[] {
  const rand = lcg(seed);
  let state: AscentState = { F: 0, V: 0, D: 0, C: 0 };
  let treasury = 0;
  const frames: DemoFrame[] = [];

  for (let i = 0; i < steps; i++) {
    // Decay (matching contract rates loosely)
    state = {
      F: state.F * 0.995,
      V: state.V * 0.95,
      D: state.D * 0.9995,
      C: Math.max(0, state.C * 0.99),
    };

    // Drift bias rises in early phase, oscillates later
    const phase = i / steps;
    const buyBias = 0.6 + 0.3 * Math.sin(phase * Math.PI * 2);
    const isBuy = rand() < buyBias;
    const size = 5 + rand() * 80;

    state = applySwap(state, size, isBuy);

    if (isBuy) {
      const m = computeM(state);
      if (m > 1) treasury += (size * (m - 1)) / m;
    } else {
      const m = computeM(state);
      if (m > 1) {
        const requested = size * (m - 1);
        const paid = Math.min(requested, treasury);
        treasury -= paid;
      }
    }

    frames.push({
      state: { ...state },
      treasury,
      multiplier: computeM(state),
      blockNumber: startBlock + i * 3,
      timestamp: startTime + i * 36,
    });
  }
  return frames;
}

export function isDemoMode(hookAddress: string): boolean {
  return hookAddress === "0x0000000000000000000000000000000000000000";
}
