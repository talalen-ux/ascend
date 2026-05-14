// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {AscendHookV3} from "../src/AscendHookV3.sol";
import {AscendRouterV3} from "../src/AscendRouterV3.sol";

/// @notice Deploy the exponential-curve v3 stack:
///           1. AscendHookV3 (CREATE2 via canonical deployer with mined salt)
///           2. Initialize the (ETH, ascend) V4 pool — no LP needed; the
///              hook handles all swap math via BeforeSwapDelta
///           3. AscendRouterV3
///           4. (optional) Deployer locks position 0 on the curve via a
///              first mint — happens in the same broadcast as deploy so
///              no sniper can wedge between initialize and this mint.
///              Controlled by DEPLOYER_FIRST_MINT_ETH (in wei). Default 0
///              (no first mint). Combine with Flashbots Protect RPC for
///              real protection — see scripts/deploy-mainnet.sh.
///
///         Required env vars:
///           PRIVATE_KEY                 deployer key
///           POOL_MANAGER                canonical V4 PoolManager
///         Optional env vars:
///           DEPLOYER_FIRST_MINT_ETH     wei to mint from deployer as
///                                       last step of deploy (e.g.,
///                                       10_000_000_000_000_000 = 0.01 ETH)
contract DeployV3 is Script {
    using PoolIdLibrary for PoolKey;

    /// @notice Foundry's canonical CREATE2 deployer proxy. Forge routes
    ///         `new X{salt: ...}` through this when broadcasting from a
    ///         script — same address on every chain.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @notice Sentinel sqrtPriceX96 for the no-liquidity pool. The AMM
    ///         math never runs (BeforeSwapDelta covers every swap); this
    ///         value just needs to satisfy V4's initialize bounds.
    ///         2^96 = price 1.0 (corresponds to tick 0).
    uint160 internal constant SENTINEL_SQRT_PRICE = 79228162514264337593543950336;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 firstMintWei = vm.envOr("DEPLOYER_FIRST_MINT_ETH", uint256(0));
        address deployerAddr = vm.addr(pk);

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        (address predictedHook, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(AscendHookV3).creationCode,
            abi.encode(poolManager)
        );
        console2.log("predicted hook :", predictedHook);

        vm.startBroadcast(pk);
        AscendHookV3 hook = new AscendHookV3{salt: salt}(poolManager);
        require(address(hook) == predictedHook, "hook address mismatch");

        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(hook.ascend())),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolManager.initialize(key, SENTINEL_SQRT_PRICE);

        AscendRouterV3 router = new AscendRouterV3(poolManager, hook);

        // Optional sniper defence — lock position 0 on the curve as the
        // last step of the deploy broadcast. All four txs (hook deploy,
        // pool init, router deploy, first mint) come from the same
        // deployer wallet with sequential nonces, so they MUST land in
        // order from this account. Combined with Flashbots Protect on
        // the RPC, snipers can't see the initialize tx until it's
        // already mined, and they can't insert anything before the
        // first-mint tx because the deployer's nonce sequence is fixed.
        uint256 firstMintAmount;
        if (firstMintWei > 0) {
            firstMintAmount = router.buy{value: firstMintWei}(0, deployerAddr);
        }
        vm.stopBroadcast();

        console2.log("AscendHookV3  :", address(hook));
        console2.log("ascend        :", address(hook.ascend()));
        console2.log("TileEngine    :", address(hook.tileEngine()));
        console2.log("AscendRouterV3:", address(router));
        if (firstMintWei > 0) {
            console2.log("deployer first mint ETH:");
            console2.logUint(firstMintWei);
            console2.log("deployer first mint ASCEND:");
            console2.logUint(firstMintAmount);
        }
        console2.log("currentSupply :");
        console2.logUint(hook.currentSupply());
        console2.log("cumEthIn      :");
        console2.logUint(hook.cumulativeEthIn());
        console2.log("PoolId        :");
        console2.logBytes32(PoolId.unwrap(key.toId()));
    }
}
