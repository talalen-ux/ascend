// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {AscendHookV3} from "../src/AscendHookV3.sol";
import {AscendRouterV3} from "../src/AscendRouterV3.sol";
import {Ascend} from "../src/Ascend.sol";
import {TileEngine} from "../src/TileEngine.sol";

contract TileEngineClaimTest is Test, Deployers {
    using CurrencyLibrary for Currency;

    AscendHookV3 hook;
    Ascend ascend;
    AscendRouterV3 router;
    TileEngine tile;
    PoolKey poolKey;

    /// @dev Sentinel sqrt price for the no-liquidity pool.
    uint160 constant SENTINEL_SQRT_PRICE = 79228162514264337593543950336;

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
        tile = hook.tileEngine();

        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(ascend)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });
        manager.initialize(poolKey, SENTINEL_SQRT_PRICE);

        router = new AscendRouterV3(IPoolManager(address(manager)), hook);
    }

    /// Find an address whose hash falls in the 68% selection cohort
    /// for the current epoch. Brute-force search; converges fast since
    /// the hit rate is 68%.
    function _findSelectedAddress() internal view returns (address) {
        uint64 epoch = tile.currentEpoch();
        bytes32 seed = tile.epochSeed(epoch);
        require(seed != bytes32(0), "epoch seed unset");
        for (uint160 i = 1; i < 256; i++) {
            address candidate = address(i + 0xC0FFEE);
            uint256 r = uint256(keccak256(abi.encode(seed, candidate)));
            if (r % 10_000 < tile.SELECTION_RATE_BPS()) {
                return candidate;
            }
        }
        revert("no selected address found");
    }

    function test_tileEngineDeployedWithHook() public view {
        assertTrue(address(tile) != address(0), "tile engine not wired");
        assertEq(tile.hook(), address(hook), "tile.hook mismatch");
        assertEq(tile.GRID_SIZE(), 144);
        assertEq(tile.SELECTION_RATE_BPS(), 6800, "selection rate not 68%");
        assertEq(tile.MIN_HOLDING(), 1 ether);
    }

    function test_mintFundsTileEngineAfterSweep() public {
        address user = address(0xA11CE);
        vm.deal(user, 10 ether);

        // Mint to accumulate tile share.
        vm.prank(user, user);
        router.buy{value: 1 ether}(0, user);
        assertGt(hook.tileAccrual(), 0, "tile share not accrued");

        // Sweep routes accrued ETH to TileEngine.depositReward.
        uint256 accruedBefore = hook.tileAccrual();
        hook.sweep();
        assertEq(hook.tileAccrual(), 0, "tile share not flushed");
        assertGt(tile.currentEpochPool(), 0, "tile pool not funded");
        // Pool should equal the accrued amount (modulo any tile burn fee path).
        assertApproxEqAbs(tile.currentEpochPool(), accruedBefore, 1, "pool != accrued");
    }

    function test_epochSeedSetByFirstActivity() public {
        // Genesis epoch — first sweep call should lock the seed.
        uint64 epoch = tile.currentEpoch();
        assertEq(tile.epochSeed(epoch), bytes32(0), "seed pre-set");

        address user = address(0xA11CE);
        vm.deal(user, 10 ether);
        vm.prank(user, user);
        router.buy{value: 1 ether}(0, user);
        hook.sweep();

        assertTrue(tile.epochSeed(epoch) != bytes32(0), "seed not set");
    }

    function test_claimTileFullFlow() public {
        // Step 1: a mint funds the tile pool via the hook's fee split.
        address minter = address(0xA11CE);
        vm.deal(minter, 10 ether);
        vm.prank(minter, minter);
        router.buy{value: 2 ether}(0, minter);
        hook.sweep();
        assertGt(tile.currentEpochPool(), 0, "pool empty after sweep");

        // Step 2: find a wallet that's in today's 68% cohort.
        address claimer = _findSelectedAddress();
        assertTrue(tile.isSelected(claimer, tile.currentEpoch()), "candidate not selected");

        // Step 3: give the claimer the MIN_HOLDING and confirm eligibility.
        vm.prank(minter);
        ascend.transfer(claimer, 1 ether);
        assertTrue(tile.canClaim(claimer), "canClaim false");

        // Step 4: claim a tile. Reward routes through hook.claimReward,
        // minting fresh ascend (not paying ETH).
        uint256 ascendBefore = ascend.balanceOf(claimer);
        uint256 ethBefore = address(claimer).balance;
        uint256 supplyBefore = hook.currentSupply();
        uint256 cumEthBefore = hook.cumulativeEthIn();

        vm.prank(claimer, claimer);
        (uint8 multiplier, uint256 reward) = tile.claimTile(0);

        assertGt(reward, 0, "reward zero");
        assertGe(multiplier, 1);
        assertLe(multiplier, 4);
        // ETH balance unchanged — payout is in ascend, not ETH.
        assertEq(address(claimer).balance, ethBefore, "claimer got raw ETH");
        // Ascend balance grew by the freshly-minted reward share.
        uint256 ascendDelta = ascend.balanceOf(claimer) - ascendBefore;
        assertGt(ascendDelta, 0, "no ascend minted to claimer");
        // Curve advanced by exactly the reward ETH.
        assertEq(hook.cumulativeEthIn() - cumEthBefore, reward, "curve didn't advance by reward");
        // Total supply grew by the minted ascend.
        assertEq(hook.currentSupply() - supplyBefore, ascendDelta, "supply mismatch");
        // The tile is now claimed.
        (address claimedBy,, uint128 reward_) = tile.tileClaim(0, tile.currentEpoch());
        assertEq(claimedBy, claimer);
        assertEq(uint256(reward_), reward);
    }

    function test_claimRevertsIfNotSelected() public {
        // Fund the pool.
        address minter = address(0xA11CE);
        vm.deal(minter, 5 ether);
        vm.prank(minter, minter);
        router.buy{value: 1 ether}(0, minter);
        hook.sweep();

        // Brute-force find a NOT-selected address.
        uint64 epoch = tile.currentEpoch();
        bytes32 seed = tile.epochSeed(epoch);
        require(seed != bytes32(0), "seed unset");
        address unlucky;
        for (uint160 i = 1; i < 1_000; i++) {
            address candidate = address(i + 0xDEADBEEF);
            uint256 r = uint256(keccak256(abi.encode(seed, candidate)));
            if (r % 10_000 >= tile.SELECTION_RATE_BPS()) {
                unlucky = candidate;
                break;
            }
        }
        require(unlucky != address(0), "no unlucky address");

        // Give them ascend so they pass the holding check.
        vm.prank(minter);
        ascend.transfer(unlucky, 1 ether);
        assertFalse(tile.canClaim(unlucky), "canClaim should be false");

        vm.prank(unlucky, unlucky);
        vm.expectRevert(TileEngine.NotSelectedThisEpoch.selector);
        tile.claimTile(0);
    }

    function test_claimRevertsIfBelowMinHolding() public {
        // Fund the pool.
        address minter = address(0xA11CE);
        vm.deal(minter, 5 ether);
        vm.prank(minter, minter);
        router.buy{value: 1 ether}(0, minter);
        hook.sweep();

        address poorClaimer = _findSelectedAddress();
        // No ascend transferred to them.
        assertEq(ascend.balanceOf(poorClaimer), 0);
        assertFalse(tile.canClaim(poorClaimer), "canClaim should be false");

        vm.prank(poorClaimer, poorClaimer);
        vm.expectRevert(TileEngine.InsufficientHoldings.selector);
        tile.claimTile(0);
    }

    function test_cannotClaimTwiceInSameEpoch() public {
        address minter = address(0xA11CE);
        vm.deal(minter, 5 ether);
        vm.prank(minter, minter);
        router.buy{value: 2 ether}(0, minter);
        hook.sweep();

        address claimer = _findSelectedAddress();
        vm.prank(minter);
        ascend.transfer(claimer, 1 ether);

        vm.prank(claimer, claimer);
        tile.claimTile(0);

        // Second claim same epoch — reverts.
        vm.prank(claimer, claimer);
        vm.expectRevert(TileEngine.AlreadyClaimedThisEpoch.selector);
        tile.claimTile(1);
    }

    function test_cannotDoubleClaimSameTile() public {
        address minter = address(0xA11CE);
        vm.deal(minter, 5 ether);
        vm.prank(minter, minter);
        router.buy{value: 2 ether}(0, minter);
        hook.sweep();

        // Two independently selected claimers.
        address c1 = _findSelectedAddress();
        // Find a second selected address by varying the offset.
        address c2;
        uint64 epoch = tile.currentEpoch();
        bytes32 seed = tile.epochSeed(epoch);
        for (uint160 i = 1; i < 256; i++) {
            address candidate = address(i + 0xBADBEEF);
            if (candidate == c1) continue;
            uint256 r = uint256(keccak256(abi.encode(seed, candidate)));
            if (r % 10_000 < tile.SELECTION_RATE_BPS()) {
                c2 = candidate;
                break;
            }
        }
        require(c2 != address(0), "no second selected address");

        vm.prank(minter);
        ascend.transfer(c1, 1 ether);
        vm.prank(minter);
        ascend.transfer(c2, 1 ether);

        vm.prank(c1, c1);
        tile.claimTile(7);

        vm.prank(c2, c2);
        vm.expectRevert(TileEngine.TileAlreadyClaimed.selector);
        tile.claimTile(7);
    }

    function test_multiplierIsInRangeOneToFour() public {
        address minter = address(0xA11CE);
        vm.deal(minter, 5 ether);
        vm.prank(minter, minter);
        router.buy{value: 2 ether}(0, minter);
        hook.sweep();

        address claimer = _findSelectedAddress();
        vm.prank(minter);
        ascend.transfer(claimer, 1 ether);

        vm.prank(claimer, claimer);
        (uint8 mult, ) = tile.claimTile(42);
        assertGe(mult, 1, "multiplier < 1");
        assertLe(mult, 4, "multiplier > 4");
    }
}
