// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sato} from "./Sato.sol";
import {SatoMath} from "./SatoMath.sol";

/// @title  SatoHook — the issuer.
///
/// @notice The sole minter of sato, locked at deployment. Buys mint sato by
///         charging the price function's integral; sells burn sato and pay
///         out the matching wedge of ETH from the contract's balance. Every
///         wei of ETH ever paid in lives here forever — the hook is the
///         counterparty to every holder.
///
///         ETH cannot leave by any path other than a sell. Fees accumulate
///         in this contract permanently and have no withdraw function.
contract SatoHook {
    /// @notice Price scale: ETH "half-life" of the curve. 500 ETH.
    uint256 public constant S = 500 ether;
    /// @notice Asymptotic supply cap. 21 000 000 sato (raw count).
    uint256 public constant K = 21_000_000;
    /// @notice 0.3% fee on both directions, expressed in basis points.
    uint256 public constant FEE_BPS = 30;
    uint256 public constant FEE_DENOM = 10_000;
    /// @notice Per-buy hard cap. 5 ETH.
    uint256 public constant MAX_BUY = 5 ether;

    Sato public immutable sato;

    /// @notice Cumulative post-fee ETH ever paid in. The sole state variable
    ///         that drives the price function. Only ever moves up on buys
    ///         and down on sells.
    uint256 public cumulativeEth;

    /// @notice Per-account guard: selling in the same block as a buy reverts.
    mapping(address => uint256) public lastBuyBlock;

    event Buy(address indexed buyer, uint256 ethPaid, uint256 fee, uint256 satoOut, uint256 cumulativeEth);
    event Sell(address indexed seller, uint256 satoBurned, uint256 fee, uint256 ethOut, uint256 cumulativeEth);

    error ZeroAmount();
    error BuyCapExceeded();
    error SameBlockSell();
    error InsufficientSupply();
    error TransferFailed();

    constructor() {
        sato = new Sato(address(this));
    }

    // ----------------------------------------------------------------- views

    /// @notice Marginal price (ETH per sato, 1e18-scaled).
    function price() external view returns (uint256) {
        return SatoMath.price(cumulativeEth, S, K * 1e18);
    }

    /// @notice Total supply per the deterministic curve (1e18-scaled wei).
    function curveSupply() public view returns (uint256) {
        return SatoMath.mintedForBuy(0, cumulativeEth, S, K * 1e18);
    }

    /// @notice Quote a buy: returns (satoOut, fee). View-only mirror of `buy`.
    function quoteBuy(uint256 ethIn) external view returns (uint256 satoOut, uint256 fee) {
        if (ethIn == 0 || ethIn > MAX_BUY) return (0, 0);
        fee = (ethIn * FEE_BPS) / FEE_DENOM;
        uint256 net = ethIn - fee;
        satoOut = SatoMath.mintedForBuy(cumulativeEth, cumulativeEth + net, S, K * 1e18);
    }

    /// @notice Quote a sell: returns (ethOut, fee). View-only mirror of `sell`.
    function quoteSell(uint256 satoIn) external view returns (uint256 ethOut, uint256 fee) {
        if (satoIn == 0) return (0, 0);
        uint256 supply = curveSupply();
        if (satoIn > supply) return (0, 0);
        uint256 newCumE = SatoMath.ethForSupply(supply - satoIn, S, K * 1e18);
        uint256 gross = cumulativeEth - newCumE;
        fee = (gross * FEE_BPS) / FEE_DENOM;
        ethOut = gross - fee;
    }

    // ----------------------------------------------------------------- buy

    receive() external payable {
        _buy(msg.sender, msg.value);
    }

    function buy() external payable {
        _buy(msg.sender, msg.value);
    }

    function _buy(address to, uint256 ethIn) internal {
        if (ethIn == 0) revert ZeroAmount();
        if (ethIn > MAX_BUY) revert BuyCapExceeded();

        uint256 fee = (ethIn * FEE_BPS) / FEE_DENOM;
        uint256 net = ethIn - fee;

        uint256 cumE = cumulativeEth;
        uint256 newCumE = cumE + net;

        uint256 satoOut = SatoMath.mintedForBuy(cumE, newCumE, S, K * 1e18);
        require(satoOut > 0, "zero out");

        cumulativeEth = newCumE;
        lastBuyBlock[to] = block.number;

        sato.mint(to, satoOut);
        emit Buy(to, ethIn, fee, satoOut, newCumE);
    }

    // ----------------------------------------------------------------- sell

    function sell(uint256 satoIn) external {
        if (satoIn == 0) revert ZeroAmount();
        if (block.number <= lastBuyBlock[msg.sender]) revert SameBlockSell();

        uint256 supply = curveSupply();
        if (satoIn > supply) revert InsufficientSupply();

        uint256 newSupply = supply - satoIn;
        uint256 newCumE = SatoMath.ethForSupply(newSupply, S, K * 1e18);
        uint256 gross = cumulativeEth - newCumE;
        uint256 fee = (gross * FEE_BPS) / FEE_DENOM;
        uint256 ethOut = gross - fee;

        cumulativeEth = newCumE;
        sato.burn(msg.sender, satoIn);

        (bool ok,) = msg.sender.call{value: ethOut}("");
        if (!ok) revert TransferFailed();

        emit Sell(msg.sender, satoIn, fee, ethOut, newCumE);
    }
}
