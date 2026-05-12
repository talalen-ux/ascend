// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {AscendHookV3} from "../src/AscendHookV3.sol";
import {AscendRouterV3} from "../src/AscendRouterV3.sol";
import {Ascend} from "../src/Ascend.sol";

contract AscendHookV3Test is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    AscendHookV3 hook;
    Ascend ascend;
    AscendRouterV3 router;
    PoolKey poolKey;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    /// @dev Sentinel sqrt price for the no-liquidity pool. AMM math never
    ///      runs (BeforeSwapDelta covers every swap); the value just needs
    ///      to satisfy V4's initialize bounds.
    uint160 constant SENTINEL_SQRT_PRICE = 79228162514264337593543950336; // = 2^96 = price 1

    function setUp() public {
        deployFreshManagerAndRouters();

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        (address predicted, bytes32 salt) = HookMiner.find(
            address(this), flags, type(AscendHookV3).creationCode, abi.encode(manager)
        );

        hook = new AscendHookV3{salt: salt}(IPoolManager(address(manager)));
        require(address(hook) == predicted, "salt mismatch");
        ascend = hook.ascend();

        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(ascend)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });
        manager.initialize(poolKey, SENTINEL_SQRT_PRICE);

        router = new AscendRouterV3(IPoolManager(address(manager)), hook);

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
    }

    // -----------------------------------------------------------------
    // initial state
    // -----------------------------------------------------------------

    function test_genesisStateIsZero() public view {
        assertEq(ascend.totalSupply(), 0, "total supply not zero at genesis");
        assertEq(hook.currentSupply(), 0, "currentSupply not zero at genesis");
        assertEq(hook.cumulativeEthIn(), 0, "cumEthIn not zero at genesis");
        assertEq(hook.reserveEth(), 0, "reserve not zero at genesis");
        assertTrue(hook.isInitialized());
    }

    function test_addLiquidityIsRejected() public {
        // BaseHook wraps custom errors at the boundary; just expect any revert.
        vm.expectRevert();
        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: -120,
                tickUpper: 120,
                liquidityDelta: 1e18,
                salt: bytes32(0)
            }),
            ""
        );
    }

    // -----------------------------------------------------------------
    // mint
    // -----------------------------------------------------------------

    function test_mintFromGenesis() public {
        // Use 0.05 ETH so we don't push the curve too close to its
        // asymptote (where the per-token burn-floor compounds aggressively
        // and burns become reserve-bound).
        uint256 ethIn = 0.05 ether;
        vm.prank(alice, alice);
        uint256 mintAmount = router.buy{value: ethIn}(0, alice);
        assertGt(mintAmount, 0, "mint returned zero");
        assertEq(ascend.balanceOf(alice), mintAmount, "alice did not receive ascend");

        // Sanity range — exact value depends on S calibration.
        assertGt(mintAmount, 1_000 * 1e18, "mint sanity-low");
        assertLt(mintAmount, 21_000_000 * 1e18, "mint sanity-high");

        assertEq(hook.currentSupply(), mintAmount, "currentSupply mismatch");
        // Reserve = ethIn (held as currency0 claims with PM)
        assertEq(hook.reserveEth(), ethIn, "reserve != ethIn");
    }

    function test_mintAdvancesCurve() public {
        vm.prank(alice, alice);
        uint256 m1 = router.buy{value: 1 ether}(0, alice);
        vm.prank(bob, bob);
        uint256 m2 = router.buy{value: 1 ether}(0, bob);

        // Same ethIn, but second mint gets less because curve has advanced.
        assertLt(m2, m1, "second mint should be smaller");
        assertEq(hook.currentSupply(), m1 + m2);
    }

    function test_mintTooLargeReverts() public {
        vm.prank(alice, alice);
        vm.expectRevert();
        router.buy{value: 6 ether}(0, alice);
    }

    function test_mintZeroReverts() public {
        vm.prank(alice, alice);
        vm.expectRevert();
        router.buy{value: 0}(0, alice);
    }

    // -----------------------------------------------------------------
    // burn
    // -----------------------------------------------------------------

    function test_burnReturnsEth() public {
        // Mint first
        vm.prank(alice, alice);
        uint256 minted = router.buy{value: 0.05 ether}(0, alice);
        assertGt(minted, 0);

        // Roll one block (anti-flash-loan)
        vm.roll(block.number + 1);

        // ~10% of supply — within solvency at S=0.3.
        uint256 burnAmount = minted / 10;
        vm.prank(alice, alice);
        ascend.approve(address(router), burnAmount);

        uint256 ethBefore = alice.balance;
        vm.prank(alice, alice);
        uint256 ethOut = router.sell(burnAmount, 0, alice);
        assertGt(ethOut, 0, "burn returned zero ETH");
        assertEq(alice.balance - ethBefore, ethOut, "alice did not receive ETH");

        // Supply decreased
        assertEq(hook.currentSupply(), minted - burnAmount);
    }

    function test_sameBlockBurnAfterMintReverts() public {
        vm.prank(alice, alice);
        uint256 minted = router.buy{value: 1 ether}(0, alice);
        // Same block: burn should revert
        vm.prank(alice, alice);
        ascend.approve(address(router), minted);

        vm.prank(alice, alice);
        vm.expectRevert();
        router.sell(minted / 2, 0, alice);
    }

    // -----------------------------------------------------------------
    // floor monotone increasing under arbitrary mints (no burns)
    // -----------------------------------------------------------------

    function test_floorIncreasesMonotonically_mintOnly() public {
        uint256[] memory sizes = new uint256[](6);
        sizes[0] = 0.1 ether;
        sizes[1] = 1 ether;
        sizes[2] = 0.5 ether;
        sizes[3] = 2 ether;
        sizes[4] = 3 ether;
        sizes[5] = 1.5 ether;

        uint256 lastFloor = hook.floor();
        for (uint256 i = 0; i < sizes.length; i++) {
            address actor = address(uint160(0xA000 + i));
            vm.deal(actor, sizes[i]);
            vm.prank(actor, actor);
            router.buy{value: sizes[i]}(0, actor);

            uint256 currentFloor = hook.floor();
            assertGe(currentFloor, lastFloor, "floor decreased on mint");
            lastFloor = currentFloor;
        }
    }

    // -----------------------------------------------------------------
    // floor monotone non-decreasing under burns (monotone-floor property).
    // mintedFair stays frozen — burns only shrink currentSupply, so the
    // (mintedFair / currentSupply) correction grows and floor lifts.
    // -----------------------------------------------------------------

    function test_floorNeverDropsUnderBurns() public {
        // Stack supply.
        vm.prank(alice, alice);
        uint256 minted = router.buy{value: 0.05 ether}(0, alice);
        vm.roll(block.number + 1);

        uint256 mFairBefore = hook.mintedFair();
        uint256 cumEthBefore = hook.cumulativeEthIn();
        uint256 lastFloor = hook.floor();

        // Burn many small chunks well within the solvency envelope. The
        // monotone-floor formula can exceed reserve for very large
        // burns (>~30-40% of supply at once); modest churn is fine.
        vm.prank(alice, alice);
        ascend.approve(address(router), minted);

        uint256 chunk = minted / 200; // ~0.5% of supply per burn
        for (uint256 i = 0; i < 8; i++) {
            vm.roll(block.number + 1);
            vm.prank(alice, alice);
            router.sell(chunk, 0, alice);

            uint256 currentFloor = hook.floor();
            assertGe(currentFloor, lastFloor, "floor decreased on burn (monotone invariant violated)");
            lastFloor = currentFloor;

            // mintedFair and cumulativeEthIn must NOT change during burns
            assertEq(hook.mintedFair(), mFairBefore, "mintedFair changed on burn");
            assertEq(hook.cumulativeEthIn(), cumEthBefore, "cumulativeEthIn changed on burn");
        }
    }

    function test_largeBurnSolventUnderCurveTrueBurn() public {
        // With the curve-true burn formula applied to frozen mintedFair,
        // a burn cannot demand more ETH than the mint that created the
        // tokens deposited — by construction. Even a 95% single-tx burn
        // succeeds without tripping InsufficientReserve.
        vm.prank(alice, alice);
        uint256 minted = router.buy{value: 0.05 ether}(0, alice);
        vm.roll(block.number + 1);

        vm.prank(alice, alice);
        ascend.approve(address(router), minted);

        uint256 huge = (minted * 95) / 100;
        uint256 ethBefore = alice.balance;
        vm.prank(alice, alice);
        uint256 ethOut = router.sell(huge, 0, alice);
        assertGt(ethOut, 0, "burn returned zero");
        assertEq(alice.balance - ethBefore, ethOut);
    }

    function test_transferBypassIsClosed() public {
        // Alice mints, transfers all to Carol (a fresh wallet), then Carol
        // tries to burn immediately. Without the per-holder weighted-receive
        // tracker, Carol's `lastMintBlock` would be 0 → age = HUGE → tier-4
        // (100% payout, no penalty). With the fix, Carol's
        // weightedReceiveBlock is the transfer block → age = 0 → tier-1
        // (90% payout) penalty fires.
        address carol = address(0xCA801);
        vm.deal(carol, 1 ether);

        vm.prank(alice, alice);
        uint256 minted = router.buy{value: 0.05 ether}(0, alice);

        vm.prank(alice);
        ascend.transfer(carol, minted);

        assertEq(ascend.balanceOf(carol), minted, "carol didn't receive");
        // Carol's wRB must have been set to the current block by onTokenReceive.
        assertEq(hook.weightedReceiveBlock(carol), block.number, "wrb not set on transfer");

        // Roll forward 1 block so the same-block-burn-after-mint guard
        // doesn't trip (alice's mint was THIS block; carol burning would
        // hit the same-block guard too because tx.origin tracking).
        vm.roll(block.number + 1);

        // Carol approves and burns. She should be in tier-1 (penalty 90%).
        vm.prank(carol, carol);
        ascend.approve(address(router), minted);

        // Sanity: carol's penalty multiplier at age 0 is max (90% payout).
        // Smooth interpolation means age 1 already pays slightly more —
        // assert it sits in the tier-1 segment (≤95%) and grows monotonically.
        uint256 m0 = hook.penaltyMultBps(0);
        uint256 m1 = hook.penaltyMultBps(1);
        assertEq(m0, 9000, "age 0 payout != 90%");
        assertGe(m1, m0, "penalty not monotone");
        assertLe(m1, 9500, "age 1 over tier-1 ceiling");

        uint256 ethBefore = carol.balance;
        vm.prank(carol, carol);
        uint256 ethOut = router.sell((minted * 99) / 100, 0, carol);
        uint256 ethGained = carol.balance - ethBefore;

        // Carol got the full ethOut, but it should be substantially below
        // a no-penalty payout (which would be ~99% of the curve return).
        // The 10% block-age penalty + 1% token burn fee + 0.7% protocol
        // fee should put the payout well under what alice paid (0.05 ETH).
        assertLt(ethOut, 0.045 ether, "no-penalty bypass detected");
        assertEq(ethOut, ethGained, "ethOut and gained mismatch");
    }

    function test_cyclingIsUnprofitable() public {
        // Headline economic property: a mint→burn round-trip strictly
        // LOSES ETH to the protocol (mint surcharge + 0.7% mint fee +
        // 1% token-side burn fee + 0.7% ETH-side burn fee). Cycling can
        // never drain the reserve.
        vm.prank(alice, alice);
        ascend.approve(address(router), type(uint256).max);

        uint256 ethIn = 0.05 ether;

        vm.prank(alice, alice);
        uint256 minted = router.buy{value: ethIn}(0, alice);

        vm.roll(block.number + 1);
        // Burn 99% — can't burn 100% (would trip CurveExhausted).
        uint256 burnAmount = (minted * 99) / 100;
        vm.prank(alice, alice);
        uint256 ethOut = router.sell(burnAmount, 0, alice);

        assertLt(ethOut, ethIn, "cycling is profitable");
    }

    // -----------------------------------------------------------------
    // sweep — burn ascend claims, route tile share
    // -----------------------------------------------------------------

    function test_sweepBurnsClaimedSupply() public {
        // Mint and partially burn
        vm.prank(alice, alice);
        uint256 minted = router.buy{value: 0.05 ether}(0, alice);
        vm.roll(block.number + 1);

        // 5% burn — within solvency.
        uint256 burnAmount = minted / 20;
        vm.prank(alice, alice);
        ascend.approve(address(router), burnAmount);
        vm.prank(alice, alice);
        router.sell(burnAmount, 0, alice);

        // Before sweep: totalSupply still reflects raw mint, ERC-20-side
        // burn hasn't happened yet; the burned tokens are sitting as
        // claim tokens in the hook.
        assertEq(ascend.totalSupply(), minted);

        hook.sweep();

        // After sweep: totalSupply == currentSupply
        assertEq(ascend.totalSupply(), hook.currentSupply());
        assertEq(ascend.totalSupply(), minted - burnAmount);
    }

    function test_sweepRoutesTileShare() public {
        vm.prank(alice, alice);
        router.buy{value: 0.5 ether}(0, alice);

        uint256 tileBefore = address(hook.tileEngine()).balance;
        hook.sweep();
        uint256 tileAfter = address(hook.tileEngine()).balance;

        // 0.2% of 0.5 ETH = 0.001 ETH expected
        assertGt(tileAfter, tileBefore, "tile pool did not grow");
        assertApproxEqAbs(tileAfter - tileBefore, 0.001 ether, 0.0001 ether);
    }

    // -----------------------------------------------------------------
    // quotes
    // -----------------------------------------------------------------

    function test_quoteMintMatchesActual() public {
        uint256 ethIn = 0.5 ether;
        (uint256 quoted, ) = hook.quoteMint(ethIn);

        vm.prank(alice, alice);
        uint256 actual = router.buy{value: ethIn}(0, alice);

        assertEq(actual, quoted, "quote != actual mint");
    }

    function test_quoteBurnMatchesActual() public {
        // Build supply
        vm.prank(alice, alice);
        uint256 minted = router.buy{value: 0.05 ether}(0, alice);
        vm.roll(block.number + 1);

        // Small burn — well within solvency.
        uint256 burnAmount = minted / 100;
        (uint256 quoted, ) = hook.quoteBurn(burnAmount, alice);

        vm.prank(alice, alice);
        ascend.approve(address(router), burnAmount);
        uint256 ethBefore = alice.balance;
        vm.prank(alice, alice);
        uint256 actual = router.sell(burnAmount, 0, alice);

        assertEq(actual, quoted, "burn quote != actual");
        assertEq(alice.balance - ethBefore, actual);
    }
}
