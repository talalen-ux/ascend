// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title  rise — the token whose floor only goes up.
///
/// @notice Lowercase name and symbol. Sole minter is the engine address
///         supplied at construction; the slot is immutable. There is no
///         admin, no pause, no upgrade, and no external way to mint or
///         burn rise except through the engine's buy/sell paths.
contract Rise is ERC20 {
    address public immutable engine;

    error NotEngine();

    constructor(address _engine) ERC20("rise", "rise") {
        require(_engine != address(0), "engine=0");
        engine = _engine;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != engine) revert NotEngine();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != engine) revert NotEngine();
        _burn(from, amount);
    }
}
