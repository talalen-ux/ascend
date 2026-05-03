// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";

interface IAscentHook {
    error ExactOutputNotSupported();
    error Reentrancy();
    error PoolNotConfigured();
    error CurrencyMismatch();

    event StateUpdated(
        PoolId indexed poolId,
        int256 F,
        int256 V,
        int256 D,
        int256 C,
        uint256 multiplier,
        uint256 treasury
    );
    event PressureTaxed(PoolId indexed poolId, address indexed payer, uint256 amount);
    event SellSubsidy(PoolId indexed poolId, address indexed receiver, uint256 requested, uint256 paid);

    function F(PoolId poolId) external view returns (int256);
    function V(PoolId poolId) external view returns (int256);
    function D(PoolId poolId) external view returns (int256);
    function C(PoolId poolId) external view returns (int256);
    function treasury(PoolId poolId) external view returns (uint256);
    function lastBlock(PoolId poolId) external view returns (uint64);
    function computeMultiplier(PoolId poolId) external view returns (uint256);
}
