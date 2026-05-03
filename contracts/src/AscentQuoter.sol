// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";

import {AscentHook} from "./AscentHook.sol";
import {AscentMath} from "./lib/AscentMath.sol";
import {AscentState} from "./lib/AscentState.sol";

/// @title  AscentQuoter — exact off-chain quoting for an Ascent-hooked pool.
///
/// @notice Given a pool key, side and exact-input amount, returns the
///         multiplier, the projected hook adjustment and the user's effective
///         output had the pool been queried at the current block.
///
///         The base AMM quote (`baseOut`) is provided by the caller — typically
///         from the v4 quoter for the underlying pool. This contract layers
///         the hook's price distortion on top, exactly mirroring the hook's
///         on-chain logic so previews never disagree with execution.
contract AscentQuoter {
    using PoolIdLibrary for PoolKey;

    AscentHook public immutable hook;
    IPoolManager public immutable manager;

    constructor(AscentHook _hook, IPoolManager _manager) {
        hook = _hook;
        manager = _manager;
    }

    struct Quote {
        uint256 multiplier;
        uint256 adjustedOut;
        uint256 hookCharge;     // tax (buy) or bonus (sell) in currency0
        bool isBuy;
        bool treasuryCapped;    // true iff sell bonus was reduced below the symmetric value
    }

    /// @notice Quote an exact-input swap including the hook's adjustment.
    /// @param  key       the pool key
    /// @param  zeroForOne true iff the swap is currency0 → currency1 (a buy)
    /// @param  amountIn  exact-input amount (in the input currency)
    /// @param  baseOut   the underlying AMM's quoted output for `amountIn`
    function quoteExactInput(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 baseOut
    ) external view returns (Quote memory q) {
        PoolId poolId = key.toId();
        AscentState.PoolState memory s = hook.snapshot(poolId);

        // Project state forward as if this swap were applied — mirrors
        // AscentHook._onBuy / _onSell.
        if (zeroForOne) {
            s.F += int256(amountIn);
            s.V += int256(amountIn);
            s.D += int256(amountIn / 4);
            int256 cRelief = int256(amountIn / 10);
            s.C = s.C > cRelief ? s.C - cRelief : int256(0);
        } else {
            s.F -= int256(amountIn);
            s.V -= int256(amountIn);
            s.C += int256(amountIn);
        }

        q.isBuy = zeroForOne;
        q.multiplier = AscentMath.multiplier(s.F, s.V, s.D, s.C);

        if (zeroForOne) {
            // Buy: tax is taken on the input side; user receives baseOut * (1 - (m-1)/m) = baseOut/m.
            if (q.multiplier > 1e18) {
                uint256 tax = (amountIn * (q.multiplier - 1e18)) / q.multiplier;
                q.hookCharge = tax;
                q.adjustedOut = (baseOut * 1e18) / q.multiplier;
            } else {
                q.adjustedOut = baseOut;
            }
        } else {
            // Sell: bonus paid in currency0 from treasury, capped.
            uint256 treasuryNow = hook.treasury(poolId);
            uint256 requested = q.multiplier > 1e18
                ? (amountIn * (q.multiplier - 1e18)) / 1e18
                : 0;
            uint256 paid = requested > treasuryNow ? treasuryNow : requested;
            q.hookCharge = paid;
            q.treasuryCapped = paid < requested;
            q.adjustedOut = baseOut + paid;
        }
    }
}
