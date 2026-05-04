// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SD59x18, sd, exp, ln, intoUint256, UNIT} from "@prb/math/src/SD59x18.sol";

/// @title  SatoMath — closed-form bonding curve helpers.
///
/// @notice The curve is parameterized by two constants:
///
///             p(E) = (S/K) · e^( E / S )            // marginal price (ETH per sato)
///             N(E) = K · ( 1 - e^( -E / S ) )       // total supply at cumulative ETH E
///
///         where E is the cumulative ETH ever paid in (post-fee), S = 500 ETH and
///         K = 21 000 000 sato. Both functions are monotone, smooth, and naturally
///         bounded: supply approaches K asymptotically; price grows without bound.
///
///         These helpers compute exact buy/sell deltas using PRBMath's signed
///         60.18 fixed-point exp/ln. All inputs are 1e18-scaled wei amounts.
library SatoMath {
    /// @notice Sato issued for a buy that moves cumulative ETH from `eOld` to `eNew`.
    /// @dev    ΔN = K · ( e^(-eOld/S) - e^(-eNew/S) ).
    function mintedForBuy(uint256 eOld, uint256 eNew, uint256 S, uint256 K)
        internal
        pure
        returns (uint256)
    {
        SD59x18 expOld = _expNegRatio(eOld, S);
        SD59x18 expNew = _expNegRatio(eNew, S);
        SD59x18 diff = expOld.sub(expNew);
        if (diff.unwrap() <= 0) return 0;
        // K is a count (raw uint, no implicit decimals here).
        return (K * uint256(diff.unwrap())) / uint256(UNIT.unwrap());
    }

    /// @notice Cumulative ETH that corresponds to a given total supply.
    /// @dev    E = -S · ln( 1 - N/K ). Reverts if N >= K (asymptote).
    function ethForSupply(uint256 N, uint256 S, uint256 K)
        internal
        pure
        returns (uint256)
    {
        if (N == 0) return 0;
        require(N < K, "supply >= K");
        // arg = 1 - N/K, in 1e18 fixed-point.
        int256 ratio = int256((N * uint256(UNIT.unwrap())) / K);
        SD59x18 arg = SD59x18.wrap(int256(uint256(UNIT.unwrap())) - ratio);
        SD59x18 lnArg = ln(arg); // negative
        // E = -S · ln(arg) → positive
        SD59x18 e = SD59x18.wrap(-lnArg.unwrap()).mul(SD59x18.wrap(int256(S)));
        return uint256(e.unwrap()) / uint256(UNIT.unwrap());
    }

    /// @notice Marginal price at cumulative ETH `E`. Returned as ETH-per-sato in 1e18 fixed-point.
    /// @dev    p(E) = (S/K) · e^(E/S).
    function price(uint256 E, uint256 S, uint256 K) internal pure returns (uint256) {
        SD59x18 ratio = _ratio(E, S);
        SD59x18 expR = exp(ratio);
        // p = (S/K) · expR. S and K are raw uint counts.
        // (S * expR_raw / K), then / UNIT to keep 1e18 scale on output.
        // Result is "ETH per sato" expressed as 1e18-scaled.
        uint256 unit = uint256(UNIT.unwrap());
        uint256 num = (S * uint256(expR.unwrap())) / K;
        return num; // already 1e18-scaled because expR is, and S/K is unitless.
        // (silence unused variable)
        // unit;
    }

    // ----------------------------------------------------------------- internal

    function _ratio(uint256 num, uint256 den) private pure returns (SD59x18) {
        // Returns num/den as SD59x18 (1e18 fixed-point).
        if (num == 0) return SD59x18.wrap(0);
        return SD59x18.wrap(int256((num * uint256(UNIT.unwrap())) / den));
    }

    function _expNegRatio(uint256 num, uint256 den) private pure returns (SD59x18) {
        if (num == 0) return UNIT;
        SD59x18 r = _ratio(num, den);
        return exp(SD59x18.wrap(-r.unwrap()));
    }
}
