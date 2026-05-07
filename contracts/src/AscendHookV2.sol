// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/utils/BaseHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

import {Ascend} from "./Ascend.sol";

/// @title  AscendHookV2 — single LP, single chart, monotone-rising floor.
///
/// @notice The hook owns a full-range V4 LP that holds the entire ascend
///         supply paired against the protocol's ETH vault. Buyers and
///         sellers trade the same constant-product curve; 5% of every
///         swap is retained by the hook and re-deposited as additional
///         ETH-side depth on the next rebalance, so the LP's lower tick
///         (= the floor) is monotone non-decreasing forever.
///
/// @dev    Locked parameters per `docs/V2_DESIGN.md`:
///           SUPPLY_CAP        21_000_000 ascend (1e18 each → 21M·1e18)
///           BOOTSTRAP_ETH     1 ether (constructor enforces exact value)
///           FEE_BPS           500 (5%, applied via dynamic-fee override)
///           LP_RANGE          full range
///           pool fee          0 (hook charges its own fee)
///
///         Hook permissions (encoded in the deployed CREATE2 address):
///           afterInitialize       (validate pool config + bind + seed LP)
///           beforeAddLiquidity    (reject all external LP adds)
///           beforeSwap            (apply 5% dynamic fee)
///           afterSwap             (track fees + trigger rebalance)
///
///         Invariants (proofs in docs/V2_DESIGN.md, appendix A):
///           floor(t)   = ETH_in_LP(t) / circulating(t)
///                      monotone non-decreasing under any finite trade sequence
///           supply(t)  = SUPPLY_CAP                            (constant)
///           LP owner   = address(this)                         (sole LP)
///           pool       = bound to one PoolId                   (single pool)
contract AscendHookV2 is BaseHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;
    using SafeCast for int256;
    using LPFeeLibrary for uint24;

    // -----------------------------------------------------------------
    // immutables and locked parameters
    // -----------------------------------------------------------------

    /// @notice 21M hard-cap. Minted once, in the constructor, to the hook.
    uint256 public constant SUPPLY_CAP = 21_000_000 * 1e18;

    /// @notice Genesis ETH locked into the LP. Constructor enforces exact value.
    uint256 public constant BOOTSTRAP_ETH = 1 ether;

    /// @notice 5% on both sides; retained as ETH-side LP depth on the next
    ///         rebalance. Applied via V4's dynamic-fee override.
    uint24 public constant FEE_BPS = 500;

    /// @notice Rebalance is gated on this much accumulated fee to amortize
    ///         the gas cost of `removeLiquidity` + `addLiquidity` across
    ///         many small swaps.
    uint256 public constant REBALANCE_THRESHOLD = 0.01 ether;

    /// @notice The ascend ERC-20. Deployed and minted by this hook in
    ///         `constructor`. Sole minter forever.
    Ascend public immutable ascend;

    // -----------------------------------------------------------------
    // pool state (set once, in afterInitialize)
    // -----------------------------------------------------------------

    PoolId public poolId;
    bool public isInitialized;
    int24 public tickLower;       // = TickMath.minUsableTick(TICK_SPACING)
    int24 public tickUpper;       // = TickMath.maxUsableTick(TICK_SPACING)
    uint128 public liquidityHeld; // L of our single LP position

    /// @notice ETH collected from swap fees that has not yet been re-LP'd.
    ///         Sits on the hook's balance until a rebalance fires.
    uint256 public pendingFees;

    /// @notice All-time cumulative fees retained (analytics; never decreases).
    uint256 public cumulativeFees;

    // -----------------------------------------------------------------
    // transient reentrancy guard (EIP-1153)
    // -----------------------------------------------------------------

    bytes32 private constant REENTRANCY_SLOT = keccak256("ascend.v2.hook.reentrancy");

    // -----------------------------------------------------------------
    // events
    // -----------------------------------------------------------------

    event Buy(
        address indexed swapper,
        uint256 ethIn,
        uint256 fee,
        uint256 ascendOut,
        uint256 newFloor
    );
    event Sell(
        address indexed swapper,
        uint256 ascendIn,
        uint256 fee,
        uint256 ethOut,
        uint256 newFloor
    );
    event Rebalanced(uint256 feesAdded, uint128 newLiquidity, uint256 newFloor);
    event PoolBound(PoolId indexed poolId);

    // -----------------------------------------------------------------
    // errors
    // -----------------------------------------------------------------

    error WrongBootstrap();
    error AlreadyInitialized();
    error NotInitialized();
    error WrongCurrencyZero();
    error WrongCurrencyOne();
    error WrongFeeOrTickSpacing();
    error LiquidityNotAllowed();
    error WrongPool();
    error UnsolicitedETH();
    error Reentrancy();
    error NotImplemented();

    // -----------------------------------------------------------------
    // constructor — deploy token, mint cap to self, lock bootstrap
    // -----------------------------------------------------------------

    /// @notice Genesis. Constructor enforces exactly 1 ETH and mints all
    ///         21M ascend to the hook itself. The hook is the only entity
    ///         that ever holds the bootstrap or controls the LP.
    constructor(IPoolManager _manager) payable BaseHook(_manager) {
        if (msg.value != BOOTSTRAP_ETH) revert WrongBootstrap();
        ascend = new Ascend(address(this));
        ascend.mint(address(this), SUPPLY_CAP);
    }

    // -----------------------------------------------------------------
    // permissions (encoded in the deployed address via CREATE2 salt)
    // -----------------------------------------------------------------

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // -----------------------------------------------------------------
    // public views
    // -----------------------------------------------------------------

    /// @notice ETH currently held by the hook outside the LP (pending fees +
    ///         the bootstrap before genesis LP add). After genesis, this
    ///         equals `pendingFees` exactly.
    function reserveOutside() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice The full-range LP's lower-tick price as a wei-per-ascend
    ///         (1e18 fixed-point) value. This is the protocol's floor.
    ///         Implementation note: at full range, the position is "always
    ///         in range", so `floor` = `Y_in_LP / X_in_LP`. Reading the
    ///         actual reserves requires PoolManager state queries which we
    ///         delegate to `_floor()` once liquidity is added.
    function floor() public view returns (uint256) {
        return _floor();
    }

    function _floor() internal view virtual returns (uint256) {
        // To be implemented in slice 5: read poolManager position state,
        // compute Y/X. Stub returns 0 until the LP is seeded.
        return 0;
    }

    // -----------------------------------------------------------------
    // afterInitialize — validate pool, bind, seed the LP (slice 5 work)
    // -----------------------------------------------------------------

    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24
    ) internal override returns (bytes4) {
        if (isInitialized) revert AlreadyInitialized();

        // currency0 must be native ETH
        if (!key.currency0.isAddressZero()) revert WrongCurrencyZero();
        // currency1 must be the ascend token
        if (Currency.unwrap(key.currency1) != address(ascend)) revert WrongCurrencyOne();
        // pool must declare zero swap fee — the hook charges its own fee
        // via the dynamic-fee override flag in beforeSwap.
        if (key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG || key.tickSpacing == 0) {
            revert WrongFeeOrTickSpacing();
        }

        poolId = key.toId();
        tickLower = TickMath.minUsableTick(key.tickSpacing);
        tickUpper = TickMath.maxUsableTick(key.tickSpacing);
        isInitialized = true;
        emit PoolBound(poolId);

        // TODO (slice 5): seed the genesis LP position here.
        //   poolManager.unlock(abi.encode(GenesisDeposit{amount0: BOOTSTRAP_ETH, amount1: SUPPLY_CAP}))
        //   inside unlockCallback: mint the position via modifyLiquidity.

        return BaseHook.afterInitialize.selector;
    }

    // -----------------------------------------------------------------
    // beforeAddLiquidity — reject every LP add. the hook is the LP.
    // -----------------------------------------------------------------

    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) internal view override returns (bytes4) {
        // The hook itself is allowed to add liquidity (genesis seed +
        // rebalance). All other callers are rejected.
        if (sender != address(this)) revert LiquidityNotAllowed();
        return BaseHook.beforeAddLiquidity.selector;
    }

    // -----------------------------------------------------------------
    // beforeSwap — apply 5% dynamic fee, route to hook (slice 6 work)
    // -----------------------------------------------------------------

    function _beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        bytes calldata
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        if (!isInitialized) revert NotInitialized();
        if (key.toId() != poolId) revert WrongPool();

        // Override pool fee with our 5% — V4 routes the fee to this hook
        // because the pool is set up with LP_FEE_OVERRIDE; the LP itself
        // collects 0.
        uint24 fee = uint24(FEE_BPS) | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        // No delta override — let the pool curve be the truth.
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee);
    }

    // -----------------------------------------------------------------
    // afterSwap — accumulate fees, trigger rebalance if past threshold
    //              (slice 6 work)
    // -----------------------------------------------------------------

    function _afterSwap(
        address,
        PoolKey calldata,
        IPoolManager.SwapParams calldata,
        // BalanceDelta — tokens that moved in this swap
        // (we use it to compute the fee retained, slice 6)
        // ignored in skeleton:
        // BalanceDelta,
        bytes calldata
    ) internal virtual returns (bytes4, int128) {
        // TODO (slice 6):
        //   1. Compute fee earned this swap from the BalanceDelta + 5% rate.
        //   2. pendingFees += fee
        //   3. if pendingFees >= REBALANCE_THRESHOLD: rebalance()

        return (BaseHook.afterSwap.selector, 0);
    }

    // -----------------------------------------------------------------
    // rebalance — withdraw, add fees, redeposit at higher floor
    //              (slice 6 work)
    // -----------------------------------------------------------------

    function rebalance() public {
        // Anyone can call (it's gas-funded by the caller). The routine is
        // idempotent below the threshold and re-entrancy guarded.
        revert NotImplemented();
        // TODO (slice 6):
        //   _enter()
        //   if (pendingFees < REBALANCE_THRESHOLD) { _exit(); return; }
        //   poolManager.unlock(rebalanceCallbackData)
        //     in unlockCallback:
        //       1. modifyLiquidity(decrease, liquidityHeld, range)
        //       2. take both currencies; combine ETH side with pendingFees
        //       3. modifyLiquidity(increase, computeNewL, range)
        //   _exit()
    }

    // -----------------------------------------------------------------
    // unlockCallback — entered by PoolManager during seeding & rebalance
    //                   (slice 5 + slice 6 work)
    // -----------------------------------------------------------------

    function unlockCallback(bytes calldata /*data*/ ) external view returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotInitialized(); // wrong caller
        revert NotImplemented();
        // Branch on data type:
        //   GenesisDeposit  → mint position with BOOTSTRAP_ETH + SUPPLY_CAP
        //   RebalanceCycle  → withdraw, top up ETH side, redeposit
    }

    // -----------------------------------------------------------------
    // reentrancy guard (EIP-1153 transient storage)
    // -----------------------------------------------------------------

    function _enter() private {
        bytes32 slot = REENTRANCY_SLOT;
        uint256 v;
        assembly {
            v := tload(slot)
        }
        if (v != 0) revert Reentrancy();
        assembly {
            tstore(slot, 1)
        }
    }

    function _exit() private {
        bytes32 slot = REENTRANCY_SLOT;
        assembly {
            tstore(slot, 0)
        }
    }

    // -----------------------------------------------------------------
    // ETH receiver
    // -----------------------------------------------------------------
    //
    // PoolManager pushes ETH into the hook during the swap fee accounting
    // and during `take`. All other inbound ETH is rejected — accidental
    // donations would deepen the floor in a way that isn't tied to a
    // recorded swap, which is fine economically but obscures the
    // accounting trail.

    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnsolicitedETH();
    }
}
