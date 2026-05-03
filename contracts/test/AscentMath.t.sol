// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AscentMath} from "../src/lib/AscentMath.sol";

contract AscentMathTest is Test {
    // ----------------------------------------------------------------- baseline

    function test_neutralStateMultiplierIsOne() public pure {
        uint256 m = AscentMath.multiplier(0, 0, 0, 0);
        assertApproxEqAbs(m, 1e18, 1e12);
    }

    // ----------------------------------------------------------------- bounds

    function test_multiplierIsBoundedAbove() public pure {
        uint256 m = AscentMath.multiplier(1_000_000 ether, 1_000_000 ether, 1_000_000 ether, 0);
        // exp(α) where α=4 → ~54.6e18
        assertLe(m, 56e18);
        assertGe(m, 50e18);
    }

    function test_multiplierIsBoundedBelow() public pure {
        // Heavy compression with no flow → multiplier should approach exp(-α).
        uint256 m = AscentMath.multiplier(0, 0, 0, 1_000_000 ether);
        assertLe(m, 0.025e18);
        assertGt(m, 0);
    }

    // ----------------------------------------------------------------- symmetry

    function test_multiplicativeSymmetry() public pure {
        // m(F, V, ...) · m(-F, -V, ...) ≈ 1 in the regime where D and C are zero.
        uint256 mPos = AscentMath.multiplier(100 ether, 50 ether, 0, 0);
        uint256 mNeg = AscentMath.multiplier(-100 ether, -50 ether, 0, 0);
        uint256 product = (mPos * mNeg) / 1e18;
        assertApproxEqAbs(product, 1e18, 1e15); // 0.001 tolerance
    }

    // ----------------------------------------------------------------- monotonicity

    function test_multiplierMonotoneInF() public pure {
        uint256 m1 = AscentMath.multiplier(50 ether, 0, 0, 0);
        uint256 m2 = AscentMath.multiplier(100 ether, 0, 0, 0);
        uint256 m3 = AscentMath.multiplier(200 ether, 0, 0, 0);
        assertLt(m1, m2);
        assertLt(m2, m3);
    }

    function test_velocityAmplifiesFlow() public pure {
        // Same F, but with positive V should produce a larger multiplier.
        uint256 mLow = AscentMath.multiplier(100 ether, 0, 0, 0);
        uint256 mHigh = AscentMath.multiplier(100 ether, 100 ether, 0, 0);
        assertGt(mHigh, mLow);
    }

    function test_compressionDamps() public pure {
        uint256 mFree = AscentMath.multiplier(100 ether, 0, 0, 0);
        uint256 mDamped = AscentMath.multiplier(100 ether, 0, 0, 100 ether);
        assertLt(mDamped, mFree);
    }

    // ----------------------------------------------------------------- smoothness

    function test_smallPerturbationsAreSmall() public pure {
        uint256 m1 = AscentMath.multiplier(100 ether, 0, 0, 0);
        uint256 m2 = AscentMath.multiplier(101 ether, 0, 0, 0);
        // 1 ETH on top of 100 ETH F should change m by < 1%.
        uint256 delta = m2 > m1 ? m2 - m1 : m1 - m2;
        assertLt(delta * 100, m1);
    }

    // ----------------------------------------------------------------- fuzz

    function testFuzz_alwaysBounded(int128 f, int128 v, int128 d, int128 c) public pure {
        uint256 m = AscentMath.multiplier(f, v, d, c);
        assertLe(m, 60e18);
        assertGe(m, 0);
    }
}
