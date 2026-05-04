// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RiseEngine} from "../src/RiseEngine.sol";
import {Rise} from "../src/Rise.sol";

contract RiseEngineTest is Test {
    RiseEngine engine;
    Rise rise;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        engine = new RiseEngine{value: 0.001 ether}();
        rise = engine.rise();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ----------------------------------------------------------------- bootstrap

    function test_initialState() public view {
        assertEq(rise.name(), "rise");
        assertEq(rise.symbol(), "rise");
        assertEq(rise.decimals(), 18);
        assertEq(rise.engine(), address(engine));
        assertEq(rise.totalSupply(), 1e18);
        assertEq(rise.balanceOf(address(engine)), 1e18); // bootstrap locked in engine
        assertEq(address(engine).balance, 0.001 ether);
        assertEq(engine.floor(), 1e15); // 0.001 ETH per rise = 1e15 wei/rise (1e18-scaled)
    }

    function test_constructorRequiresExactBootstrap() public {
        vm.expectRevert(RiseEngine.WrongBootstrap.selector);
        new RiseEngine{value: 0}();

        vm.expectRevert(RiseEngine.WrongBootstrap.selector);
        new RiseEngine{value: 0.0009 ether}();

        vm.expectRevert(RiseEngine.WrongBootstrap.selector);
        new RiseEngine{value: 0.0011 ether}();

        // exact bootstrap is fine
        new RiseEngine{value: 0.001 ether}();
    }

    // ----------------------------------------------------------------- monotonicity

    function test_floorRisesOnEveryBuy() public {
        uint256 floorBefore = engine.floor();
        vm.prank(alice);
        engine.buy{value: 1 ether}();
        uint256 floorAfter = engine.floor();
        assertGt(floorAfter, floorBefore, "floor did not rise on buy");
    }

    function test_floorRisesOnEverySell() public {
        // Build up a position first.
        vm.prank(alice);
        engine.buy{value: 1 ether}();

        uint256 floorBefore = engine.floor();
        uint256 aliceBalance = rise.balanceOf(alice);

        vm.prank(alice);
        engine.sell(aliceBalance / 4);

        uint256 floorAfter = engine.floor();
        assertGt(floorAfter, floorBefore, "floor did not rise on sell");
    }

    function test_floorMonotoneUnderRandomSequence() public {
        // Run a long pseudo-random sequence of buys and sells; assert floor
        // is non-decreasing at every single step.
        uint256 floorPrev = engine.floor();
        for (uint256 i = 0; i < 50; i++) {
            uint256 r = uint256(keccak256(abi.encode(i)));
            address actor = (r & 1) == 0 ? alice : bob;
            bool isBuy = (r & 2) == 0;

            if (isBuy) {
                uint256 amount = ((r >> 4) % 5 ether) + 0.01 ether;
                vm.prank(actor);
                engine.buy{value: amount}();
            } else {
                uint256 bal = rise.balanceOf(actor);
                if (bal == 0) {
                    // can't sell; do a tiny buy to keep things moving
                    vm.prank(actor);
                    engine.buy{value: 0.01 ether}();
                } else {
                    uint256 amount = ((r >> 4) % bal) + 1;
                    vm.prank(actor);
                    engine.sell(amount);
                }
            }

            uint256 floorNow = engine.floor();
            assertGe(floorNow, floorPrev, "floor went down");
            floorPrev = floorNow;
        }
    }

    // ----------------------------------------------------------------- math

    function test_buyFeeIsOnePercent() public {
        (uint256 quotedOut, uint256 quotedFee) = engine.quoteBuy(1 ether);
        assertEq(quotedFee, 0.01 ether);

        vm.prank(alice);
        engine.buy{value: 1 ether}();
        assertEq(rise.balanceOf(alice), quotedOut);
    }

    function test_sellFeeIsThreePercent() public {
        vm.prank(alice);
        engine.buy{value: 1 ether}();
        uint256 aliceRise = rise.balanceOf(alice);

        (uint256 quotedOut, uint256 quotedFee) = engine.quoteSell(aliceRise);
        // gross = aliceRise * floor / 1e18; fee = gross * 3 / 100
        uint256 gross = (aliceRise * engine.floor()) / 1e18;
        assertEq(quotedFee, (gross * 3) / 100);

        uint256 ethBefore = alice.balance;
        vm.prank(alice);
        engine.sell(aliceRise);
        assertEq(alice.balance - ethBefore, quotedOut);
    }

    function test_zeroBuyReverts() public {
        vm.prank(alice);
        vm.expectRevert(RiseEngine.ZeroAmount.selector);
        engine.buy{value: 0}();
    }

    function test_zeroSellReverts() public {
        vm.prank(alice);
        vm.expectRevert(RiseEngine.ZeroAmount.selector);
        engine.sell(0);
    }

    function test_cannotSellEntireSupply() public {
        // Even with maximal trading, the bootstrap rise locked in the engine
        // contributes to totalSupply and is not held by any caller. So no
        // caller can ever burn `>= totalSupply`. Specifically: alice cannot
        // burn the bootstrap.
        vm.prank(alice);
        engine.buy{value: 1 ether}();
        uint256 totalSupply = rise.totalSupply();

        vm.prank(alice);
        vm.expectRevert(RiseEngine.InsufficientSupply.selector);
        engine.sell(totalSupply);
    }

    function test_receiveDoesBuy() public {
        vm.prank(alice);
        (bool ok,) = address(engine).call{value: 1 ether}("");
        assertTrue(ok);
        assertGt(rise.balanceOf(alice), 0);
    }

    function test_onlyEngineCanMintOrBurn() public {
        vm.expectRevert(Rise.NotEngine.selector);
        rise.mint(alice, 1 ether);

        vm.expectRevert(Rise.NotEngine.selector);
        rise.burn(alice, 1 ether);
    }

    // ----------------------------------------------------------------- solvency

    function test_solvencyInvariant() public {
        // After any sequence of trades, the engine's ETH balance must be
        // >= floor * (totalSupply - rise.balanceOf(engine)). I.e., the
        // contract can always honor a sell of every non-bootstrap rise at
        // the current floor (modulo the 3% sell fee, which only adds
        // headroom).
        for (uint256 i = 0; i < 30; i++) {
            uint256 r = uint256(keccak256(abi.encode("solv", i)));
            address actor = (r & 1) == 0 ? alice : bob;

            if ((r & 2) == 0) {
                vm.prank(actor);
                engine.buy{value: ((r >> 4) % 3 ether) + 0.01 ether}();
            } else {
                uint256 bal = rise.balanceOf(actor);
                if (bal > 0) {
                    vm.prank(actor);
                    engine.sell(((r >> 4) % bal) + 1);
                }
            }

            uint256 nonBootstrapSupply = rise.totalSupply() - rise.balanceOf(address(engine));
            uint256 owedAtFloor = (nonBootstrapSupply * engine.floor()) / 1e18;
            assertGe(address(engine).balance, owedAtFloor, "insolvent at floor");
        }
    }

    function test_floorTendsTowardInfinityWithRepeatedSells() public {
        // Pump some volume in, then loop sell tiny amounts and watch the
        // floor compound upward.
        vm.prank(alice);
        engine.buy{value: 5 ether}();

        uint256 floor0 = engine.floor();
        for (uint256 i = 0; i < 10; i++) {
            uint256 bal = rise.balanceOf(alice);
            if (bal == 0) break;
            vm.prank(alice);
            engine.sell(bal / 5);
        }
        uint256 floor1 = engine.floor();
        assertGt(floor1, floor0);
    }
}
