// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {HookMiner} from "v4-periphery/utils/HookMiner.sol";

import {AscendHook} from "../src/AscendHook.sol";
import {AscendRouter} from "../src/AscendRouter.sol";

/// @notice Genesis. Mines a CREATE2 salt that produces a hook address whose
///         low-order bits encode the required permission flags, deploys the
///         hook with exactly 0.001 ETH bootstrap, initializes the pool with
///         the canonical key, deploys and binds the router.
///
///         All of this happens in a single broadcast. After this script
///         lands, the system is final: the hook owns the only mint/burn
///         keys, the pool is bound, the router knows the pool key, and
///         there is no admin function on any of them.
contract Deploy is Script {
    /// @notice CREATE2 deployer used by Foundry's `new T{salt: ...}` —
    ///         this is the canonical CREATE2-Proxy at the same address on
    ///         every chain Foundry knows about.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @notice Sane default tickSpacing for the pool. Has no effect on
    ///         pricing because the hook intercepts every swap; required
    ///         only because V4 forbids tickSpacing=0.
    int24 internal constant TICK_SPACING = 60;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));

        // 1. Compute the bitfield from getHookPermissions().
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        // 2. Mine a salt that produces an address with those bits set.
        //    HookMiner.find searches sequentially; for four flags, the
        //    expected work is small (under a second on a laptop).
        (address predicted, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(AscendHook).creationCode,
            abi.encode(poolManager)
        );
        console2.log("predicted hook:", predicted);

        // 3. Deploy with the bootstrap.
        vm.startBroadcast(pk);
        AscendHook hook = new AscendHook{salt: salt, value: 0.001 ether}(poolManager);
        require(address(hook) == predicted, "address mismatch");

        // 4. Build the canonical pool key.
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO, // native ETH
            currency1: Currency.wrap(address(hook.ascend())),
            fee: 0, // no AMM fee — hook charges its own
            tickSpacing: TICK_SPACING,
            hooks: hook
        });

        // 5. Initialize the pool. The starting sqrtPriceX96 is irrelevant
        //    to pricing (hook overrides everything) — set to 1:1.
        uint160 startSqrtPriceX96 = 79228162514264337593543950336; // = 2^96 = 1.0
        poolManager.initialize(key, startSqrtPriceX96);

        // 6. Deploy the router and bind it to the pool key.
        AscendRouter router = new AscendRouter(poolManager, hook);
        router.bind(key);

        vm.stopBroadcast();

        console2.log("AscendHook   :", address(hook));
        console2.log("ascend       :", address(hook.ascend()));
        console2.log("AscendRouter :", address(router));
        console2.log("floor()      :", hook.floor());
        console2.logBytes32(PoolKeyId.toId(key));
    }
}

/// @dev tiny helper so we can log the poolId from a memory PoolKey
///      without dragging in PoolIdLibrary's calldata-only signature.
library PoolKeyId {
    function toId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}
