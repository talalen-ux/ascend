// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/utils/BaseHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "v4-core/types/BeforeSwapDelta.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

import {Ascend} from "./Ascend.sol";

/// @title  AscendHook — a Uniswap V4 hook that IS the engine.
///
/// @notice Single venue. Single price. Same code path whether a swap is
///         routed via Uniswap's UI, the dapp, an aggregator, or a contract.
///         The pool itself holds no liquidity; the hook holds every wei of
///         ETH and every accounting unit of ascend supply. Each swap is
///         intercepted in `beforeSwap` and replaced with an exact, deterministic
///         transfer at the current floor.
///
/// @dev    Permissions encoded in the deployed address (mined via CREATE2):
///           afterInitialize          (validate pool config + lock state)
///           beforeAddLiquidity       (reject all LP — the hook IS the LP)
///           beforeSwap               (intercept every swap)
///           beforeSwapReturnsDelta   (replace AMM output with our own)
///
///         Mathematical invariants (proved in the whitepaper):
///           floor(t)         := reserve(t) / supply(t)
///           premium_bps(t)   := BASE + cumulativeEthIn(t) · BPS / S
///           price(t)         := floor(t) · (1 + premium_bps(t)/BPS)
///           marketCap(t)     := price(t) · supply(t)  =  (1 + premium) · vault
///         Floor and premium are both monotone non-decreasing under any
///         finite sequence of mines and redemptions.
///         Solvency: reserve ≥ floor · (supply − supply_locked) at all times.
contract AscendHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;
    using SafeCast for int256;

    // -----------------------------------------------------------------
    // immutables and parameters
    // -----------------------------------------------------------------

    /// @notice 5% mining fee, 5% redemption fee, expressed in basis points.
    ///         Symmetric — entry and exit cost the same. Both retentions
    ///         stay in the vault permanently as additional backing for
    ///         every remaining holder. The MC growth driver is the premium
    ///         ratchet (below), not the redemption fee.
    uint16 public constant BUY_FEE_BPS = 500;
    uint16 public constant SELL_FEE_BPS = 500;
    uint16 public constant BPS_DENOM = 10_000;

    /// @notice Mining premium. At every block:
    ///
    ///           premiumBps = BASE_PREMIUM_BPS + (cumulativeEthIn · BPS / S)
    ///           tradingPrice = floor · (1 + premiumBps / BPS)
    ///           marketCap    = tradingPrice · supply = (1 + premium) · vault
    ///
    ///         BASE_PREMIUM_BPS sets the day-zero premium (10_000 = 100%, so
    ///         price = 2 · floor at genesis). The dynamic component ratchets
    ///         up with `cumulativeEthIn` — the all-time mining inflow. Every
    ///         dollar of mining permanently lifts the premium for every
    ///         subsequent miner. Sells do NOT reduce cumulativeEthIn, so the
    ///         premium is monotone non-decreasing forever.
    ///
    ///         PREMIUM_SCALE_WEI is the half-life: the premium gains
    ///         BASE_PREMIUM_BPS per PREMIUM_SCALE_WEI of cumulative mining.
    ///         At S = 250 ETH and base = 100%:
    ///           cumE =   0  ETH → premium = 100% → price = 2.0 · floor
    ///           cumE = 250  ETH → premium = 200% → price = 3.0 · floor
    ///           cumE = 500  ETH → premium = 300% → price = 4.0 · floor
    ///           cumE = 5k   ETH → premium = 2100% → price = 22 · floor
    ///
    ///         Redemption ignores the premium: sellers always exit at the
    ///         floor (minus the 5% redemption fee). The premium is the
    ///         "second floor" that markets capitalize separately from the
    ///         redemption guarantee.
    uint16 public constant BASE_PREMIUM_BPS = 10_000;
    uint256 public constant PREMIUM_SCALE_WEI = 250 ether;

    /// @notice Bootstrap. Constructor enforces these exactly.
    ///         The bootstrap ETH and the bootstrap ascend (locked at the hook
    ///         itself) anchor the initial floor at 0.001 ETH per ascend.
    uint256 public constant BOOTSTRAP_ETH = 0.001 ether;
    uint256 public constant BOOTSTRAP_ASCEND = 1e18;

    /// @notice The token. Created by this contract in the constructor;
    ///         its sole minter and burner is `address(this)`.
    Ascend public immutable ascend;

    // -----------------------------------------------------------------
    // pool state (set once, in afterInitialize)
    // -----------------------------------------------------------------

    PoolId public poolId;
    bool public isInitialized;

    /// @notice All-time cumulative ETH paid into mining. Monotonically
    ///         non-decreasing — incremented by every successful buy and
    ///         never reduced. Drives the dynamic premium upward forever.
    uint256 public cumulativeEthIn;

    // -----------------------------------------------------------------
    // transient reentrancy guard (EIP-1153)
    // -----------------------------------------------------------------

    bytes32 private constant REENTRANCY_SLOT = keccak256("ascend.hook.reentrancy.v1");

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
    error ExactOutputUnsupported();
    error WrongPool();
    error ZeroAmount();
    error InsufficientSupply();
    error UnsolicitedETH();
    error Reentrancy();

    // -----------------------------------------------------------------
    // constructor: locks the bootstrap, deploys the token, locks supply
    // -----------------------------------------------------------------

    /// @notice Constructor enforces the bootstrap exactly: 0.001 ETH must
    ///         be paid by the deployer, and exactly one ascend is minted to
    ///         the hook itself. The hook has no path to spend either —
    ///         neither the bootstrap ETH nor the bootstrap ascend can ever
    ///         leave. They anchor the initial floor.
    constructor(IPoolManager _manager) payable BaseHook(_manager) {
        if (msg.value != BOOTSTRAP_ETH) revert WrongBootstrap();
        ascend = new Ascend(address(this));
        ascend.mint(address(this), BOOTSTRAP_ASCEND);
    }

    // -----------------------------------------------------------------
    // permissions (encoded in the deployed address)
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
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // -----------------------------------------------------------------
    // public views — same numbers any UI or aggregator can read
    // -----------------------------------------------------------------

    /// @notice ETH balance of the hook. Equals the total ETH ever paid in
    ///         minus the total ETH ever paid out, plus the bootstrap.
    function reserve() public view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Floor price (redemption value), ETH per ascend, in 1e18 fixed point.
    ///         floor = vault / supply. The on-chain backing per token.
    function floor() public view returns (uint256) {
        uint256 supply = ascend.totalSupply();
        if (supply == 0) return 0;
        return (address(this).balance * 1e18) / supply;
    }

    /// @notice Current premium expressed in basis points.
    ///         premium_bps = BASE_PREMIUM_BPS + cumulativeEthIn · BPS / S
    ///         At genesis = BASE (10_000 = 100%). Grows by BASE per S of
    ///         cumulative mining. Monotone non-decreasing forever.
    function premiumBps() public view returns (uint256) {
        return uint256(BASE_PREMIUM_BPS)
            + (cumulativeEthIn * uint256(BPS_DENOM)) / PREMIUM_SCALE_WEI;
    }

    /// @notice Trading price (mining cost), ETH per ascend, in 1e18 fixed point.
    ///         price = floor · (1 + premium_bps / BPS).
    function price() public view returns (uint256) {
        uint256 f = floor();
        uint256 pBps = premiumBps();
        return f + (f * pBps) / uint256(BPS_DENOM);
    }

    /// @notice Market cap = price · supply, in wei.
    ///         marketCap = (1 + premium) · vault. Strictly greater than the
    ///         vault by the dynamic premium factor.
    function marketCap() public view returns (uint256) {
        uint256 supply = ascend.totalSupply();
        return (price() * supply) / 1e18;
    }

    /// @notice Returns (ascendOut, fee) for a mining buy of `ethIn` wei.
    ///         Quotes at the CURRENT premium — the buyer's own contribution
    ///         to cumulativeEthIn lifts the premium for the next miner.
    function quoteBuy(uint256 ethIn) external view returns (uint256 ascendOut, uint256 fee) {
        if (ethIn == 0) return (0, 0);
        fee = (ethIn * BUY_FEE_BPS) / BPS_DENOM;
        uint256 net = ethIn - fee;
        uint256 supply = ascend.totalSupply();
        uint256 r = address(this).balance;
        if (r == 0 || supply == 0) return (0, 0);
        // ascendOut = net / (floor · (1 + premium))
        //           = net · S / (R · (1 + premium))
        // Implemented in BPS to avoid fractional math:
        //   priceMultiplier_bps = BPS + premiumBps()
        //   ascendOut = net · S · BPS / (R · priceMultiplier_bps)
        uint256 priceMultiplierBps = uint256(BPS_DENOM) + premiumBps();
        ascendOut = (net * supply * uint256(BPS_DENOM)) / (r * priceMultiplierBps);
    }

    /// @notice Returns (ethOut, fee) for a sell of `ascendIn` ascend wei.
    function quoteSell(uint256 ascendIn) external view returns (uint256 ethOut, uint256 fee) {
        if (ascendIn == 0) return (0, 0);
        uint256 supply = ascend.totalSupply();
        if (ascendIn >= supply) return (0, 0);
        uint256 r = address(this).balance;
        // gross = ascendIn * R / S  (ETH wei out at floor)
        uint256 gross = (ascendIn * r) / supply;
        fee = (gross * SELL_FEE_BPS) / BPS_DENOM;
        ethOut = gross - fee;
    }

    // -----------------------------------------------------------------
    // afterInitialize — validate pool shape, bind to one PoolId only
    // -----------------------------------------------------------------

    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24
    ) internal override returns (bytes4) {
        if (isInitialized) revert AlreadyInitialized();

        // Currency0 must be native ETH (address(0)).
        if (!key.currency0.isAddressZero()) revert WrongCurrencyZero();

        // Currency1 must be the ascend token.
        if (Currency.unwrap(key.currency1) != address(ascend)) revert WrongCurrencyOne();

        // The pool must declare zero swap fee — the hook charges its own
        // fees via the floor mechanic. tickSpacing must be non-zero per
        // V4 invariant; any positive value is fine since no LP will exist.
        if (key.fee != 0 || key.tickSpacing == 0) revert WrongFeeOrTickSpacing();

        poolId = key.toId();
        isInitialized = true;
        emit PoolBound(poolId);
        return BaseHook.afterInitialize.selector;
    }

    // -----------------------------------------------------------------
    // beforeAddLiquidity — reject every LP add. the hook is the LP.
    // -----------------------------------------------------------------

    function _beforeAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) internal pure override returns (bytes4) {
        revert LiquidityNotAllowed();
    }

    // -----------------------------------------------------------------
    // beforeSwap — the entire trade happens here.
    // -----------------------------------------------------------------

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        if (!isInitialized) revert NotInitialized();
        if (key.toId() != poolId) revert WrongPool();
        if (params.amountSpecified > 0) revert ExactOutputUnsupported();

        _enter();
        uint256 amountIn = uint256(-params.amountSpecified);
        if (amountIn == 0) revert ZeroAmount();

        BeforeSwapDelta delta;
        if (params.zeroForOne) {
            delta = _executeBuy(key, amountIn, sender);
        } else {
            delta = _executeSell(key, amountIn, sender);
        }
        _exit();

        return (BaseHook.beforeSwap.selector, delta, 0);
    }

    // -----------------------------------------------------------------
    // BUY — currency0 (ETH) → currency1 (ascend), exact-input.
    // -----------------------------------------------------------------
    //
    // Delta convention (V4): from the hook's view, the BeforeSwapDelta
    // represents how the hook changes the swap accounting before the AMM
    // runs. For exact-input zeroForOne, the swap's specifiedDelta is
    // applied to amountSpecified (negative). A positive specifiedDelta
    // from the hook cancels out the negative amountSpecified, leaving the
    // AMM with zero to do.
    //
    //   amountSpecified after hook = amountSpecified + hook.specifiedDelta
    //                              = -ethIn + ethIn = 0
    //
    // The hook then physically settles balances:
    //   • take(currency0, address(this), ethIn)   — ETH from PoolManager → hook
    //   • mint ascend to PoolManager and settle    — ascend → swapper
    //
    // The unspecifiedDelta is negative, telling PoolManager that the hook
    // is providing ascendOut on the unspecified side (the swapper receives it).
    // -----------------------------------------------------------------

    function _executeBuy(PoolKey calldata key, uint256 ethIn, address swapper)
        private
        returns (BeforeSwapDelta)
    {
        // Pre-swap state. Note: at beforeSwap time the swapper's ETH is held
        // by PoolManager, not yet transferred to the hook — so the hook's
        // balance still reflects the prior reserve.
        uint256 reserveBefore = address(this).balance;
        uint256 supplyBefore = ascend.totalSupply();
        // The bootstrap guarantees both are > 0 at all times after deploy.

        // Fee retained as additional reserve.
        uint256 fee = (ethIn * BUY_FEE_BPS) / BPS_DENOM;
        uint256 net = ethIn - fee;

        // Snapshot the premium at the pre-trade cumulativeEthIn — the buyer
        // transacts at the price the curve presented when they signed. Their
        // own contribution lifts the premium for the next miner.
        uint256 priceMultiplierBps = uint256(BPS_DENOM) + premiumBps();
        uint256 ascendOut = (net * supplyBefore * uint256(BPS_DENOM))
            / (reserveBefore * priceMultiplierBps);
        if (ascendOut == 0) revert ZeroAmount();

        // 1) Pull the entire ETH input from the PoolManager into the hook.
        poolManager.take(key.currency0, address(this), ethIn);

        // 2) Mint ascendOut and settle it to the PoolManager so the swapper
        //    receives it as the swap output. ERC-20 settle pattern: sync,
        //    transfer, settle.
        poolManager.sync(key.currency1);
        ascend.mint(address(poolManager), ascendOut);
        poolManager.settle();

        // 3) After all external calls succeed, ratchet cumulative inflow.
        //    Strict CEI: state-mutating effect lands after interactions.
        //    Premium is monotone non-decreasing forever (sells do not
        //    decrement this).
        cumulativeEthIn += ethIn;

        emit Buy(swapper, ethIn, fee, ascendOut, _floorAfter());

        // Delta returned to PoolManager.
        // specifiedDelta   = +ethIn       (hook absorbed full input)
        // unspecifiedDelta = -ascendOut   (hook provided full output)
        return toBeforeSwapDelta(int128(int256(ethIn)), -int128(int256(ascendOut)));
    }

    // -----------------------------------------------------------------
    // SELL — currency1 (ascend) → currency0 (ETH), exact-input.
    // -----------------------------------------------------------------

    function _executeSell(PoolKey calldata key, uint256 ascendIn, address swapper)
        private
        returns (BeforeSwapDelta)
    {
        uint256 reserveBefore = address(this).balance;
        uint256 supplyBefore = ascend.totalSupply();
        // Cannot redeem more than circulating non-bootstrap supply.
        if (ascendIn >= supplyBefore) revert InsufficientSupply();

        // gross = ascendIn * R / S  (ETH wei at the current floor).
        uint256 gross = (ascendIn * reserveBefore) / supplyBefore;
        uint256 fee = (gross * SELL_FEE_BPS) / BPS_DENOM;
        uint256 ethOut = gross - fee;
        if (ethOut == 0) revert ZeroAmount();

        // 1) Take the ascend input from the PoolManager and burn it.
        poolManager.take(key.currency1, address(this), ascendIn);
        ascend.burn(address(this), ascendIn);

        // 2) Pay ethOut to the PoolManager so the swapper receives ETH.
        //    Native settle takes value via msg.value.
        poolManager.settle{value: ethOut}();

        emit Sell(swapper, ascendIn, fee, ethOut, _floorAfter());

        // specifiedDelta   = +ascendIn   (hook absorbed full ascend input)
        // unspecifiedDelta = -ethOut     (hook provided full ETH output)
        return toBeforeSwapDelta(int128(int256(ascendIn)), -int128(int256(ethOut)));
    }

    function _floorAfter() private view returns (uint256) {
        uint256 supply = ascend.totalSupply();
        if (supply == 0) return 0;
        return (address(this).balance * 1e18) / supply;
    }

    // -----------------------------------------------------------------
    // reentrancy guard
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
    // Only the PoolManager may push ETH into the hook directly (during the
    // settle/take ETH dance V4 performs). All other inbound ETH is rejected
    // so nobody can accidentally inflate reserves outside the floor logic
    // (which would dilute the per-token backing for a single trade rather
    // than the whole supply).
    // -----------------------------------------------------------------

    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnsolicitedETH();
    }
}
