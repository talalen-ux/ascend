// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  AscentState — per-pool state container and lazy decay logic.
///
/// @notice Decay is **multiplicative per block**, not additive. This is more
///         physically meaningful (half-life behaviour) and avoids the "value
///         crashes through zero" artefact the additive scheme has.
///
///             new = old · (1e18 - rate · blocks) / 1e18    (clamped at 0)
///
///         Rates are expressed as 1e18-scaled per-block fractions:
///
///           * R_F = 0.005e18  (0.5% / block, ~138-block half-life)
///           * R_V = 0.05e18   (5% / block,   ~14-block half-life)
///           * R_D = 0.0005e18 (0.05% / block, very slow — depth is reputational)
///           * R_C = 0.01e18   (1% / block,   ~69-block half-life)
///
///         If the elapsed block count is large enough that decay would drive a
///         component below zero (or above zero for negative F/V), we floor
///         the multiplier at 0 — equivalent to "fully decayed".
library AscentState {
    struct PoolState {
        int256 F;
        int256 V;
        int256 D;
        int256 C;
        uint256 treasury;
        uint64 lastBlock;
    }

    int256 internal constant ONE = 1e18;

    int256 internal constant R_F = 0.005e18;
    int256 internal constant R_V = 0.05e18;
    int256 internal constant R_D = 0.0005e18;
    int256 internal constant R_C = 0.01e18;

    /// @notice Apply lazy decay up to `blockNumber`. Idempotent.
    function decay(PoolState storage s, uint64 blockNumber) internal {
        uint64 last = s.lastBlock;
        if (blockNumber <= last) return;
        uint256 dt = uint256(blockNumber - last);
        s.F = _decayOne(s.F, R_F, dt);
        s.V = _decayOne(s.V, R_V, dt);
        s.D = _decayOne(s.D, R_D, dt);
        s.C = _decayOnePositive(s.C, R_C, dt);
        s.lastBlock = blockNumber;
    }

    /// @notice Pure variant for off-chain / quoter use.
    function projected(PoolState memory s, uint64 blockNumber)
        internal
        pure
        returns (PoolState memory)
    {
        if (blockNumber <= s.lastBlock) return s;
        uint256 dt = uint256(blockNumber - s.lastBlock);
        s.F = _decayOne(s.F, R_F, dt);
        s.V = _decayOne(s.V, R_V, dt);
        s.D = _decayOne(s.D, R_D, dt);
        s.C = _decayOnePositive(s.C, R_C, dt);
        s.lastBlock = blockNumber;
        return s;
    }

    function _decayOne(int256 x, int256 ratePerBlock, uint256 blocks) private pure returns (int256) {
        if (x == 0) return 0;
        int256 mult = ONE - ratePerBlock * int256(blocks);
        if (mult <= 0) return 0;
        return (x * mult) / ONE;
    }

    function _decayOnePositive(int256 x, int256 ratePerBlock, uint256 blocks) private pure returns (int256) {
        if (x <= 0) return 0;
        int256 mult = ONE - ratePerBlock * int256(blocks);
        if (mult <= 0) return 0;
        return (x * mult) / ONE;
    }
}
