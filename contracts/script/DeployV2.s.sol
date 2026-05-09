// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {AscendHookV2} from "../src/AscendHookV2.sol";
import {Genesis} from "../src/Genesis.sol";

/// @notice One-shot atomic deploy of the v2 stack via the Genesis
///         contract. Mines the CREATE2 salt for AscendHookV2's
///         permission bits, computes the genesis sqrtPriceX96 for the
///         1 ETH : 122M ascend ratio, then deploys Genesis (which in
///         turn deploys the hook + ascend + tile engine, initializes
///         the pool, and seeds the LP — all in one transaction).
///
///         Closes audit finding H-1: there is no race window between
///         deploy and init.
///
///         Required env vars:
///           PRIVATE_KEY    deployer key
///           POOL_MANAGER   address of the canonical V4 PoolManager on the target chain
contract DeployV2 is Script {
    /// @notice Foundry's canonical CREATE2 deployer address, identical
    ///         on every chain.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));

        // 1. Permission flags for AscendHookV2.
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
        );

        // 2. Mine a salt that produces a hook address with those bits.
        //    HookMiner finds it in seconds for 4 flags. The salt is
        //    deterministic given (deployer, flags, creationCode, args)
        //    so it is reproducible.
        (address predicted, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(AscendHookV2).creationCode,
            abi.encode(poolManager)
        );
        console2.log("predicted hook:", predicted);

        // 3. Genesis sqrtPriceX96 for 1 ETH : 122_000_000 ascend.
        //    price (token1/token0) = 122_000_000
        //    sqrtP                 = sqrt(122_000_000) ≈ 11_045.36
        //    sqrtPriceX96          = sqrtP × 2^96
        uint160 sqrtPriceX96 = _computeSqrtPriceX96(122_000_000);
        console2.log("sqrtPriceX96 :");
        console2.logUint(sqrtPriceX96);

        // 4. Atomic deploy: Genesis's constructor performs hook deploy,
        //    pool initialize, and (via the hook's afterInitialize) the
        //    LP seed. After this single transaction, the protocol is
        //    fully live.
        vm.startBroadcast(pk);
        Genesis genesis = new Genesis{value: 1 ether}(poolManager, salt, sqrtPriceX96);
        require(address(genesis.hook()) == predicted, "address mismatch");
        vm.stopBroadcast();

        AscendHookV2 hook = genesis.hook();
        console2.log("AscendHookV2 :", address(hook));
        console2.log("ascend       :", address(hook.ascend()));
        console2.log("TileEngine   :", address(hook.tileEngine()));
        console2.log("liquidityHeld:");
        console2.logUint(hook.liquidityHeld());
        console2.log("floor()      :");
        console2.logUint(hook.floor());
    }

    /// @dev sqrtPriceX96 = sqrt(price) × 2^96  for `price` (an integer
    ///      ratio, no decimals). Babylonian sqrt over the X192-scaled
    ///      input yields the X96-scaled output.
    function _computeSqrtPriceX96(uint256 priceRatio) internal pure returns (uint160) {
        unchecked {
            uint256 s = _isqrt(priceRatio << 192);
            return uint160(s);
        }
    }

    function _isqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
