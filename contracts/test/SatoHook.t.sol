// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SatoHook} from "../src/SatoHook.sol";
import {Sato} from "../src/Sato.sol";

contract SatoHookTest is Test {
    SatoHook hook;
    Sato sato;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        hook = new SatoHook();
        sato = hook.sato();
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    // ----------------------------------------------------------------- invariants

    function test_initialState() public view {
        assertEq(sato.totalSupply(), 0);
        assertEq(hook.cumulativeEth(), 0);
        assertEq(address(hook).balance, 0);
        assertEq(sato.issuer(), address(hook));
        assertEq(sato.name(), "sato");
        assertEq(sato.symbol(), "sato");
        assertEq(sato.decimals(), 18);
    }

    function test_buyAndSellRoundTrip_solvent() public {
        vm.prank(alice);
        hook.buy{value: 1 ether}();

        uint256 aliceSato = sato.balanceOf(alice);
        assertGt(aliceSato, 0, "got nothing");

        // Skip a block to clear the same-block guard.
        vm.roll(block.number + 1);

        // Sell everything Alice has.
        vm.prank(alice);
        hook.sell(aliceSato);

        // Alice gets less than 1 ether back due to two 0.3% fees.
        uint256 fees = address(hook).balance;
        assertGt(fees, 0, "no fee accumulated");
        // Round-trip should leave ~0.6% in the contract (one fee on buy, one on sell).
        // 0.997 * 0.997 ≈ 0.994009 → loss ≈ 0.005991
        assertApproxEqRel(fees, 0.005991 ether, 1e15); // 0.1% tolerance
        assertEq(sato.balanceOf(alice), 0);
    }

    function test_perBuyCap() public {
        vm.prank(alice);
        vm.expectRevert(SatoHook.BuyCapExceeded.selector);
        hook.buy{value: 5 ether + 1}();

        vm.prank(alice);
        hook.buy{value: 5 ether}(); // exactly at cap is OK
    }

    function test_zeroBuyReverts() public {
        vm.prank(alice);
        vm.expectRevert(SatoHook.ZeroAmount.selector);
        hook.buy{value: 0}();
    }

    function test_sameBlockSellReverts() public {
        vm.prank(alice);
        hook.buy{value: 1 ether}();
        uint256 bal = sato.balanceOf(alice);

        vm.prank(alice);
        vm.expectRevert(SatoHook.SameBlockSell.selector);
        hook.sell(bal);
    }

    function test_curvePriceMonotone() public {
        uint256 p0 = hook.price();

        vm.prank(alice);
        hook.buy{value: 5 ether}();

        uint256 p1 = hook.price();
        assertGt(p1, p0, "price did not rise");

        vm.roll(block.number + 1);
        vm.prank(alice);
        hook.sell(sato.balanceOf(alice));

        uint256 p2 = hook.price();
        assertLt(p2, p1, "price did not fall after sell");
    }

    function test_onlyHookCanMint() public {
        vm.expectRevert(Sato.NotIssuer.selector);
        sato.mint(alice, 1 ether);
    }

    function test_onlyHookCanBurn() public {
        vm.prank(alice);
        hook.buy{value: 1 ether}();
        vm.expectRevert(Sato.NotIssuer.selector);
        sato.burn(alice, 1);
    }

    function test_receiveBuysSato() public {
        vm.prank(alice);
        (bool ok,) = address(hook).call{value: 1 ether}("");
        assertTrue(ok);
        assertGt(sato.balanceOf(alice), 0);
    }

    function test_solventUnderManyBuysAndSells() public {
        // Random-ish trades, alternating actors. After every sell the contract
        // balance must equal cumulativeEth + accumulated fees.
        uint256 fees;

        for (uint256 i = 0; i < 20; i++) {
            address actor = i % 2 == 0 ? alice : bob;
            uint256 amount = (uint256(keccak256(abi.encode(i))) % 4 ether) + 0.1 ether;

            vm.prank(actor);
            hook.buy{value: amount}();
            uint256 buyFee = (amount * 30) / 10_000;
            fees += buyFee;

            vm.roll(block.number + 1);

            uint256 actorSato = sato.balanceOf(actor);
            uint256 toSell = actorSato / 3;
            if (toSell == 0) continue;

            (uint256 ethOut, uint256 sellFee) = hook.quoteSell(toSell);

            vm.prank(actor);
            hook.sell(toSell);
            fees += sellFee;

            // Contract balance should equal cumulativeEth + cumulative fees.
            assertEq(
                address(hook).balance,
                hook.cumulativeEth() + fees,
                "solvency invariant broken"
            );

            vm.roll(block.number + 1);
            // silence unused
            ethOut;
        }
    }

    function test_quoteMatchesExecution() public {
        (uint256 quotedOut, uint256 quotedFee) = hook.quoteBuy(2 ether);
        vm.prank(alice);
        hook.buy{value: 2 ether}();
        assertEq(sato.balanceOf(alice), quotedOut);
        // fee paid = 2e18 * 30 / 10000
        assertEq(quotedFee, (2 ether * 30) / 10_000);
    }

    function test_supplyApproachesButNeverReachesCap() public {
        // Pump a lot of ETH and verify supply stays under K.
        vm.deal(alice, 1_000_000 ether);
        for (uint256 i = 0; i < 1000; i++) {
            vm.prank(alice);
            hook.buy{value: 5 ether}();
            vm.roll(block.number + 1);
        }
        uint256 K_18 = hook.K() * 1e18;
        assertLt(sato.totalSupply(), K_18, "supply hit cap");
    }
}
