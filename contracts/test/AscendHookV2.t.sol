// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "v4-core/../test/utils/Deployers.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {HookMiner} from "v4-periphery/utils/HookMiner.sol";
import {PoolSwapTest} from "v4-core/../test/utils/PoolSwapTest.sol";

import {AscendHookV2} from "../src/AscendHookV2.sol";
import {Ascend} from "../src/Ascend.sol";
import {TileEngine} from "../src/TileEngine.sol";

contract AscendHookV2Test is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    AscendHookV2 hook;
    Ascend ascend;
    TileEngine tile;
    PoolKey key;
    PoolId id;
    PoolSwapTest swapTest;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCAR01);

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
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(ascend)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });

        // Initialize pool — hook's afterInitialize re-enters via unlock
        // and seeds the genesis LP atomically.
        manager.initialize(key, sqrtPriceInitial);
        id = key.toId();

        // Standard test swap router for direct PoolManager swaps.
        swapTest = new PoolSwapTest(IPoolManager(address(manager)));

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);
    }

    // -----------------------------------------------------------------
    // initial state
    // -----------------------------------------------------------------

    function test_initialState() public view {
        assertEq(ascend.name(), "ascend");
        assertEq(ascend.symbol(), "ascend");
        assertEq(ascend.decimals(), 18);
        assertEq(ascend.totalSupply(), 122_000_000 * 1e18);
        assertEq(ascend.balanceOf(address(hook)), 0); // all in LP after seed
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
        vm.expectRevert(AscendHookV2.LiquidityNotAllowed.selector);
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

    // -----------------------------------------------------------------
    // swap flow
    // -----------------------------------------------------------------

    function test_buyMovesPriceUp() public {
        uint160 sqrtBefore = _readSqrtPrice();
        _buy(alice, 1 ether);
        uint160 sqrtAfter = _readSqrtPrice();
        assertGt(sqrtAfter, sqrtBefore, "price did not move up on buy");
    }

    function test_sellMovesPriceDown() public {
        // First fund Alice with ascend via a buy.
        _buy(alice, 5 ether);
        uint256 ascBal = ascend.balanceOf(alice);
        assertGt(ascBal, 0);

        uint160 sqrtBefore = _readSqrtPrice();
        _sell(alice, ascBal / 4);
        uint160 sqrtAfter = _readSqrtPrice();
        assertLt(sqrtAfter, sqrtBefore, "price did not move down on sell");
    }

    function test_dynamicFeeIsFivePercent() public {
        // Buy 10 ETH; check that the LP credited a non-zero fee.
        _buy(alice, 10 ether);
        // Fees are accrued in the position state; rebalance() collects them.
        uint256 hookBalBefore = address(hook).balance;
        hook.rebalance();
        uint256 hookBalAfter = address(hook).balance;
        // After rebalance, hook balance should be ~zero (donated back) but the
        // tile engine should have received its share.
        // The 5% fee on 10 ETH = 0.5 ETH; 1/5 of that = 0.1 ETH to TileEngine.
        assertApproxEqAbs(address(tile).balance, 0.1 ether, 0.01 ether);
    }

    // -----------------------------------------------------------------
    // floor monotonicity (the central invariant)
    // -----------------------------------------------------------------

    function test_rebalanceLiftsFloor() public {
        _buy(alice, 5 ether);
        uint256 floorBefore = _computeFloor();
        hook.rebalance();
        uint256 floorAfter = _computeFloor();
        assertGt(floorAfter, floorBefore, "rebalance did not lift floor");
    }

    function test_floorNeverDecreasesUnderRandomSequence() public {
        // 30-step random sequence of buys/sells/rebalances.
        // Snapshot floor before and after each step; assert non-decreasing.
        uint256 floorPrev = _computeFloor();
        for (uint256 i = 0; i < 30; i++) {
            uint256 r = uint256(keccak256(abi.encode("rng-v2", i)));
            address actor = (r & 1) == 0 ? alice : bob;
            uint256 mod = r % 3;

            if (mod == 0) {
                // buy
                uint256 amount = ((r >> 8) % 2 ether) + 0.01 ether;
                _buy(actor, amount);
            } else if (mod == 1) {
                // sell
                uint256 bal = ascend.balanceOf(actor);
                if (bal == 0) {
                    _buy(actor, 0.1 ether);
                    bal = ascend.balanceOf(actor);
                }
                if (bal > 1) {
                    uint256 amount = ((r >> 8) % bal) + 1;
                    _sell(actor, amount);
                }
            } else {
                // rebalance
                hook.rebalance();
            }

            uint256 floorNow = _computeFloor();
            assertGe(floorNow, floorPrev, "floor decreased");
            floorPrev = floorNow;
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

        // Carol holds zero ascend → claim reverts.
        vm.expectRevert(TileEngine.InsufficientHoldings.selector);
        vm.prank(carol);
        tile.claimTile(0);
    }

    function test_tileOneClaimPerEpoch() public {
        _buy(alice, 10 ether);
        hook.rebalance();

        vm.startPrank(alice);
        tile.claimTile(0);
        vm.expectRevert(TileEngine.AlreadyClaimedThisEpoch.selector);
        tile.claimTile(1);
        vm.stopPrank();
    }

    function test_tileSecondAddressFailsOnSameTile() public {
        _buy(alice, 10 ether);
        _buy(bob, 1 ether);
        hook.rebalance();

        vm.prank(alice);
        tile.claimTile(0);

        vm.prank(bob);
        vm.expectRevert(TileEngine.TileAlreadyClaimed.selector);
        tile.claimTile(0);
    }

    function test_tileMultiplierIsBounded() public {
        _buy(alice, 10 ether);
        hook.rebalance();

        vm.prank(alice);
        (uint8 multiplier, uint256 reward) = tile.claimTile(0);

        assertGe(multiplier, 1);
        assertLe(multiplier, 4);
        assertGt(reward, 0);
    }

    function test_tilePoolSolvent() public {
        // Fund pool with a moderate amount.
        _buy(alice, 100 ether);
        hook.rebalance();
        uint256 poolBefore = address(tile).balance;

        // Have many addresses claim — total payout must not exceed pool.
        uint256 totalPaid = 0;
        for (uint16 i = 0; i < 144 && i < 50; i++) {
            address user = address(uint160(0x100 + i));
            // Give them ascend by buying.
            vm.deal(user, 1 ether);
            _buy(user, 0.1 ether);

            uint256 balBefore = user.balance;
            vm.prank(user);
            try tile.claimTile(i) returns (uint8, uint256 reward) {
                totalPaid += reward;
                assertEq(user.balance - balBefore, reward, "transfer mismatch");
            } catch {
                // Pool emptied or other revert; OK
                break;
            }
        }
        assertLe(totalPaid, poolBefore, "paid out more than the pool held");
    }

    function test_tileEpochAdvances() public {
        _buy(alice, 10 ether);
        hook.rebalance();

        uint64 epochAtClaim = tile.currentEpoch();
        vm.prank(alice);
        tile.claimTile(0);

        // Advance time past one epoch.
        vm.warp(block.timestamp + 24 hours + 1);
        assertEq(tile.currentEpoch(), epochAtClaim + 1);

        // Alice can claim again in new epoch.
        vm.prank(alice);
        tile.claimTile(0); // tile 0 again, fresh epoch
    }

    function test_tileDonationsRejected() public {
        vm.deal(carol, 1 ether);
        vm.expectRevert(TileEngine.NotHook.selector);
        vm.prank(carol);
        (bool ok, ) = address(tile).call{value: 0.5 ether}("");
        // The expectRevert above catches the inner revert; ok will be false.
        assertFalse(ok);
    }

    // -----------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------

    function _buy(address actor, uint256 amount) internal {
        vm.deal(actor, actor.balance + amount);
        vm.prank(actor);
        swapTest.swap{value: amount}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _sell(address actor, uint256 amount) internal {
        vm.startPrank(actor);
        ascend.approve(address(swapTest), amount);
        swapTest.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    /// @dev Reads pool slot0 → sqrtPriceX96. Uses StateLibrary in real V4;
    ///      stubbed here for the test scaffold.
    function _readSqrtPrice() internal view returns (uint160) {
        // In a real run, use:
        //   import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
        //   using StateLibrary for IPoolManager;
        //   (sqrtP,,,) = manager.getSlot0(id);
        // For this scaffold, return a placeholder.
        return sqrtPriceInitial;
    }

    /// @dev Off-chain mirror of `floor = Y_LP / circulating_ascend`.
    ///      Reads pool position state via StateLibrary in real V4. Stubbed
    ///      to a deterministic placeholder for compilation; real
    ///      implementation goes in slice 9.
    function _computeFloor() internal view returns (uint256) {
        // For test purposes: floor proxy = LP's ETH balance / circulating
        uint256 ethInPool = address(manager).balance;
        uint256 circulating = ascend.totalSupply() - ascend.balanceOf(address(hook))
            - _ascendInLp();
        if (circulating == 0) return type(uint256).max;
        return (ethInPool * 1e18) / circulating;
    }

    function _ascendInLp() internal view returns (uint256) {
        // Sum of all ascend held by addresses that aren't holders. In
        // test-time this is approximately PoolManager's balance of
        // currency1.
        return ascend.balanceOf(address(manager));
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
}
