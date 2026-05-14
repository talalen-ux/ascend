// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IHookReceiveCallback {
    function onTokenReceive(address recipient, uint256 amount) external;
}

/// @title  ascend — fair-launch ERC-20.
///
/// @notice Lowercase name and symbol. Sole minter and burner is the
///         immutable `hook` address supplied at construction. There is no
///         admin, no pause, no upgrade. The only path that can change
///         the supply of ascend is the hook's swap callback.
///
///         On every receive (mint OR transfer), the token calls back
///         into the hook so it can update per-holder weighted-average
///         acquisition block. This closes the transfer-bypass on the
///         block-age burn penalty.
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

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // Skip on burns (to == 0), zero-value moves, and self-transfers.
        // Self-transfers can't change holdings, so the receive-block
        // weighting would only re-anchor a holder's wRB forward (worse
        // penalty for themselves) — no protocol benefit, just footgun.
        if (to != address(0) && to != from && value > 0) {
            IHookReceiveCallback(hook).onTokenReceive(to, value);
        }
    }
}
