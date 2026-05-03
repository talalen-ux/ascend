// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply, mint-once ERC-20. No tax, no admin, no upgrade path.
contract AscentToken is ERC20 {
    constructor(address recipient, uint256 supply) ERC20("Ascent", "ASCENT") {
        _mint(recipient, supply);
    }
}
