// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {AscendHook} from "./AscendHook.sol";
import {Ascend} from "./Ascend.sol";

/// @title  AscendRouter — convenience wrapper for one-call ascend swaps via V4.
///
/// @notice Anyone can swap ascend on Uniswap directly through any V4-aware
///         router (Universal Router, dapp aggregators, etc.). This contract
///         exists purely as a gas-efficient single-tx path for the dapp and
///         for users who want a minimal trusted surface.
///
///         Pricing is identical regardless of which router is used: the hook
///         decides the output. This router never touches user funds outside
///         of pulling the input and pushing the output.
contract AscendRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    AscendHook public immutable hook;
    Ascend public immutable ascend;
    PoolKey public poolKey;

    error NotPoolManager();
    error NotInitialized();
    error AlreadyBound();
    error WrongKey();
    error SlippageExceeded();
    error TransferFailed();

    enum Action {
        BUY,
        SELL
    }

    struct Callback {
        Action action;
        address recipient;
        uint256 amountIn;
        uint256 minOut;
    }

    constructor(IPoolManager _poolManager, AscendHook _hook) {
        poolManager = _poolManager;
        hook = _hook;
        ascend = _hook.ascend();
    }

    /// @notice Bind to the canonical pool key. Anyone may call this exactly
    ///         once after the hook + pool are initialized; the parameters are
    ///         then immutable.
    ///
    /// @dev    SECURITY: validates that the key passed in matches the hook's
    ///         canonical pool exactly — same hooks address, same currencies,
    ///         same poolId hash. Without this check a front-runner could bind
    ///         the router to a malicious pool and steal user funds. (audit
    ///         finding C-1).
    function bind(PoolKey calldata key) external {
        if (poolKey.tickSpacing != 0) revert AlreadyBound();
        if (!hook.isInitialized()) revert NotInitialized();
        if (address(key.hooks) != address(hook)) revert WrongKey();
        if (!key.currency0.isAddressZero()) revert WrongKey();
        if (Currency.unwrap(key.currency1) != address(ascend)) revert WrongKey();
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(hook.poolId())) revert WrongKey();
        poolKey = key;
    }

    // -----------------------------------------------------------------
    // user entry points
    // -----------------------------------------------------------------

    /// @notice Buy ascend with native ETH. `minOut` reverts if slippage
    ///         exceeds the user's tolerance (always 0 in practice for this
    ///         hook because it has no MEV-extractable slippage, but kept for
    ///         interface symmetry).
    function buy(uint256 minOut, address recipient) external payable returns (uint256 ascendOut) {
        bytes memory data = abi.encode(
            Callback({action: Action.BUY, recipient: recipient, amountIn: msg.value, minOut: minOut})
        );
        bytes memory ret = poolManager.unlock(data);
        ascendOut = abi.decode(ret, (uint256));
    }

    /// @notice Sell ascend for ETH. The caller must `approve(router, ascendIn)`
    ///         on the ascend token first.
    function sell(uint256 ascendIn, uint256 minOut, address recipient)
        external
        returns (uint256 ethOut)
    {
        // Pull ascend from the caller into the router so the unlock callback
        // can settle it to the PoolManager.
        bool ok = ascend.transferFrom(msg.sender, address(this), ascendIn);
        if (!ok) revert TransferFailed();

        bytes memory data = abi.encode(
            Callback({action: Action.SELL, recipient: recipient, amountIn: ascendIn, minOut: minOut})
        );
        bytes memory ret = poolManager.unlock(data);
        ethOut = abi.decode(ret, (uint256));
    }

    // -----------------------------------------------------------------
    // unlock callback — the swap actually happens here
    // -----------------------------------------------------------------

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Callback memory cb = abi.decode(raw, (Callback));

        if (cb.action == Action.BUY) {
            return abi.encode(_doBuy(cb));
        } else {
            return abi.encode(_doSell(cb));
        }
    }

    function _doBuy(Callback memory cb) private returns (uint256 ascendOut) {
        // ① Pre-settle the input ETH to PoolManager BEFORE calling swap.
        //    The hook's beforeSwap will physically `take` ETH from the
        //    PoolManager; that requires the PM to actually hold it. If we
        //    settled after swap, take would revert with insufficient ETH.
        poolManager.settle{value: cb.amountIn}();

        // ② Run the swap. The hook intercepts entirely, takes the ETH the
        //    router just settled, mints+settles ascend on the output side,
        //    and returns a BeforeSwapDelta that cancels the AMM portion.
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(cb.amountIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        // ③ The router is owed `ascendOut` of currency1; take it directly
        //    to the recipient.
        int128 ascendDelta = delta.amount1();
        if (ascendDelta <= 0) revert SlippageExceeded();
        ascendOut = uint256(uint128(ascendDelta));
        if (ascendOut < cb.minOut) revert SlippageExceeded();
        poolManager.take(poolKey.currency1, cb.recipient, ascendOut);
    }

    function _doSell(Callback memory cb) private returns (uint256 ethOut) {
        // ① Pre-settle the ascend input to PoolManager BEFORE calling swap.
        //    The hook's beforeSwap will `take` ascend from the PM; the PM
        //    must hold it.
        poolManager.sync(poolKey.currency1);
        bool ok = ascend.transfer(address(poolManager), cb.amountIn);
        if (!ok) revert TransferFailed();
        poolManager.settle();

        // ② Run the swap. Hook takes the ascend, burns it, settles ETH
        //    back to PM (out of the hook's own reserve), and returns the
        //    delta that cancels the AMM portion.
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(cb.amountIn),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // ③ Take ETH output to recipient.
        int128 ethDelta = delta.amount0();
        if (ethDelta <= 0) revert SlippageExceeded();
        ethOut = uint256(uint128(ethDelta));
        if (ethOut < cb.minOut) revert SlippageExceeded();
        poolManager.take(poolKey.currency0, cb.recipient, ethOut);
    }

    receive() external payable {
        // Accept ETH only from the PoolManager (never used here, since `take`
        // sends directly to recipient, but defensive).
        if (msg.sender != address(poolManager)) revert TransferFailed();
    }
}
