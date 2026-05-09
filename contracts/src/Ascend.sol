// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title  ascend — fair-launch ERC-20.
///
/// @notice Lowercase name and symbol. Sole minter and burner is the
///         immutable `hook` address supplied at construction. There is no
///         admin, no pause, no upgrade. The only path that can change
///         the supply of ascend is the hook's swap callback.
contract Ascend is ERC20 {
    address public immutable hook;

    error NotHook();
    error ZeroHook();

    constructor(address _hook) ERC20("ascend", "ascend") {
        if (_hook == address(0)) revert ZeroHook();
        hook = _hook;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        _burn(from, amount);
    }
}
