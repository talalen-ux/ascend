// Mirror of AscentHook.computeMultiplier in floating point for client preview.
// The contract is the source of truth — this exists only to avoid an RPC
// roundtrip for the live-typing trade preview.

export const S1 = 300;
export const S2 = 500;
export const S3 = 200;
export const MIN_X = -4;
export const MAX_X = 4;

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

export interface AscentState {
  /** Net flow in ETH units (not wei). */
  F: number;
  D: number;
  C: number;
}

export function multiplier({ F, D, C }: AscentState): number {
  const expTerm = Math.exp(clamp(F / S1, MIN_X, MAX_X));
  const logTerm = Math.log(1 + Math.max(0, D / S2));
  const compression = 1 + C / S3;
  return (expTerm * (1 + logTerm)) / compression;
}

/** Returns the user's effective output after the hook adjustment. */
export function previewOutput(opts: {
  state: AscentState;
  baseOut: number;
  isBuy: boolean;
}): { adjusted: number; m: number; penaltyBps: number } {
  const m = multiplier(opts.state);
  const adjusted = opts.isBuy ? opts.baseOut / m : opts.baseOut * m;
  const penaltyBps = Math.round((1 - adjusted / opts.baseOut) * 10_000);
  return { adjusted, m, penaltyBps };
}
