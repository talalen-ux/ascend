// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {AscentHook} from "../src/AscentHook.sol";
import {IAscentHook} from "../src/interfaces/IAscentHook.sol";
import {HookMiner} from "v4-periphery/utils/HookMiner.sol";

/// @notice End-to-end tests against a live PoolManager.
contract AscentHookIntegrationTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    AscentHook hook;
    PoolKey key;
    PoolId poolId;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        bytes memory creationCode = type(AscentHook).creationCode;
        bytes memory args = abi.encode(IPoolManager(address(manager)));
        (address predicted, bytes32 salt) = HookMiner.find(address(this), flags, creationCode, args);
        hook = new AscentHook{salt: salt}(IPoolManager(address(manager)));
        require(address(hook) == predicted, "miner mismatch");

        (key,) = initPoolAndAddLiquidity(currency0, currency1, hook, 3000, SQRT_PRICE_1_1);
        poolId = key.toId();
    }

    // ----------------------------------------------------------------- buy → tax

    function test_buyAccumulatesTreasuryAsMRises() public {
        // Bootstrap multiplier > 1 by buying enough flow.
        for (uint256 i; i < 5; ++i) {
            _swap(true, 50 ether);
        }
        uint256 m = hook.computeMultiplier(poolId);
        assertGt(m, 1.05e18, "multiplier did not rise");

        uint256 tBefore = hook.treasury(poolId);
        _swap(true, 10 ether);
        uint256 tAfter = hook.treasury(poolId);
        assertGt(tAfter, tBefore, "treasury did not grow on buy");
    }

    // ----------------------------------------------------------------- sell → bonus

    function test_sellPaysFromTreasuryWhenMRises() public {
        // Build pressure
        for (uint256 i; i < 6; ++i) _swap(true, 60 ether);
        uint256 tBefore = hook.treasury(poolId);
        assertGt(tBefore, 0, "treasury empty");

        _swap(false, 5 ether);
        uint256 tAfter = hook.treasury(poolId);
        assertLt(tAfter, tBefore, "treasury did not pay out");
    }

    // ----------------------------------------------------------------- decay

    function test_multiplierDecaysOverBlocks() public {
        for (uint256 i; i < 6; ++i) _swap(true, 60 ether);
        uint256 mHot = hook.computeMultiplier(poolId);

        vm.roll(block.number + 500);
        uint256 mCold = hook.computeMultiplier(poolId);
        assertLt(mCold, mHot, "multiplier did not decay");
    }

    // ----------------------------------------------------------------- exact-output

    function test_exactOutputReverts() public {
        // PoolSwapTest takes amountSpecified directly; positive == exact-output.
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        vm.expectRevert(IAscentHook.ExactOutputNotSupported.selector);
        swapRouter.swap(key, params, settings, "");
    }

    // ----------------------------------------------------------------- helpers

    function _swap(bool zeroForOne, uint256 amountIn) internal {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne
                ? TickMath.MIN_SQRT_PRICE + 1
                : TickMath.MAX_SQRT_PRICE - 1
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        swapRouter.swap(key, params, settings, "");
    }
}
