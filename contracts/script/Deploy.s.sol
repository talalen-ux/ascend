// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {RiseEngine} from "../src/RiseEngine.sol";

/// @notice One-shot deploy. The deployer pays exactly 0.001 ETH alongside
///         the deploy tx; that ETH becomes the bootstrap reserve, and one
///         rise is minted to the engine itself (permanently locked, since
///         the engine has no path to spend its own balance). After this,
///         there is nothing to configure.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        RiseEngine engine = new RiseEngine{value: 0.001 ether}();

        vm.stopBroadcast();

        console2.log("RiseEngine:", address(engine));
        console2.log("rise      :", address(engine.rise()));
        console2.log("floor()   :", engine.floor());
    }
}
