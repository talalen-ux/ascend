// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "v4-core/../test/utils/Deployers.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {HookMiner} from "v4-periphery/utils/HookMiner.sol";
import {PoolSwapTest} from "v4-core/../test/utils/PoolSwapTest.sol";

import {AscendHook} from "../src/AscendHook.sol";
import {AscendRouter} from "../src/AscendRouter.sol";
import {Ascend} from "../src/Ascend.sol";

contract AscendHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    AscendHook hook;
    AscendRouter router;
    Ascend ascend;
    PoolKey key;
    PoolId id;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        // Deploys PoolManager and the standard test routers.
        deployFreshManagerAndRouters();

        // Mine a salt for the hook permissions and deploy the hook.
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(AscendHook).creationCode,
            abi.encode(manager)
        );
        hook = new AscendHook{salt: salt, value: 0.001 ether}(IPoolManager(address(manager)));
        require(address(hook) == predicted, "salt mismatch");
        ascend = hook.ascend();

        // Build the canonical pool key and initialize the pool.
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(ascend)),
            fee: 0,
            tickSpacing: 60,
            hooks: hook
        });
        manager.initialize(key, 79228162514264337593543950336); // 1.0
        id = key.toId();

        // Router for one-call swaps.
        router = new AscendRouter(IPoolManager(address(manager)), hook);
        router.bind(key);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // -----------------------------------------------------------------
    // bootstrap
    // -----------------------------------------------------------------

    function test_initialState() public view {
        assertEq(ascend.name(), "ascend");
        assertEq(ascend.symbol(), "ascend");
        assertEq(ascend.decimals(), 18);
        assertEq(ascend.totalSupply(), 1e18);
        assertEq(ascend.balanceOf(address(hook)), 1e18);
        assertEq(address(hook).balance, 0.001 ether);
        assertEq(hook.floor(), 1e15); // 0.001 ETH per ascend = 1e15 wei (1e18-scaled)
        assertTrue(hook.isInitialized());
    }

    function test_constructorRequiresExactBootstrap() public {
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );
        (, bytes32 saltZero) =
            HookMiner.find(address(this), flags, type(AscendHook).creationCode, abi.encode(manager));

        vm.expectRevert(AscendHook.WrongBootstrap.selector);
        new AscendHook{salt: saltZero, value: 0}(IPoolManager(address(manager)));

        vm.expectRevert(AscendHook.WrongBootstrap.selector);
        new AscendHook{salt: saltZero, value: 0.0009 ether}(IPoolManager(address(manager)));
    }

    function test_addingLiquidityIsRejected() public {
        vm.expectRevert(AscendHook.LiquidityNotAllowed.selector);
        modifyLiquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120,
                tickUpper: 120,
                liquidityDelta: 1e18,
                salt: bytes32(0)
            }),
            ""
        );
    }

    function test_exactOutputReverts() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert();
        router.buy{value: 1 ether}(0, alice);
        // The router itself uses exact-input (negative amountSpecified); a
        // direct call into PoolManager with positive amountSpecified would
        // hit ExactOutputUnsupported on the hook's beforeSwap.
        // We exercise that path via the swap test router below.

        PoolSwapTest swapTest = new PoolSwapTest(IPoolManager(address(manager)));
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert();
        swapTest.swap{value: 1 ether}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: int256(1 ether), // positive = exact-output
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // -----------------------------------------------------------------
    // monotonicity
    // -----------------------------------------------------------------

    function test_floorRisesOnEveryBuy() public {
        uint256 floorBefore = hook.floor();
        vm.prank(alice);
        router.buy{value: 1 ether}(0, alice);
        assertGt(hook.floor(), floorBefore, "floor did not rise on buy");
    }

    function test_floorRisesOnEverySell() public {
        // Build a position first.
        vm.prank(alice);
        router.buy{value: 1 ether}(0, alice);
        uint256 ascBal = ascend.balanceOf(alice);

        uint256 floorBefore = hook.floor();
        vm.startPrank(alice);
        ascend.approve(address(router), ascBal / 4);
        router.sell(ascBal / 4, 0, alice);
        vm.stopPrank();
        assertGt(hook.floor(), floorBefore, "floor did not rise on sell");
    }

    function test_monotoneUnderRandomSequence() public {
        uint256 floorPrev = hook.floor();
        for (uint256 i = 0; i < 40; i++) {
            uint256 r = uint256(keccak256(abi.encode("rng", i)));
            address actor = (r & 1) == 0 ? alice : bob;
            bool isBuy = (r & 2) == 0;

            if (isBuy) {
                uint256 amount = ((r >> 4) % 3 ether) + 0.01 ether;
                vm.prank(actor);
                router.buy{value: amount}(0, actor);
            } else {
                uint256 bal = ascend.balanceOf(actor);
                if (bal == 0) {
                    vm.prank(actor);
                    router.buy{value: 0.05 ether}(0, actor);
                } else {
                    uint256 amount = ((r >> 4) % bal) + 1;
                    vm.startPrank(actor);
                    ascend.approve(address(router), amount);
                    router.sell(amount, 0, actor);
                    vm.stopPrank();
                }
            }
            uint256 floorNow = hook.floor();
            assertGe(floorNow, floorPrev, "floor decreased");
            floorPrev = floorNow;
        }
    }

    // -----------------------------------------------------------------
    // solvency
    // -----------------------------------------------------------------

    function test_solvencyAfterEveryAction() public {
        for (uint256 i = 0; i < 30; i++) {
            uint256 r = uint256(keccak256(abi.encode("solv", i)));
            address actor = (r & 1) == 0 ? alice : bob;

            if ((r & 2) == 0) {
                vm.prank(actor);
                router.buy{value: ((r >> 4) % 2 ether) + 0.01 ether}(0, actor);
            } else {
                uint256 bal = ascend.balanceOf(actor);
                if (bal > 0) {
                    uint256 amt = ((r >> 4) % bal) + 1;
                    vm.startPrank(actor);
                    ascend.approve(address(router), amt);
                    router.sell(amt, 0, actor);
                    vm.stopPrank();
                }
            }

            uint256 nonBootstrap = ascend.totalSupply() - ascend.balanceOf(address(hook));
            uint256 owedAtFloor = (nonBootstrap * hook.floor()) / 1e18;
            assertGe(address(hook).balance, owedAtFloor, "insolvent vs floor");
        }
    }

    // -----------------------------------------------------------------
    // fee math
    // -----------------------------------------------------------------

    function test_miningFeeIsFivePercent() public {
        (uint256 quoted,) = hook.quoteBuy(1 ether);
        uint256 expectedFee = 0.05 ether;
        (, uint256 fee) = hook.quoteBuy(1 ether);
        assertEq(fee, expectedFee);

        vm.prank(alice);
        uint256 got = router.buy{value: 1 ether}(0, alice);
        assertEq(got, quoted, "router output != quoter");
        assertEq(ascend.balanceOf(alice), got);
    }

    function test_priceIsTwiceFloor() public view {
        // 100% mining premium → price = 2 × floor
        assertEq(hook.price(), 2 * hook.floor(), "price != 2 × floor");
    }

    function test_marketCapIsTwoVaults() public {
        // marketCap = price · supply = 2 · floor · supply = 2 · vault
        vm.prank(alice);
        router.buy{value: 1 ether}(0, alice);
        uint256 expected = 2 * address(hook).balance;
        // marketCap is in wei terms (price/1e18 * supply). After both rebases:
        // marketCap returns price·supply/1e18 wei.
        uint256 mc = hook.marketCap();
        assertApproxEqRel(mc, expected, 1e15); // within 0.1%
    }

    function test_redemptionFeeIsFifteenPercent() public {
        vm.prank(alice);
        router.buy{value: 1 ether}(0, alice);
        uint256 ascBal = ascend.balanceOf(alice);

        (uint256 quoted, uint256 fee) = hook.quoteSell(ascBal);
        uint256 gross = (ascBal * address(hook).balance) / ascend.totalSupply();
        assertEq(fee, (gross * 15) / 100);

        uint256 ethBefore = alice.balance;
        vm.startPrank(alice);
        ascend.approve(address(router), ascBal);
        uint256 ethOut = router.sell(ascBal, 0, alice);
        vm.stopPrank();
        assertEq(ethOut, quoted, "router output != quoter");
        assertEq(alice.balance - ethBefore, ethOut);
    }

    // -----------------------------------------------------------------
    // anyone can swap directly via PoolManager — same price
    // -----------------------------------------------------------------

    function test_directPoolSwapMatchesRouter() public {
        // Two paths must produce identical outputs given identical state.
        // Snapshot, swap via router, restore, swap directly via swapTest.
        uint256 snap = vm.snapshot();

        vm.prank(alice);
        uint256 viaRouter = router.buy{value: 1 ether}(0, alice);

        vm.revertTo(snap);

        PoolSwapTest swapTest = new PoolSwapTest(IPoolManager(address(manager)));
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        BalanceDelta delta = swapTest.swap{value: 1 ether}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        uint256 viaDirect = uint256(uint128(delta.amount1()));
        assertEq(viaRouter, viaDirect, "two paths produced different outputs");
    }
}
