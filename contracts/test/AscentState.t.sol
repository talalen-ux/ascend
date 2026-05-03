// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AscentState} from "../src/lib/AscentState.sol";

contract AscentStateTest is Test {
    using AscentState for AscentState.PoolState;

    function test_decayIsIdempotentOnSameBlock() public pure {
        AscentState.PoolState memory s = _seed();
        AscentState.PoolState memory a = AscentState.projected(s, s.lastBlock);
        AscentState.PoolState memory b = AscentState.projected(s, s.lastBlock);
        assertEq(a.F, b.F);
    }

    function test_flowDecaysTowardZero() public pure {
        AscentState.PoolState memory s = _seed();
        s = AscentState.projected(s, s.lastBlock + 100);
        assertLt(uint256(s.F), 100 ether);
    }

    function test_extremeBlocksDoNotUnderflow() public pure {
        AscentState.PoolState memory s = _seed();
        s = AscentState.projected(s, s.lastBlock + 1_000_000);
        assertEq(s.F, 0);
        assertEq(s.V, 0);
        assertEq(s.D, 0);
        assertEq(s.C, 0);
    }

    function test_velocityDecaysFasterThanFlow() public pure {
        AscentState.PoolState memory s = _seed();
        AscentState.PoolState memory after10 = AscentState.projected(s, s.lastBlock + 10);
        // V loses 50% in 10 blocks (R_V = 5%); F loses 5% (R_F = 0.5%).
        assertLt(uint256(after10.V), uint256(s.V) * 60 / 100);
        assertGt(uint256(after10.F), uint256(s.F) * 90 / 100);
    }

    function _seed() private pure returns (AscentState.PoolState memory s) {
        s.F = 100 ether;
        s.V = 100 ether;
        s.D = 100 ether;
        s.C = 100 ether;
        s.lastBlock = 1000;
    }
}
