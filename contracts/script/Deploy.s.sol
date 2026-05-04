// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SatoHook} from "../src/SatoHook.sol";

/// @notice One-shot deploy. The hook constructor itself deploys the sato
///         token and locks the issuer slot. There is nothing to configure
///         and nothing to authorize after this transaction lands.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        SatoHook hook = new SatoHook();

        vm.stopBroadcast();

        console2.log("SatoHook:", address(hook));
        console2.log("sato    :", address(hook.sato()));
    }
}
