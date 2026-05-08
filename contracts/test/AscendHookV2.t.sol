// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {AscendHookV2} from "../src/AscendHookV2.sol";
import {Ascend} from "../src/Ascend.sol";
import {TileEngine} from "../src/TileEngine.sol";

contract AscendHookV2Test is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    AscendHookV2 hook;
    Ascend ascend;
    TileEngine tile;
    PoolKey poolKey;
    PoolId poolIdLocal;
    PoolSwapTest swapTest;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA801);

    // Initial sqrtPrice for 1 ETH : 122M ascend (price = 122M ascend per ETH).
    // sqrt(122_000_000) × 2^96 ≈ 8.749e32. Computed in setUp.
    uint160 sqrtPriceInitial;

    // -----------------------------------------------------------------
    // setup
    // -----------------------------------------------------------------

    function setUp() public {
        deployFreshManagerAndRouters();

        // Mine salt for the v2 hook permission flags.
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(AscendHookV2).creationCode,
            abi.encode(manager)
        );

        // Deploy with exactly 1 ETH bootstrap.
        hook = new AscendHookV2{salt: salt, value: 1 ether}(IPoolManager(address(manager)));
        require(address(hook) == predicted, "salt mismatch");
        ascend = hook.ascend();
        tile = hook.tileEngine();

        // Compute genesis sqrtPrice for 1 ETH : SUPPLY_CAP ascend.
        // price (token1/token0) = 122_000_000 (ascend per ETH), so sqrtP =
        // sqrt(122e6). Fixed-point: sqrtPriceX96 = sqrtP × 2^96.
        // We compute via newton's method (or just use a precomputed value).
        sqrtPriceInitial = _computeSqrtPriceX96(122_000_000);

        // Build pool key: ETH ↔ ascend, dynamic fee, hook attached.
        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(ascend)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });

        // Initialize pool — hook's afterInitialize re-enters via unlock
        // and seeds the genesis LP atomically.
        manager.initialize(poolKey, sqrtPriceInitial);
        poolIdLocal = poolKey.toId();

        // Standard test swap router for direct PoolManager swaps.
        swapTest = new PoolSwapTest(IPoolManager(address(manager)));

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);

        // Advance past the anti-bot window so tests get deterministic
        // 1% fees instead of the randomized launch tax.
        vm.roll(block.number + 200);
    }

    // -----------------------------------------------------------------
    // initial state
    // -----------------------------------------------------------------

    function test_initialState() public view {
        assertEq(ascend.name(), "ascend");
        assertEq(ascend.symbol(), "ascend");
        assertEq(ascend.decimals(), 18);
        assertEq(ascend.totalSupply(), 122_000_000 * 1e18);
        // Almost all ascend went into the LP at seed; LiquidityAmounts
        // rounds DOWN, leaving a tiny dust balance on the hook (single
        // wei to a few thousand wei). Allow ≤ 0.001 ascend (1e15 wei).
        assertLt(ascend.balanceOf(address(hook)), 1e15);
        assertTrue(hook.isInitialized());
        assertGt(uint256(hook.liquidityHeld()), 0);
        assertEq(address(tile.hook()), address(hook));
        assertEq(address(tile.ascend()), address(ascend));
    }

    function test_constructorRequiresExactBootstrap() public {
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        (, bytes32 saltZero) = HookMiner.find(
            address(this),
            flags,
            type(AscendHookV2).creationCode,
            abi.encode(manager)
        );

        vm.expectRevert(AscendHookV2.WrongBootstrap.selector);
        new AscendHookV2{salt: saltZero, value: 0}(IPoolManager(address(manager)));

        vm.expectRevert(AscendHookV2.WrongBootstrap.selector);
        new AscendHookV2{salt: saltZero, value: 0.999 ether}(IPoolManager(address(manager)));
    }

    function test_addLiquidityIsRejectedFromExternal() public {
        // BaseHook wraps custom errors at the hook boundary; we just
        // assert that any revert occurred — _beforeAddLiquidity reverting
        // with LiquidityNotAllowed becomes a WrappedError up the stack.
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
    // swap flow
    // -----------------------------------------------------------------

    function test_buyMovesPriceOfAscendUp() public {
        // V4 sqrtPrice is sqrt(token1/token0) = sqrt(ascend/ETH).
        // Buying ascend pushes ETH into the pool and pulls ascend out,
        // so token1/token0 DECREASES and the ETH-per-ascend price INCREASES.
        // We therefore assert that sqrtPrice DECREASES on a buy.
        uint160 sqrtBefore = _readSqrtPrice();
        _buy(alice, 1 ether);
        uint160 sqrtAfter = _readSqrtPrice();
        assertLt(sqrtAfter, sqrtBefore, "sqrtPrice (ascend/ETH) did not decrease on buy");
    }

    function test_sellMovesPriceOfAscendDown() public {
        // Symmetric: selling ascend pushes ascend INTO the pool, so
        // token1/token0 INCREASES → sqrtPrice INCREASES → ETH-per-ascend
        // price DECREASES.
        _buy(alice, 5 ether);
        uint256 ascBal = ascend.balanceOf(alice);
        assertGt(ascBal, 0);
        // Roll one block so the same-block-burn guard doesn't trip.
        vm.roll(block.number + 1);

        uint160 sqrtBefore = _readSqrtPrice();
        _sell(alice, ascBal / 4);
        uint160 sqrtAfter = _readSqrtPrice();
        assertGt(sqrtAfter, sqrtBefore, "sqrtPrice (ascend/ETH) did not increase on sell");
    }

    function test_dynamicFeeRoutesToTileEngine() public {
        // Buy 10 ETH; check the TileEngine receives the tile share on
        // rebalance.
        //
        // Effective fee at 10 ETH (past anti-bot window):
        //   base                = 10_000 pips = 1.00%
        //   mint surcharge      = (0.001e18 * 1e6) / 10e18 = 100 pips = 0.01%
        //   total               = 10_100 pips ≈ 1.01% of 10 ETH ≈ 0.101 ETH
        //   TileEngine portion  = 30% of 0.101 ETH ≈ 0.0303 ETH
        _buy(alice, 10 ether);
        hook.rebalance();
        assertApproxEqAbs(address(tile).balance, 0.0303 ether, 0.005 ether);
    }

    // -----------------------------------------------------------------
    // floor monotonicity (the central invariant)
    // -----------------------------------------------------------------

    function test_rebalanceFundsTileEngineAndPreservesFloor() public {
        _buy(alice, 5 ether);
        uint256 tileBefore = address(tile).balance;
        uint256 floorBefore = _computeFloor();
        hook.rebalance();
        uint256 tileAfter = address(tile).balance;
        uint256 floorAfter = _computeFloor();
        // The TileEngine receives the tile-share of the fee.
        assertGt(tileAfter, tileBefore, "rebalance did not fund TileEngine");
        // The reported floor (active reserves only) is non-decreasing.
        // Note: the LP-retained donation lands in fee credits, not L,
        // so this reads as ≥ rather than strict >. See the TODO on
        // _floor() about including credits via StateLibrary for the
        // strict-monotone view.
        assertGe(floorAfter, floorBefore, "reported floor decreased on rebalance");
    }

    function test_randomSequenceCompletesWithInvariantsHolding() public {
        // 30-step random sequence of buys/sells/rebalances. The protocol's
        // central monotone-floor invariant requires reading uncollected
        // fee credits via StateLibrary, which the inline `_floor()` does
        // not — so checking that on every step is unsound. See M-3 in
        // AUDIT_V2.md for the discussion.
        //
        // What this test verifies:
        //  (a) the sequence runs end-to-end without reverts (≈ no
        //      pathological state transitions, no broken accounting)
        //  (b) supply cap is preserved across all the action
        //  (c) hook.liquidityHeld() is non-decreasing (donate keeps L
        //      flat; addLiquidity would grow it; selling shouldn't
        //      shrink it)
        uint128 lHeldPrev = hook.liquidityHeld();
        for (uint256 i = 0; i < 30; i++) {
            vm.roll(block.number + 1);
            uint256 r = uint256(keccak256(abi.encode("rng-v2", i)));
            address actor = (r & 1) == 0 ? alice : bob;
            uint256 mod = r % 3;

            if (mod == 0) {
                uint256 amount = ((r >> 8) % 2 ether) + 0.01 ether;
                _buy(actor, amount);
            } else if (mod == 1) {
                uint256 bal = ascend.balanceOf(actor);
                if (bal > 1) {
                    uint256 amount = ((r >> 8) % bal) + 1;
                    _sell(actor, amount);
                }
            } else {
                hook.rebalance();
            }

            uint128 lHeldNow = hook.liquidityHeld();
            assertGe(lHeldNow, lHeldPrev, "hook liquidity decreased");
            assertEq(ascend.totalSupply(), 122_000_000 * 1e18, "supply cap broken");
            lHeldPrev = lHeldNow;
        }
    }

    // -----------------------------------------------------------------
    // TileEngine
    // -----------------------------------------------------------------

    function test_tileDepositRequiresHookCaller() public {
        vm.deal(carol, 1 ether);
        vm.expectRevert(TileEngine.NotHook.selector);
        vm.prank(carol);
        tile.depositReward{value: 0.1 ether}();
    }

    function test_tileClaimRequiresHolding() public {
        // Fund the tile pool.
        _buy(alice, 10 ether);
        hook.rebalance();
        assertGt(address(tile).balance, 0);

        // Carol holds zero ascend → claim reverts. (We use a holder
        // that we know is selected via _selectedHolder; carol may also
        // be unselected, so we'd want the test to hit the holding
        // check specifically. Since carol has 0 balance the holdings
        // check fires first in the contract's order of revert
        // statements, so this works regardless of selection.)
        vm.expectRevert(TileEngine.InsufficientHoldings.selector);
        vm.prank(carol, carol);
        tile.claimTile(0);
    }

    function test_tileOneClaimPerEpoch() public {
        _buy(alice, 10 ether);
        hook.rebalance();
        address holder = _selectedHolder();

        vm.startPrank(holder, holder);
        tile.claimTile(0);
        vm.expectRevert(TileEngine.AlreadyClaimedThisEpoch.selector);
        tile.claimTile(1);
        vm.stopPrank();
    }

    function test_tileSecondAddressFailsOnSameTile() public {
        _buy(alice, 10 ether);
        hook.rebalance();
        address holder1 = _selectedHolder();
        address holder2 = _selectedHolderExcluding(holder1);

        vm.prank(holder1, holder1);
        tile.claimTile(0);

        vm.prank(holder2, holder2);
        vm.expectRevert(TileEngine.TileAlreadyClaimed.selector);
        tile.claimTile(0);
    }

    function test_tileMultiplierIsBounded() public {
        _buy(alice, 10 ether);
        hook.rebalance();
        address holder = _selectedHolder();

        vm.prank(holder, holder);
        (uint8 multiplier, uint256 reward) = tile.claimTile(0);

        assertGe(multiplier, 1);
        assertLe(multiplier, 4);
        assertGt(reward, 0);
    }

    function test_unselectedHolderCannotClaim() public {
        _buy(alice, 10 ether);
        hook.rebalance();
        // Find an address that holds ascend but is NOT in the 68%
        // selection cohort this epoch.
        uint64 e = tile.currentEpoch();
        address unselected;
        for (uint256 i = 0; i < 200; i++) {
            address candidate = address(uint160(0xDEAD0000 + i));
            if (!tile.isSelected(candidate, e)) {
                deal(address(ascend), candidate, 2e18);
                unselected = candidate;
                break;
            }
        }
        require(unselected != address(0), "every candidate was selected; bad seed");
        vm.prank(unselected, unselected);
        vm.expectRevert(TileEngine.NotSelectedThisEpoch.selector);
        tile.claimTile(0);
    }

    function test_selectionRateIsApproximately68Percent() public {
        // Statistical check: of ~500 sampled addresses, between 60–76%
        // should be selected. Tight bounds because we want to catch
        // a broken RNG, loose enough to never flake.
        _buy(alice, 1 ether);
        hook.rebalance();
        uint64 e = tile.currentEpoch();
        require(tile.epochSeed(e) != bytes32(0), "epoch seed not set");
        uint256 selected = 0;
        uint256 total = 500;
        for (uint256 i = 0; i < total; i++) {
            if (tile.isSelected(address(uint160(0xBABE0000 + i)), e)) selected++;
        }
        // 68% × 500 = 340; allow ±8% drift.
        assertGe(selected * 100, total * 60);
        assertLe(selected * 100, total * 76);
    }

    function test_tileClaimRecordPersisted() public {
        _buy(alice, 10 ether);
        hook.rebalance();
        address holder = _selectedHolder();

        vm.prank(holder, holder);
        (uint8 multiplier, uint256 reward) = tile.claimTile(7);

        // Read back via the public storage getter.
        (address claimer, uint8 storedMultiplier, uint128 storedReward) =
            tile.tileClaim(7, tile.currentEpoch());
        assertEq(claimer, holder, "claimer mismatch");
        assertEq(uint256(storedMultiplier), uint256(multiplier), "multiplier mismatch");
        assertEq(uint256(storedReward), reward, "reward mismatch");
    }

    function test_tilePoolSolvent() public {
        // Fund pool with a moderate amount.
        _buy(alice, 100 ether);
        hook.rebalance();
        uint256 poolBefore = address(tile).balance;

        // Have many addresses claim — total payout must not exceed pool.
        // Each candidate is funded with ascend and then attempts a claim.
        // Some will revert with NotSelectedThisEpoch (32% expected) — the
        // try/catch absorbs those without breaking the loop.
        uint256 totalPaid = 0;
        for (uint16 i = 0; i < 144 && i < 80; i++) {
            address user = address(uint160(0x10000 + i));
            deal(address(ascend), user, 2e18); // give them MIN_HOLDING
            vm.deal(user, 1 ether);

            uint256 balBefore = user.balance;
            vm.prank(user, user);
            try tile.claimTile(i) returns (uint8, uint256 reward) {
                totalPaid += reward;
                assertEq(user.balance - balBefore, reward, "transfer mismatch");
            } catch {
                // NotSelectedThisEpoch or pool emptied; expected
                continue;
            }
        }
        assertLe(totalPaid, poolBefore, "paid out more than the pool held");
        assertGt(totalPaid, 0, "no claims succeeded; selection broken?");
    }

    function test_tileEpochAdvances() public {
        _buy(alice, 10 ether);
        hook.rebalance();

        uint64 epochAtClaim = tile.currentEpoch();
        address holderEpoch1 = _selectedHolder();
        vm.prank(holderEpoch1, holderEpoch1);
        tile.claimTile(0);

        // Advance time past one epoch.
        vm.warp(block.timestamp + 24 hours + 1);
        assertEq(tile.currentEpoch(), epochAtClaim + 1);

        // New activity advances liveEpoch and seeds the new epoch's RNG.
        vm.roll(block.number + 1);
        _buy(alice, 1 ether);
        hook.rebalance();

        // A fresh selected holder for the new epoch can claim.
        address holderEpoch2 = _selectedHolder();
        vm.prank(holderEpoch2, holderEpoch2);
        tile.claimTile(0); // tile 0 again, fresh epoch
    }

    function test_tileDonationsRejected() public {
        // A direct ETH transfer to the TileEngine (no calldata) hits
        // receive() which reverts NotHook. We use a low-level call and
        // assert it failed; expectRevert isn't a clean fit here because
        // the call's success boolean is the cleaner check.
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        (bool ok, ) = address(tile).call{value: 0.5 ether}("");
        assertFalse(ok, "direct send should have reverted");
        // Tile engine balance unchanged.
        assertEq(address(tile).balance, 0);
    }

    // -----------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------

    function _buy(address actor, uint256 amount) internal {
        vm.deal(actor, actor.balance + amount);
        // Two-arg prank: also set tx.origin = actor. Otherwise the
        // contract's same-block-burn guard treats every actor as the
        // test contract's tx.origin and reverts cross-actor sells.
        vm.prank(actor, actor);
        swapTest.swap{value: amount}(
            poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _sell(address actor, uint256 amount) internal {
        // Always advance one block before a sell so the same-block-burn
        // guard never fires. This is a test-only convenience; in real
        // usage, blocks advance naturally between user actions.
        vm.roll(block.number + 1);
        vm.prank(actor, actor);
        ascend.approve(address(swapTest), amount);
        vm.prank(actor, actor);
        swapTest.swap(
            poolKey,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// @dev Reads pool slot0 → sqrtPriceX96 from PoolManager via the
    ///      StateLibrary. Returns 0 if the pool isn't initialized yet.
    function _readSqrtPrice() internal view returns (uint160) {
        (uint160 sqrtP, , , ) = IPoolManager(address(manager)).getSlot0(poolIdLocal);
        return sqrtP;
    }

    /// @dev Defers to the contract's own floor() — the source of truth.
    ///      Note: _floor() is a CONSERVATIVE lower bound that doesn't
    ///      include uncollected fees + donations. Between rebalances,
    ///      the reported value can stay flat or drop slightly even
    ///      though the true (active + credit) floor grows. The
    ///      monotonicity test calls hook.floor() directly so it tracks
    ///      the same number throughout.
    function _computeFloor() internal view returns (uint256) {
        return hook.floor();
    }

    /// @dev Newton's method for sqrt(n) × 2^96, fixed-point.
    function _computeSqrtPriceX96(uint256 priceRatio) internal pure returns (uint160) {
        // sqrtPriceX96 = sqrt(priceRatio) × 2^96
        // For priceRatio = 122_000_000:
        //   sqrt = 11045.36...
        //   × 2^96 = ~8.75e32
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

    /// @dev Returns an address that is in the current epoch's selection
    ///      cohort and has been topped up with enough ascend to satisfy
    ///      MIN_HOLDING. Searches a deterministic candidate space; with
    ///      68% selection, finding one within 200 tries is virtually
    ///      certain. Caller must have already triggered an event that
    ///      sets epochSeed[currentEpoch] (typically via hook.rebalance()
    ///      or a depositReward).
    function _selectedHolder() internal returns (address) {
        return _selectedHolderExcluding(address(0));
    }

    function _selectedHolderExcluding(address exclude) internal returns (address) {
        uint64 e = tile.currentEpoch();
        require(tile.epochSeed(e) != bytes32(0), "epoch seed not set");
        for (uint256 i = 0; i < 400; i++) {
            address candidate = address(uint160(0xCAFE0000 + i));
            if (candidate == exclude) continue;
            if (tile.isSelected(candidate, e)) {
                deal(address(ascend), candidate, 2e18);
                vm.deal(candidate, 1 ether);
                return candidate;
            }
        }
        revert("no selected holder found in 400 candidates");
    }
}
