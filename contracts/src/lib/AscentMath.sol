// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SD59x18, sd, exp, ln, UNIT, ZERO} from "@prb/math/src/SD59x18.sol";

/// @title  AscentMath — the Symmetric Reflexive Tanh-Exponential Curve (SR-TEC)
///
/// @notice Computes the price multiplier as
///
///             m(F, V, D, C) = exp( α · tanh(z) )
///
///         where
///
///             z = (F + γ·V) / S_F
///               + θ · ln(1 + max(0, D) / S_D)
///               - φ · (C / S_C)^p
///
///         Properties (proven by construction, not by clamping):
///
///         * m(0, 0, 0, 0) = 1                      (neutral)
///         * m ∈ [e^-α, e^+α] for all inputs        (bounded)
///         * m(z) · m(-z) = 1                       (multiplicative symmetry)
///         * smooth (C^∞ in all components)         (no kinks)
///         * derivative w.r.t. F vanishes at large |z| (momentum saturates)
///
///         Strictly dominates the single-state bonding curve
///         `minted(eth) = K · (1 - e^{-eth/S})`:
///
///           1. four orthogonal state channels rather than one,
///           2. velocity term V detects burst vs drift,
///           3. bidirectional response (sells ↦ depression, not just absence of buys),
///           4. naturally bounded, no clamping artefacts,
///           5. multiplicatively symmetric — buying then selling X returns the
///              system to the same multiplier (modulo unrelated decay).
library AscentMath {
    /// @dev α = ln(M_max). 4e18 → m_max ≈ exp(4) ≈ 54.6, m_min ≈ 0.018.
    int256 internal constant ALPHA = 4e18;

    /// @dev Channel normalisation constants (in 1e18-scaled ETH).
    int256 internal constant S_F = 300e18;
    int256 internal constant S_V = 50e18;
    int256 internal constant S_D = 500e18;
    int256 internal constant S_C = 200e18;

    /// @dev Mixing weights (1e18-fixed). γ amplifies velocity vs flow.
    int256 internal constant GAMMA = 2e18;
    int256 internal constant THETA = 1e18;
    int256 internal constant PHI = 1e18;

    /// @dev Compression exponent p (1e18). 1.2 → super-linear sell damping.
    int256 internal constant P_COMPRESSION = 1.2e18;

    /// @dev tanh saturation bound — beyond ±SAT_BOUND we return ±UNIT directly.
    int256 internal constant SAT_BOUND = 12e18;

    // ----------------------------------------------------------------- public API

    /// @notice Compute the multiplier in 1e18 fixed-point.
    /// @dev    Pure; safe to call from view contexts and frontends via static call.
    function multiplier(int256 F, int256 V, int256 D, int256 C) internal pure returns (uint256) {
        SD59x18 z = _composite(F, V, D, C);
        SD59x18 t = _tanh(z);
        SD59x18 m = exp(sd(ALPHA).mul(t));
        int256 mInt = m.unwrap();
        return mInt < 0 ? 0 : uint256(mInt);
    }

    /// @notice Composite z-score; exposed for tests and the off-chain mirror.
    function compositeScore(int256 F, int256 V, int256 D, int256 C) internal pure returns (int256) {
        return _composite(F, V, D, C).unwrap();
    }

    // ----------------------------------------------------------------- internals

    function _composite(int256 F, int256 V, int256 D, int256 C) private pure returns (SD59x18) {
        // (F + γ·V) / S_F  — sd-arithmetic to avoid manual scaling errors
        SD59x18 flowTerm = sd(F).add(sd(GAMMA).mul(sd(V)).div(UNIT)).div(sd(S_F));

        // θ · ln(1 + max(0, D)/S_D)
        SD59x18 depthTerm;
        if (D > 0) {
            SD59x18 inner = UNIT.add(sd(D).div(sd(S_D)));
            depthTerm = sd(THETA).mul(ln(inner)).div(UNIT);
        }

        // φ · (max(0,C) / S_C)^p
        SD59x18 compTerm;
        if (C > 0) {
            SD59x18 cOverS = sd(C).div(sd(S_C));
            // x^p = exp(p · ln(x)) — but only valid for x > 0. We just checked.
            SD59x18 pow = exp(sd(P_COMPRESSION).mul(ln(cOverS)).div(UNIT));
            compTerm = sd(PHI).mul(pow).div(UNIT);
        }

        return flowTerm.add(depthTerm).sub(compTerm);
    }

    /// @dev tanh(x) = (e^{2x} − 1) / (e^{2x} + 1). Saturated for |x| > SAT_BOUND.
    function _tanh(SD59x18 x) private pure returns (SD59x18) {
        int256 xi = x.unwrap();
        if (xi > SAT_BOUND) return UNIT;
        if (xi < -SAT_BOUND) return UNIT.mul(sd(-1e18)).div(UNIT);
        SD59x18 e2x = exp(x.add(x));
        return e2x.sub(UNIT).div(e2x.add(UNIT));
    }
}
