// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/utils/HookMiner.sol";

import {AscentToken} from "../src/AscentToken.sol";
import {AscentHook} from "../src/AscentHook.sol";
import {AscentQuoter} from "../src/AscentQuoter.sol";

contract Deploy is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        address poolManager = vm.envAddress("POOL_MANAGER");
        address recipient = vm.envAddress("TOKEN_RECIPIENT");
        uint256 supply = vm.envOr("TOKEN_SUPPLY", uint256(1_000_000_000 ether));

        vm.startBroadcast();

        AscentToken token = new AscentToken(recipient, supply);
        console2.log("AscentToken:", address(token));

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        bytes memory creationCode = type(AscentHook).creationCode;
        bytes memory args = abi.encode(IPoolManager(poolManager));

        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, creationCode, args);

        AscentHook hook = new AscentHook{salt: salt}(IPoolManager(poolManager));
        require(address(hook) == predicted, "deploy: address mismatch");
        console2.log("AscentHook:", address(hook));

        AscentQuoter quoter = new AscentQuoter(hook, IPoolManager(poolManager));
        console2.log("AscentQuoter:", address(quoter));

        vm.stopBroadcast();
    }
}
