// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ascend} from "./Ascend.sol";

/// @title  AscendEngine — the floor-ratchet AMM.
///
/// @notice One contract. Holds every wei of ETH ever paid in. Buys mint
///         ascend, sells burn it. Both sides trade at the same price — the
///         floor — defined as `reserve / supply`. A 1% fee is taken on
///         buys and a 3% fee on sells, both retained inside the contract
///         as part of the reserve. Because reserves grow faster than
///         supply on every action, the floor is monotonically
///         non-decreasing: it can only stay flat or go up.
///
///         There is no admin, no pause, no upgrade, no withdraw. The
///         counterparty to every holder is the contract itself.
contract AscendEngine {
    /// @notice 1% buy fee, 3% sell fee, retained as backing for the floor.
    uint256 public constant BUY_FEE_BPS = 100;
    uint256 public constant SELL_FEE_BPS = 300;
    uint256 public constant BPS_DENOM = 10_000;

    /// @notice At deploy, this much ETH must be paid in alongside this
    ///         many ascend being permanently locked in the contract. The
    ///         locked ascend can never be sold (the contract has no path
    ///         that lets it sell its own balance), so they act as a
    ///         dust-resistant supply anchor.
    uint256 public constant BOOTSTRAP_ETH = 0.001 ether;
    uint256 public constant BOOTSTRAP_ASCEND = 1e18; // 1 ascend
    uint256 public constant INITIAL_FLOOR = (BOOTSTRAP_ETH * 1e18) / BOOTSTRAP_ASCEND;

    Ascend public immutable ascend;

    event Buy(address indexed buyer, uint256 ethIn, uint256 fee, uint256 ascendOut, uint256 newFloor);
    event Sell(address indexed seller, uint256 ascendIn, uint256 fee, uint256 ethOut, uint256 newFloor);

    error WrongBootstrap();
    error ZeroAmount();
    error TransferFailed();
    error InsufficientSupply();

    constructor() payable {
        if (msg.value != BOOTSTRAP_ETH) revert WrongBootstrap();
        ascend = new Ascend(address(this));
        // Lock the bootstrap supply inside the engine itself. There is no
        // function that lets the engine sell or transfer its own balance,
        // so this ascend is effectively burned for liquidity purposes —
        // it just sets the initial floor at BOOTSTRAP_ETH / BOOTSTRAP_ASCEND.
        ascend.mint(address(this), BOOTSTRAP_ASCEND);
    }

    // ----------------------------------------------------------------- views

    /// @notice ETH per ascend (1e18-scaled). Equal on buy and sell sides.
    function floor() public view returns (uint256) {
        uint256 supply = ascend.totalSupply();
        if (supply == 0) return INITIAL_FLOOR;
        return (address(this).balance * 1e18) / supply;
    }

    function reserve() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Quote a buy. `ascendOut` includes nothing for the fee; `fee` is the
    ///         portion of the input retained as additional backing.
    function quoteBuy(uint256 ethIn) external view returns (uint256 ascendOut, uint256 fee) {
        if (ethIn == 0) return (0, 0);
        fee = (ethIn * BUY_FEE_BPS) / BPS_DENOM;
        uint256 net = ethIn - fee;
        ascendOut = (net * 1e18) / floor();
    }

    /// @notice Quote a sell. `ethOut` is the net to the seller; `fee` is the
    ///         portion of the gross retained as additional backing.
    function quoteSell(uint256 ascendIn) external view returns (uint256 ethOut, uint256 fee) {
        if (ascendIn == 0) return (0, 0);
        uint256 gross = (ascendIn * floor()) / 1e18;
        fee = (gross * SELL_FEE_BPS) / BPS_DENOM;
        ethOut = gross - fee;
    }

    // ----------------------------------------------------------------- buy / sell

    receive() external payable {
        _buy(msg.sender, msg.value);
    }

    function buy() external payable {
        _buy(msg.sender, msg.value);
    }

    function _buy(address to, uint256 ethIn) internal {
        if (ethIn == 0) revert ZeroAmount();

        // Floor BEFORE this buy: msg.value already moved into balance, so
        // strip it back out before computing the price the buyer transacts at.
        uint256 reserveBefore = address(this).balance - ethIn;
        uint256 supplyBefore = ascend.totalSupply();
        uint256 priceBefore = supplyBefore == 0
            ? INITIAL_FLOOR
            : (reserveBefore * 1e18) / supplyBefore;

        uint256 fee = (ethIn * BUY_FEE_BPS) / BPS_DENOM;
        uint256 net = ethIn - fee;
        uint256 ascendOut = (net * 1e18) / priceBefore;

        ascend.mint(to, ascendOut);

        emit Buy(to, ethIn, fee, ascendOut, floor());
    }

    function sell(uint256 ascendIn) external {
        if (ascendIn == 0) revert ZeroAmount();

        uint256 supplyBefore = ascend.totalSupply();
        if (ascendIn >= supplyBefore) revert InsufficientSupply(); // bootstrap ascend is unsellable

        uint256 priceBefore = (address(this).balance * 1e18) / supplyBefore;
        uint256 gross = (ascendIn * priceBefore) / 1e18;
        uint256 fee = (gross * SELL_FEE_BPS) / BPS_DENOM;
        uint256 ethOut = gross - fee;

        ascend.burn(msg.sender, ascendIn);

        (bool ok,) = msg.sender.call{value: ethOut}("");
        if (!ok) revert TransferFailed();

        emit Sell(msg.sender, ascendIn, fee, ethOut, floor());
    }
}
