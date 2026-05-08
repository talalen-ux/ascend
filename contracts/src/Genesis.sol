// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {AscendHookV2} from "./AscendHookV2.sol";
import {Ascend} from "./Ascend.sol";
import {TileEngine} from "./TileEngine.sol";

/// @title  Genesis — atomic deployment of the v2 stack.
///
/// @notice Closes the H-1 init-race finding from `docs/AUDIT_V2.md`.
///         A normal multi-tx deploy sequence (deploy hook, then call
///         `poolManager.initialize`) leaves a window between the two
///         transactions in which an attacker can front-run with a
///         malformed `initialize`. This contract performs both — plus
///         the genesis LP seed (which the hook handles in
///         `afterInitialize`) — within the SAME transaction. After
///         `Genesis` finishes constructing, the protocol is fully
///         live and unforgeable.
///
/// @dev    Constraints baked in by AscendHookV2:
///           - `msg.value` must be EXACTLY `1 ether` (the bootstrap)
///           - the salt must produce a hook address whose low bits
///             encode the required permission flags (mined off-chain
///             via HookMiner, passed in here)
///           - sqrtPriceX96 must correspond to the 1 ETH : 122M ascend
///             ratio (price = 122_000_000 ascend per ETH); the hook
///             does NOT validate this — a wrong sqrtPrice creates dust
///             on the hook
///
///         Usage from a deploy script:
///             new Genesis{value: 1 ether}(
///                 poolManager,
///                 minedSalt,
///                 sqrtPriceX96
///             );
///
///         After construction:
///             genesis.hook()        — the AscendHookV2
///             genesis.ascend()      — the ERC-20
///             genesis.tileEngine()  — the tile-game contract
///             genesis.poolKey()     — the canonical PoolKey
contract Genesis {
    AscendHookV2 public immutable hook;
    Ascend public immutable ascend;
    TileEngine public immutable tileEngine;
    PoolKey public poolKey;

    error WrongBootstrap();
    error SaltMismatch(address predicted, address actual);

    constructor(
        IPoolManager poolManager,
        bytes32 salt,
        uint160 sqrtPriceX96
    ) payable {
        if (msg.value != 1 ether) revert WrongBootstrap();

        // Deploy the hook with the mined salt and the bootstrap value.
        // The hook's constructor in turn deploys the ascend ERC-20 and
        // the TileEngine, mints SUPPLY_CAP ascend to itself, and locks
        // the bootstrap.
        hook = new AscendHookV2{salt: salt, value: 1 ether}(poolManager);
        ascend = hook.ascend();
        tileEngine = hook.tileEngine();

        // Build the canonical pool key. currency0 = ETH, currency1 =
        // ascend, dynamic fee, tickSpacing 60, hook = AscendHookV2.
        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(ascend)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // Initialize the pool. The hook's afterInitialize re-enters
        // PoolManager via unlock and seeds the LP atomically. By the
        // time this constructor returns, the pool is fully funded.
        poolManager.initialize(poolKey, sqrtPriceX96);
    }
}
