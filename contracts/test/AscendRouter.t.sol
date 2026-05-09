// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {AscendHookV2} from "../src/AscendHookV2.sol";
import {AscendRouter} from "../src/AscendRouter.sol";
import {Ascend} from "../src/Ascend.sol";

contract AscendRouterTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    AscendHookV2 hook;
    Ascend ascend;
    AscendRouter router;
    PoolKey poolKey;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        deployFreshManagerAndRouters();

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
        );
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this), flags, type(AscendHookV2).creationCode, abi.encode(manager)
        );

        hook = new AscendHookV2{salt: salt, value: 1 ether}(IPoolManager(address(manager)));
        require(address(hook) == predicted, "salt mismatch");
        ascend = hook.ascend();

        uint160 sqrtPriceInitial = _computeSqrtPriceX96(122_000_000);
        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(ascend)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });
        manager.initialize(poolKey, sqrtPriceInitial);

        router = new AscendRouter(IPoolManager(address(manager)), hook);

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);

        // Past anti-bot window so fees are deterministic 1%.
        vm.roll(block.number + 200);
    }

    // -----------------------------------------------------------------
    // happy paths
    // -----------------------------------------------------------------

    function test_buyViaRouterMintsAscendToRecipient() public {
        uint256 ascBefore = ascend.balanceOf(alice);
        vm.prank(alice, alice);
        uint256 out = router.buy{value: 1 ether}(0, alice);
        assertGt(out, 0, "buy returned zero");
        assertEq(ascend.balanceOf(alice) - ascBefore, out, "alice did not receive the reported amount");
        assertGt(ascend.balanceOf(alice), 0, "alice has no ascend");
    }

    function test_sellViaRouterReturnsEth() public {
        // Buy first so alice has ascend to sell.
        vm.prank(alice, alice);
        router.buy{value: 5 ether}(0, alice);
        uint256 ascBal = ascend.balanceOf(alice);
        assertGt(ascBal, 0);

        // Roll forward — same-block-burn guard.
        vm.roll(block.number + 1);

        vm.prank(alice, alice);
        ascend.approve(address(router), ascBal / 4);

        uint256 ethBefore = alice.balance;
        vm.prank(alice, alice);
        uint256 ethOut = router.sell(ascBal / 4, 0, alice);
        assertGt(ethOut, 0, "sell returned zero");
        assertEq(alice.balance - ethBefore, ethOut, "alice did not receive the reported eth");
    }

    function test_recipientCanDifferFromCaller() public {
        // bob pays, alice receives.
        uint256 aliceBefore = ascend.balanceOf(alice);
        vm.prank(bob, bob);
        router.buy{value: 1 ether}(0, alice);
        assertGt(ascend.balanceOf(alice), aliceBefore, "alice did not receive ascend");
        assertEq(ascend.balanceOf(bob), 0, "bob received ascend (should have gone to alice)");
    }

    // -----------------------------------------------------------------
    // slippage
    // -----------------------------------------------------------------

    function test_buyRevertsWhenMinOutNotMet() public {
        // Set minOut to 1 trillion ascend — unreachable for a 1 ETH swap.
        uint256 unreachable = 1_000_000_000_000 * 1e18;
        vm.prank(alice, alice);
        vm.expectRevert();
        router.buy{value: 1 ether}(unreachable, alice);
    }

    function test_sellRevertsWhenMinOutNotMet() public {
        vm.prank(alice, alice);
        router.buy{value: 1 ether}(0, alice);
        uint256 ascBal = ascend.balanceOf(alice);
        vm.roll(block.number + 1);

        vm.prank(alice, alice);
        ascend.approve(address(router), ascBal);

        // Expect 1000 ETH back from selling alice's bag — wildly unreachable.
        vm.prank(alice, alice);
        vm.expectRevert();
        router.sell(ascBal, 1_000 ether, alice);
    }

    // -----------------------------------------------------------------
    // anti-MEV: same-block-burn guard still fires through router
    // -----------------------------------------------------------------

    function test_sameBlockBurnStillRevertsThroughRouter() public {
        vm.prank(alice, alice);
        router.buy{value: 1 ether}(0, alice);
        uint256 ascBal = ascend.balanceOf(alice);

        // Same block — guard should fire.
        vm.prank(alice, alice);
        ascend.approve(address(router), ascBal);

        vm.prank(alice, alice);
        vm.expectRevert();
        router.sell(ascBal, 0, alice);
    }

    // -----------------------------------------------------------------
    // router holds no funds between transactions
    // -----------------------------------------------------------------

    function test_routerHoldsNoFundsAfterBuy() public {
        vm.prank(alice, alice);
        router.buy{value: 1 ether}(0, alice);
        assertEq(address(router).balance, 0, "router holds eth after buy");
        assertEq(ascend.balanceOf(address(router)), 0, "router holds ascend after buy");
    }

    function test_routerHoldsNoFundsAfterSell() public {
        vm.prank(alice, alice);
        router.buy{value: 5 ether}(0, alice);
        uint256 ascBal = ascend.balanceOf(alice);
        vm.roll(block.number + 1);

        vm.prank(alice, alice);
        ascend.approve(address(router), ascBal / 2);
        vm.prank(alice, alice);
        router.sell(ascBal / 2, 0, alice);

        assertEq(address(router).balance, 0, "router holds eth after sell");
        assertEq(ascend.balanceOf(address(router)), 0, "router holds ascend after sell");
    }

    // -----------------------------------------------------------------
    // router rejects accidental ETH
    // -----------------------------------------------------------------

    function test_routerRejectsUnsolicitedEth() public {
        vm.prank(alice, alice);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "router accepted unsolicited eth");
    }

    function test_routerRejectsZeroAmountBuy() public {
        vm.prank(alice, alice);
        vm.expectRevert(AscendRouter.ZeroAmount.selector);
        router.buy{value: 0}(0, alice);
    }

    function test_routerRejectsZeroAmountSell() public {
        vm.prank(alice, alice);
        vm.expectRevert(AscendRouter.ZeroAmount.selector);
        router.sell(0, 0, alice);
    }

    // -----------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------

    function _computeSqrtPriceX96(uint256 priceRatio) internal pure returns (uint160) {
        uint256 s = _isqrt(priceRatio * (1 << 192));
        return uint160(s);
    }

    function _isqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
