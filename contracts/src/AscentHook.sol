// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/utils/BaseHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "v4-core/types/BeforeSwapDelta.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

import {IAscentHook} from "./interfaces/IAscentHook.sol";
import {AscentMath} from "./lib/AscentMath.sol";
import {AscentState} from "./lib/AscentState.sol";

/// @title  AscentHook — stateful Uniswap v4 hook with the SR-TEC multiplier.
///
/// @notice Per-pool state. Buys pay an `(m-1)/m` pressure tax into a
///         per-pool treasury; sells receive an `(m-1)` bonus, capped by
///         the treasury balance to remain solvent. State decays per block
///         multiplicatively. Exact-output swaps revert — see ARCHITECTURE.
contract AscentHook is BaseHook, IAscentHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;
    using SafeCast for int256;
    using AscentState for AscentState.PoolState;

    mapping(PoolId => AscentState.PoolState) internal _state;

    // Transient reentrancy slot (EIP-1153).
    bytes32 private constant REENTRANCY_SLOT =
        keccak256("ascent.hook.reentrancy");

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    // ----------------------------------------------------------------- permissions

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ----------------------------------------------------------------- view API

    function F(PoolId poolId) external view returns (int256) { return _state[poolId].F; }
    function V(PoolId poolId) external view returns (int256) { return _state[poolId].V; }
    function D(PoolId poolId) external view returns (int256) { return _state[poolId].D; }
    function C(PoolId poolId) external view returns (int256) { return _state[poolId].C; }
    function treasury(PoolId poolId) external view returns (uint256) { return _state[poolId].treasury; }
    function lastBlock(PoolId poolId) external view returns (uint64) { return _state[poolId].lastBlock; }

    /// @notice Multiplier projected to the current block (decay applied without writing).
    function computeMultiplier(PoolId poolId) external view returns (uint256) {
        AscentState.PoolState memory s = _state[poolId];
        s = AscentState.projected(s, uint64(block.number));
        return AscentMath.multiplier(s.F, s.V, s.D, s.C);
    }

    /// @notice Full state snapshot, projected. Useful for off-chain quoting.
    function snapshot(PoolId poolId) external view returns (AscentState.PoolState memory) {
        return AscentState.projected(_state[poolId], uint64(block.number));
    }

    // ----------------------------------------------------------------- callbacks

    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24
    ) internal override returns (bytes4) {
        _state[key.toId()].lastBlock = uint64(block.number);
        return BaseHook.afterInitialize.selector;
    }

    function _beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        _enter();

        // Exact-output is rejected outright. Supporting it correctly requires
        // post-swap delta application that v4 does not expose pre-swap, and
        // skipping the tax would create a free arbitrage path.
        if (params.amountSpecified > 0) revert ExactOutputNotSupported();

        PoolId poolId = key.toId();
        AscentState.PoolState storage s = _state[poolId];
        s.decay(uint64(block.number));

        uint256 amountIn = uint256(-params.amountSpecified);
        BeforeSwapDelta delta;

        if (params.zeroForOne) {
            delta = _onBuy(s, key, amountIn, poolId);
        } else {
            delta = _onSell(s, key, amountIn, poolId);
        }

        uint256 m = AscentMath.multiplier(s.F, s.V, s.D, s.C);
        emit StateUpdated(poolId, s.F, s.V, s.D, s.C, m, s.treasury);

        _exit();
        return (BaseHook.beforeSwap.selector, delta, 0);
    }

    // ----------------------------------------------------------------- branches

    function _onBuy(
        AscentState.PoolState storage s,
        PoolKey calldata key,
        uint256 amountIn,
        PoolId poolId
    ) private returns (BeforeSwapDelta) {
        // State updates (CEI: state first, external calls last).
        s.F += int256(amountIn);
        s.V += int256(amountIn);
        s.D += int256(amountIn / 4);
        int256 cRelief = int256(amountIn / 10);
        s.C = s.C > cRelief ? s.C - cRelief : int256(0);

        uint256 m = AscentMath.multiplier(s.F, s.V, s.D, s.C);
        if (m <= 1e18) return BeforeSwapDeltaLibrary.ZERO_DELTA;

        uint256 tax = (amountIn * (m - 1e18)) / m;
        if (tax == 0 || tax >= amountIn) return BeforeSwapDeltaLibrary.ZERO_DELTA;

        s.treasury += tax;
        poolManager.take(key.currency0, address(this), tax);
        emit PressureTaxed(poolId, msg.sender, tax);

        return toBeforeSwapDelta(int128(int256(tax)), int128(0));
    }

    function _onSell(
        AscentState.PoolState storage s,
        PoolKey calldata key,
        uint256 amountIn,
        PoolId poolId
    ) private returns (BeforeSwapDelta) {
        s.F -= int256(amountIn);
        s.V -= int256(amountIn);
        s.C += int256(amountIn);

        uint256 m = AscentMath.multiplier(s.F, s.V, s.D, s.C);
        if (m <= 1e18 || s.treasury == 0) return BeforeSwapDeltaLibrary.ZERO_DELTA;

        // Bonus expressed in currency1 units (the seller's input is currency1).
        // We pay it in currency0 (ETH) sized proportionally to amountIn.
        // This is the symmetric counterpart to the buy-side tax.
        uint256 requested = (amountIn * (m - 1e18)) / 1e18;
        uint256 paid = requested > s.treasury ? s.treasury : requested;
        if (paid == 0) return BeforeSwapDeltaLibrary.ZERO_DELTA;

        s.treasury -= paid;
        poolManager.sync(key.currency0);
        key.currency0.transfer(address(poolManager), paid);
        poolManager.settle();
        emit SellSubsidy(poolId, msg.sender, requested, paid);

        return toBeforeSwapDelta(int128(0), -int128(int256(paid)));
    }

    // ----------------------------------------------------------------- reentrancy

    function _enter() private {
        bytes32 slot = REENTRANCY_SLOT;
        uint256 v;
        assembly { v := tload(slot) }
        if (v != 0) revert Reentrancy();
        assembly { tstore(slot, 1) }
    }

    function _exit() private {
        bytes32 slot = REENTRANCY_SLOT;
        assembly { tstore(slot, 0) }
    }

    receive() external payable {}
}
