// Off-chain mirror of AscentMath.sol — the Symmetric Reflexive
// Tanh-Exponential Curve (SR-TEC). The contract is the source of truth;
// this file exists only to avoid an RPC roundtrip per keystroke in the
// trade panel. Verify with the AscentQuoter contract before execution.

export const ALPHA = 4;
export const S_F = 300;
export const S_V = 50;
export const S_D = 500;
export const S_C = 200;
export const GAMMA = 2;
export const THETA = 1;
export const PHI = 1;
export const P_COMPRESSION = 1.2;

export interface AscentState {
  /** All values in "ETH units" (i.e. wei / 1e18). */
  F: number;
  V: number;
  D: number;
  C: number;
}

export function compositeScore({ F, V, D, C }: AscentState): number {
  const flow = (F + GAMMA * V) / S_F;
  const depth = D > 0 ? THETA * Math.log(1 + D / S_D) : 0;
  const comp = C > 0 ? PHI * Math.pow(C / S_C, P_COMPRESSION) : 0;
  return flow + depth - comp;
}

export function multiplier(state: AscentState): number {
  return Math.exp(ALPHA * Math.tanh(compositeScore(state)));
}

/** Project state forward as the hook would on this swap. */
export function applySwap(
  state: AscentState,
  amountIn: number,
  isBuy: boolean,
): AscentState {
  if (isBuy) {
    return {
      F: state.F + amountIn,
      V: state.V + amountIn,
      D: state.D + amountIn / 4,
      C: Math.max(0, state.C - amountIn / 10),
    };
  }
  return {
    F: state.F - amountIn,
    V: state.V - amountIn,
    D: state.D,
    C: state.C + amountIn,
  };
}

export function previewOutput(opts: {
  state: AscentState;
  baseOut: number;
  amountIn: number;
  treasury: number;
  isBuy: boolean;
}): {
  adjusted: number;
  m: number;
  hookCharge: number;
  treasuryCapped: boolean;
  effectivePriceShiftBps: number;
} {
  const post = applySwap(opts.state, opts.amountIn, opts.isBuy);
  const m = multiplier(post);

  if (opts.isBuy) {
    if (m > 1) {
      const tax = (opts.amountIn * (m - 1)) / m;
      return {
        adjusted: opts.baseOut / m,
        m,
        hookCharge: tax,
        treasuryCapped: false,
        effectivePriceShiftBps: Math.round((1 - 1 / m) * 10_000),
      };
    }
    return { adjusted: opts.baseOut, m, hookCharge: 0, treasuryCapped: false, effectivePriceShiftBps: 0 };
  }

  if (m > 1) {
    const requested = opts.amountIn * (m - 1);
    const paid = Math.min(requested, opts.treasury);
    return {
      adjusted: opts.baseOut + paid,
      m,
      hookCharge: paid,
      treasuryCapped: paid < requested,
      effectivePriceShiftBps: Math.round((paid / Math.max(opts.baseOut, 1)) * 10_000),
    };
  }
  return { adjusted: opts.baseOut, m, hookCharge: 0, treasuryCapped: false, effectivePriceShiftBps: 0 };
}
