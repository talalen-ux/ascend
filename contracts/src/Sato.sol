// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title  sato — fair-launch ERC-20.
///
/// @notice Lowercase name and symbol by design. Sole minter is the issuer
///         contract supplied at construction; the issuer slot is immutable.
///         No pause, no blacklist, no upgrade, no admin. The only way new
///         sato comes into existence is through the issuer's bonding curve.
contract Sato is ERC20 {
    address public immutable issuer;

    error NotIssuer();

    constructor(address _issuer) ERC20("sato", "sato") {
        require(_issuer != address(0), "issuer=0");
        issuer = _issuer;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != issuer) revert NotIssuer();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != issuer) revert NotIssuer();
        _burn(from, amount);
    }
}
