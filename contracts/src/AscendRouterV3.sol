// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {AscendHookV3} from "./AscendHookV3.sol";
import {Ascend} from "./Ascend.sol";

/// @title  AscendRouter — thin unlock-callback router for the ascend V4 pool.
///
/// @notice Wraps `PoolManager.unlock` + `swap` so EOAs can buy/sell ascend
///         directly. Reads the canonical pool key from `AscendHookV2` once
///         at construction; holds no funds between transactions.
///
///         Buy:    msg.value ETH → ascend, sent to `recipient`
///         Sell:   pulls `ascendIn` from caller (allowance required),
///                 swaps to ETH, sends to `recipient`
///
///         Both paths revert with `InsufficientOutput` if the realised
///         amount-out is below `minOut`.
///
/// @dev    The hook's anti-MEV gates (`tx.origin`-keyed same-block-burn
///         guard, anti-bot launch window) work transparently through any
///         EOA-initiated call chain — the router does not need to do
///         anything special to preserve them.
contract AscendRouterV3 is IUnlockCallback {
    using CurrencyLibrary for Currency;

    enum Side {BUY, SELL}

    IPoolManager public immutable poolManager;
    AscendHookV3 public immutable hook;
    Ascend public immutable ascend;

    Currency public immutable currency0;
    Currency public immutable currency1;
    uint24 public immutable poolFee;
    int24 public immutable poolTickSpacing;
    IHooks public immutable poolHooks;

    error CallerNotPoolManager();
    error InsufficientOutput(uint256 got, uint256 minOut);
    error UnexpectedDelta();
    error ZeroAmount();
    error EthRefundFailed();
    error UnsolicitedETH();

    struct CallbackData {
        Side side;
        address payer;
        address recipient;
        uint256 amount;
        uint256 minOut;
    }

    constructor(IPoolManager _poolManager, AscendHookV3 _hook) {
        poolManager = _poolManager;
        hook = _hook;
        ascend = _hook.ascend();

        (Currency c0, Currency c1, uint24 fee, int24 ts, IHooks h) = _hook.poolKey();
        currency0 = c0;
        currency1 = c1;
        poolFee = fee;
        poolTickSpacing = ts;
        poolHooks = h;
    }

    // -----------------------------------------------------------------
    // public entry points
    // -----------------------------------------------------------------

    function buy(uint256 minOut, address recipient)
        external
        payable
        returns (uint256 ascendOut)
    {
        if (msg.value == 0) revert ZeroAmount();
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    side: Side.BUY,
                    payer: msg.sender,
                    recipient: recipient,
                    amount: msg.value,
                    minOut: minOut
                })
            )
        );
        ascendOut = abi.decode(result, (uint256));
    }

    function sell(uint256 ascendIn, uint256 minOut, address recipient)
        external
        returns (uint256 ethOut)
    {
        if (ascendIn == 0) revert ZeroAmount();
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    side: Side.SELL,
                    payer: msg.sender,
                    recipient: recipient,
                    amount: ascendIn,
                    minOut: minOut
                })
            )
        );
        ethOut = abi.decode(result, (uint256));
    }

    // -----------------------------------------------------------------
    // unlock callback — reentered by PoolManager during buy/sell
    // -----------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert CallerNotPoolManager();

        CallbackData memory cb = abi.decode(data, (CallbackData));
        if (cb.side == Side.BUY) {
            return _doBuy(cb);
        }
        return _doSell(cb);
    }

    // -----------------------------------------------------------------
    // internal swap routines
    // -----------------------------------------------------------------

    function _doBuy(CallbackData memory cb) private returns (bytes memory) {
        BalanceDelta delta = poolManager.swap(
            _poolKey(),
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(cb.amount),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        // ETH → ascend exact-in: we OWE ETH (d0 ≤ 0), we RECEIVE ascend (d1 ≥ 0).
        if (d0 > 0 || d1 < 0) revert UnexpectedDelta();

        uint256 owedEth = uint256(int256(-d0));
        uint256 ascendOut = uint256(int256(d1));
        if (ascendOut < cb.minOut) revert InsufficientOutput(ascendOut, cb.minOut);

        if (owedEth > 0) {
            poolManager.settle{value: owedEth}();
        }
        if (ascendOut > 0) {
            poolManager.take(currency1, cb.recipient, ascendOut);
        }

        // Refund any ETH the swap didn't consume. Exact-input shouldn't
        // leave dust here, but we defend against rounding edges so the
        // router never holds funds between transactions.
        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (bool ok,) = cb.payer.call{value: leftover}("");
            if (!ok) revert EthRefundFailed();
        }

        return abi.encode(ascendOut);
    }

    function _doSell(CallbackData memory cb) private returns (bytes memory) {
        // Pull ascend from payer. OZ ERC-20 reverts on insufficient allowance/balance.
        ascend.transferFrom(cb.payer, address(this), cb.amount);

        BalanceDelta delta = poolManager.swap(
            _poolKey(),
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(cb.amount),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        // ascend → ETH exact-in: we RECEIVE ETH (d0 ≥ 0), we OWE ascend (d1 ≤ 0).
        if (d0 < 0 || d1 > 0) revert UnexpectedDelta();

        uint256 ethOut = uint256(int256(d0));
        uint256 owedAscend = uint256(int256(-d1));
        if (ethOut < cb.minOut) revert InsufficientOutput(ethOut, cb.minOut);

        if (owedAscend > 0) {
            poolManager.sync(currency1);
            ascend.transfer(address(poolManager), owedAscend);
            poolManager.settle();
        }
        if (ethOut > 0) {
            poolManager.take(currency0, cb.recipient, ethOut);
        }

        return abi.encode(ethOut);
    }

    // -----------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: poolFee,
            tickSpacing: poolTickSpacing,
            hooks: poolHooks
        });
    }

    /// @notice Reject any unsolicited ETH. The router holds no balance
    ///         between transactions; the only legitimate inbound ETH is
    ///         `msg.value` on `buy()`, which arrives via the function
    ///         entry — not through `receive`.
    receive() external payable {
        revert UnsolicitedETH();
    }
}
