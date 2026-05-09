// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {AscendHookV2} from "../src/AscendHookV2.sol";
import {AscendRouter} from "../src/AscendRouter.sol";
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
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address deployer = vm.addr(pk);

        // 1. Permission flags for AscendHookV2.
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
        );

        // 2. Predict the Genesis contract's CREATE address. The EOA
        //    deploys Genesis via plain `new` (CREATE), so its address is
        //    keccak256(rlp(deployer, nonce)). Genesis's constructor in
        //    turn CREATE2-deploys AscendHookV2 with our mined salt — so
        //    the salt must be mined against Genesis's predicted address,
        //    NOT the canonical CREATE2 deployer.
        uint256 nonce = vm.getNonce(deployer);
        address predictedGenesis = vm.computeCreateAddress(deployer, nonce);
        console2.log("predicted Genesis:", predictedGenesis);

        // 3. Mine a salt that produces a hook address with the required
        //    permission bits, using the predicted Genesis address as the
        //    CREATE2 deployer. The salt is deterministic given (deployer,
        //    flags, creationCode, args).
        (address predicted, bytes32 salt) = HookMiner.find(
            predictedGenesis,
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
        //
        //    Then deploy AscendRouter, the thin unlock-callback wrapper
        //    the dapp uses for buy/sell. It reads the canonical pool
        //    key off the hook so it must be deployed after the hook is
        //    initialized.
        vm.startBroadcast(pk);
        Genesis genesis = new Genesis{value: 1 ether}(poolManager, salt, sqrtPriceX96);
        require(address(genesis.hook()) == predicted, "address mismatch");
        AscendRouter router = new AscendRouter(poolManager, genesis.hook());
        vm.stopBroadcast();

        AscendHookV2 hook = genesis.hook();
        console2.log("AscendHookV2 :", address(hook));
        console2.log("ascend       :", address(hook.ascend()));
        console2.log("TileEngine   :", address(hook.tileEngine()));
        console2.log("AscendRouter :", address(router));
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
