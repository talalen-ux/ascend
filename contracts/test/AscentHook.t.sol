// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {AscentHook} from "../src/AscentHook.sol";

/// @notice Unit tests for the multiplier math and decay. Pool integration
///         tests live alongside the v4 deployer fixtures and are not included
///         in this scaffold.
contract AscentHookMathTest is Test {
    AscentHook hook;

    function setUp() public {
        // Hook math is pure of the manager; pass address(0) for unit tests.
        hook = new AscentHook(IPoolManager(address(0)));
    }

    function test_initialMultiplierIsOne() public view {
        assertApproxEqAbs(hook.computeMultiplier(), 1e18, 1e12);
    }

    function test_multiplierGrowsWithF() public {
        // poke F directly via storage so we don't have to fake a swap
        vm.store(address(hook), bytes32(uint256(0)), bytes32(uint256(300 ether)));
        uint256 m = hook.computeMultiplier();
        // exp(1) ≈ 2.718; with no D/C the value should be in that neighbourhood.
        assertGt(m, 2e18);
        assertLt(m, 3e18);
    }

    function test_multiplierClamps() public {
        vm.store(address(hook), bytes32(uint256(0)), bytes32(uint256(10_000 ether)));
        uint256 m = hook.computeMultiplier();
        // Clamped to exp(4) ≈ 54.6 on the exp term; the (1+ln) factor adds more
        // but stays bounded. Assert a sane upper bound.
        assertLt(m, 1000e18);
        assertGt(m, 50e18);
    }
}
