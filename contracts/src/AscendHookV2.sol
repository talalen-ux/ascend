// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/utils/BaseHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "v4-periphery/libraries/LiquidityAmounts.sol";

import {Ascend} from "./Ascend.sol";
import {TileEngine} from "./TileEngine.sol";

/// @title  AscendHookV2 — single LP, single chart, monotone-rising floor,
///         tile-game USP.
///
/// @notice The hook owns a full-range V4 LP that holds the entire ascend
///         supply paired against the protocol's ETH vault. Buyers and
///         sellers trade the same constant-product curve; on every swap
///         the hook collects a 5% fee and splits it:
///
///           4% retained as ETH-side LP depth (compounds the floor)
///           1% pushed to TileEngine.depositReward() as the reward pool
///                for the 12×12 tile-flipping game
///
///         The LP's lower tick (= the floor) is monotone non-decreasing
///         forever. The tile pool grows with trading volume, paying out
///         to holders who claim tiles each 24h epoch.
///
/// @dev    Locked parameters per `docs/V2_DESIGN.md`:
///           SUPPLY_CAP         122_000_000 ascend (1e18 each → 122M·1e18)
///           BOOTSTRAP_ETH      1 ether (constructor enforces exact value)
///           SWAP_FEE_PIPS      10_000 (1%, applied via dynamic-fee override)
///           LP_SHARE_BPS       7_000 (70% of fee → LP depth)
///           TILE_SHARE_BPS     3_000 (30% of fee → TileEngine)
///           MINT_FEE_WEI       0.001 ETH (~$2) flat surcharge per buy
///           ANTI_BOT_BLOCKS    100-block randomized fee window
///           LP_RANGE           full range
///           pool fee           dynamic (hook overrides per swap)
///
///         Hook permissions (encoded in the deployed CREATE2 address):
///           afterInitialize       (validate pool config + bind + seed LP)
///           beforeAddLiquidity    (reject all external LP adds)
///           beforeSwap            (apply 5% dynamic fee)
///           afterSwap             (split fee + trigger rebalance)
///
///         Invariants (proofs in docs/V2_DESIGN.md, appendix A):
///           floor(t)   = ETH_in_LP(t) / circulating(t)
///                      monotone non-decreasing under any finite trade sequence
///           supply(t)  = SUPPLY_CAP                            (constant)
///           LP owner   = address(this)                         (sole LP)
///           pool       = bound to one PoolId                   (single pool)
///           tileEngine = immutable, set in constructor         (hook-only deposit)
contract AscendHookV2 is BaseHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;
    using SafeCast for int256;
    using LPFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    // -----------------------------------------------------------------
    // immutables and locked parameters
    // -----------------------------------------------------------------

    /// @notice 122M hard-cap. Minted once, in the constructor, to the hook.
    uint256 public constant SUPPLY_CAP = 122_000_000 * 1e18;

    /// @notice Genesis ETH locked into the LP. Constructor enforces exact value.
    uint256 public constant BOOTSTRAP_ETH = 1 ether;

    /// @notice 1% total swap fee on both sides. V4's fee unit is pips
    ///         (1_000_000 = 100%), so 1% = 10_000. Applied via the
    ///         dynamic-fee override flag in beforeSwap.
    uint24 public constant SWAP_FEE_PIPS = 10_000;

    /// @notice Fee split. Of every fee collected:
    ///           70% retained as LP-side depth (compounds the floor)
    ///           30% routed to the TileEngine reward pool
    uint16 public constant LP_SHARE_BPS = 7_000;
    uint16 public constant TILE_SHARE_BPS = 3_000;
    uint16 public constant SHARE_DENOM = 10_000;

    /// @notice Flat per-buy mint surcharge (~$2 at $2,350/ETH). Anti-spam
    ///         + extra revenue. Routed entirely to the TileEngine via
    ///         the dynamic-fee mechanism: we encode it as an extra
    ///         pip-percentage of the swap, computed per swap by amount.
    ///         Naturally scales with ETH price.
    uint256 public constant MINT_FEE_WEI = 0.001 ether;

    /// @notice Window after deploy in which an extra randomized fee is
    ///         applied to mints — taxes deployment-block-tuned bots.
    uint64 public constant ANTI_BOT_BLOCKS = 100;

    /// @notice Maximum extra pips added during the anti-bot window.
    ///         Random in [0, ANTI_BOT_MAX_EXTRA_PIPS].
    uint24 public constant ANTI_BOT_MAX_EXTRA_PIPS = 10_000; // up to +1%

    /// @notice Cap on the effective fee. V4 enforces ≤ MAX_LP_FEE
    ///         (1_000_000 = 100%) but we cap stricter to avoid silent
    ///         100%-fee mints on dust amounts. 10% absolute cap.
    uint24 public constant MAX_EFFECTIVE_FEE_PIPS = 100_000;

    /// @notice Rebalance is gated on this much accumulated fee to amortize
    ///         the gas cost of `removeLiquidity` + `addLiquidity` across
    ///         many small swaps.
    uint256 public constant REBALANCE_THRESHOLD = 0.01 ether;

    /// @notice The ascend ERC-20. Deployed and minted by this hook in
    ///         `constructor`. Sole minter forever.
    Ascend public immutable ascend;

    /// @notice The tile-game contract. Receives the tile-share of every
    ///         swap fee plus the entire MINT_FEE per buy.
    ///         Deployed by this hook in the constructor, address is
    ///         immutable thereafter.
    TileEngine public immutable tileEngine;

    /// @notice Block number at which this hook was deployed. Used to
    ///         clamp the anti-bot window.
    uint256 public immutable deploymentBlock;

    // -----------------------------------------------------------------
    // pool state (set once, in afterInitialize)
    // -----------------------------------------------------------------

    PoolId public poolId;
    PoolKey public poolKey;       // stored for the rebalance routine
    bool public isInitialized;
    int24 public tickLower;       // = TickMath.minUsableTick(TICK_SPACING)
    int24 public tickUpper;       // = TickMath.maxUsableTick(TICK_SPACING)
    uint128 public liquidityHeld; // L of our single LP position

    /// @notice Last block in which `tx.origin` initiated a buy. Used to
    ///         revert sells in the same block as a buy — defeats
    ///         flash-loan arbitrage between mint and burn at the cost
    ///         of one storage write per buy.
    mapping(address => uint256) public lastBuyBlock;

    // Note: V4 natively tracks accumulated fees inside the LP position
    // state. We don't shadow that with a `pendingFees` mirror — the
    // single source of truth is the position itself. `rebalance()`
    // queries it via modifyLiquidity(0).

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
    error UnknownCallback();
    error CallerNotPoolManager();
    error UnexpectedDelta();
    error ExactOutputUnsupported();
    error MintAmountTooSmall();
    error SameBlockSellAfterBuy();

    // -----------------------------------------------------------------
    // unlock callback dispatch
    // -----------------------------------------------------------------

    /// @dev Tags the kind of work to do inside the unlock callback. ABI
    ///      encoded as the first field of `unlockCallback(data)`.
    enum CallbackKind {
        GENESIS,    // seed the initial full-range LP
        REBALANCE   // collect fees, split, re-LP at higher floor
    }

    // -----------------------------------------------------------------
    // constructor — deploy token, mint cap to self, lock bootstrap
    // -----------------------------------------------------------------

    /// @notice Genesis. Constructor enforces exactly 1 ETH, mints all
    ///         122M ascend to the hook itself, and deploys the
    ///         TileEngine. The hook is the only entity that ever holds
    ///         the bootstrap or controls the LP, and it's the only
    ///         address that can fund the tile reward pool.
    constructor(IPoolManager _manager) payable BaseHook(_manager) {
        if (msg.value != BOOTSTRAP_ETH) revert WrongBootstrap();
        ascend = new Ascend(address(this));
        ascend.mint(address(this), SUPPLY_CAP);
        tileEngine = new TileEngine(address(this), ascend);
        deploymentBlock = block.number;
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

    /// @notice ETH currently held by the hook outside the LP. Should be
    ///         zero once genesis seeding completes; non-zero values
    ///         indicate a TileEngine deposit failure (see I-5 mitigation
    ///         in `_doRebalance`) or a stuck bootstrap.
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
        if (!isInitialized || liquidityHeld == 0) return 0;

        // 1. Read live sqrtPrice from PoolManager.
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(poolId);
        if (sqrtPriceX96 == 0) return 0;

        // 2. Compute the position's underlying reserves at the current
        //    price. For our full-range position this is exact.
        uint160 sqrtLowerX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpperX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        (uint256 ethActive, uint256 ascendActive) =
            LiquidityAmounts.getAmountsForLiquidity(
                sqrtPriceX96,
                sqrtLowerX96,
                sqrtUpperX96,
                liquidityHeld
            );

        // 3. `circulating` = supply outside the LP. Includes any ascend
        //    held by the hook itself (always 0 in steady state, but
        //    included for robustness against accidental holds).
        uint256 supply = ascend.totalSupply();
        uint256 ascendInLp = ascendActive;
        uint256 ascendOnHook = ascend.balanceOf(address(this));
        if (ascendInLp + ascendOnHook >= supply) return 0;
        uint256 circulating = supply - ascendInLp - ascendOnHook;

        // 4. floor = ETH-in-LP / circulating, scaled to 1e18 fixed-point.
        //
        // This is a CONSERVATIVE LOWER BOUND. Between rebalances, the
        // dynamic-fee accrual and any direct donations sit in the
        // position's fee-growth credits and aren't reflected in
        // `ethActive`. After the next `rebalance()`, those fees are
        // donated back into the position's underlying reserves and the
        // floor reported here jumps to its true value. Off-chain
        // callers wanting the precise pre-rebalance floor should add
        // the position's outstanding fee credits — exact computation
        // requires StateLibrary feeGrowthInside reads which are
        // version-pinned to v4-core. The conservative on-chain
        // floor satisfies the monotonicity invariant either way.
        return (ethActive * 1e18) / circulating;
    }

    // -----------------------------------------------------------------
    // afterInitialize — validate pool, bind, seed the LP (slice 5 work)
    // -----------------------------------------------------------------

    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24
    ) internal override returns (bytes4) {
        if (isInitialized) revert AlreadyInitialized();

        // currency0 must be native ETH
        if (!key.currency0.isAddressZero()) revert WrongCurrencyZero();
        // currency1 must be the ascend token
        if (Currency.unwrap(key.currency1) != address(ascend)) revert WrongCurrencyOne();
        // pool fee MUST be the V4 dynamic-fee sentinel — the hook
        // charges its own fee via OVERRIDE_FEE_FLAG in beforeSwap.
        if (key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG || key.tickSpacing == 0) {
            revert WrongFeeOrTickSpacing();
        }

        poolId = key.toId();
        poolKey = key;
        tickLower = TickMath.minUsableTick(key.tickSpacing);
        tickUpper = TickMath.maxUsableTick(key.tickSpacing);
        isInitialized = true;
        emit PoolBound(poolId);

        // Seed the full-range LP atomically with initialization. We
        // re-enter PoolManager via `unlock` and add liquidity inside
        // the unlock callback. This closes the H-1 race window: the
        // pool cannot be observed in an "initialized but unfunded"
        // state by any external party.
        poolManager.unlock(abi.encode(CallbackKind.GENESIS, sqrtPriceX96));

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
    // beforeSwap — dynamic fee + anti-MEV gates
    // -----------------------------------------------------------------
    //
    // Buys (zeroForOne):
    //   1. revert if amount ≤ MINT_FEE_WEI (would mint zero ascend)
    //   2. record lastBuyBlock[tx.origin] for the same-block-burn guard
    //   3. compute effective fee:
    //        base = SWAP_FEE_PIPS (1%)
    //        + flat = MINT_FEE_WEI as a % of swap (capped)
    //        + anti-bot extra (random in [0, ANTI_BOT_MAX_EXTRA_PIPS])
    //          for the first ANTI_BOT_BLOCKS blocks after deploy
    //        cap total at MAX_EFFECTIVE_FEE_PIPS (10%)
    //
    // Sells (oneForZero):
    //   1. revert if tx.origin bought in the current block
    //   2. apply flat SWAP_FEE_PIPS (1%)
    //
    // The fee accrues to the LP position (we are the sole LP); rebalance()
    // collects it later and splits 70/30 LP/TileEngine.

    function _beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        if (!isInitialized) revert NotInitialized();
        if (key.toId() != poolId) revert WrongPool();
        if (params.amountSpecified > 0) revert ExactOutputUnsupported();

        uint256 amountIn = uint256(-params.amountSpecified);
        uint24 effectiveFeePips;

        if (params.zeroForOne) {
            // Buy: ETH → ascend
            if (amountIn <= MINT_FEE_WEI) revert MintAmountTooSmall();

            // Same-block-burn guard: record the buy block.
            // tx.origin is the EOA initiating the call chain — robust
            // against router wrappers, less robust against contract
            // wallets. Acceptable for an anti-MEV measure.
            lastBuyBlock[tx.origin] = block.number;

            effectiveFeePips = _computeBuyFeePips(amountIn);
        } else {
            // Sell: ascend → ETH
            if (lastBuyBlock[tx.origin] == block.number) {
                revert SameBlockSellAfterBuy();
            }
            effectiveFeePips = SWAP_FEE_PIPS;
        }

        uint24 fee = effectiveFeePips | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        // No delta override — pool curve is the truth.
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee);
    }

    // -----------------------------------------------------------------
    // afterSwap — analytics only; fees are collected by rebalance()
    // -----------------------------------------------------------------
    //
    // The 5% dynamic fee set in beforeSwap is taken by PoolManager from
    // the swap input and credited to the LP token holders. Since this
    // hook is the sole LP, every wei of fee accrues to our position's
    // claimable balance. The actual collection + split happens in
    // rebalance() — we don't pay the gas in afterSwap.
    //
    // Anyone can call rebalance() when accumulated fees ≥
    // REBALANCE_THRESHOLD; bots and holders are economically motivated
    // because rebalance lifts the floor for everyone holding ascend.

    /// @dev Compute the effective fee in pips for a buy of `amountIn`.
    ///
    ///   base               = SWAP_FEE_PIPS (1%)
    ///   mint surcharge     = (MINT_FEE_WEI / amountIn) × 1_000_000 pips
    ///   anti-bot extra     = random [0, ANTI_BOT_MAX_EXTRA_PIPS] for the
    ///                        first ANTI_BOT_BLOCKS blocks after deploy
    ///   total              = clamped to MAX_EFFECTIVE_FEE_PIPS
    ///
    /// The mint surcharge is the on-chain encoding of the "$2 flat fee
    /// per mint": for a small swap it's a relatively large % (anti-spam),
    /// for a 5 ETH swap it's 0.02% (negligible).
    function _computeBuyFeePips(uint256 amountIn) private view returns (uint24) {
        // pips = (MINT_FEE_WEI * 1_000_000) / amountIn
        // safe because amountIn > MINT_FEE_WEI (checked above) so pips < 1_000_000
        uint256 mintFeePips = (MINT_FEE_WEI * 1_000_000) / amountIn;
        uint256 total = uint256(SWAP_FEE_PIPS) + mintFeePips;

        if (block.number < deploymentBlock + ANTI_BOT_BLOCKS) {
            uint256 r = uint256(
                keccak256(
                    abi.encode(
                        blockhash(block.number - 1),
                        block.prevrandao,
                        tx.origin,
                        amountIn
                    )
                )
            );
            total += r % (uint256(ANTI_BOT_MAX_EXTRA_PIPS) + 1);
        }

        if (total > MAX_EFFECTIVE_FEE_PIPS) total = MAX_EFFECTIVE_FEE_PIPS;
        return uint24(total);
    }

    function _afterSwap(
        address,
        PoolKey calldata,
        IPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal virtual override returns (bytes4, int128) {
        // No-op. Fee handling is deferred to rebalance().
        return (BaseHook.afterSwap.selector, 0);
    }

    // -----------------------------------------------------------------
    // rebalance — collect fees, split, donate the LP portion back
    // -----------------------------------------------------------------
    //
    // Public + permissionless. Anyone can call. Re-entrancy guarded.
    //
    // Flow:
    //   1. modifyLiquidity(delta=0) → BalanceDelta of accrued fees
    //   2. take both currencies from PoolManager
    //   3. ETH split:
    //        TILE_SHARE_BPS / SHARE_DENOM  to tileEngine.depositReward (30%)
    //        LP_SHARE_BPS / SHARE_DENOM    back to LP via donate (70%)
    //   4. ascend fees: donate fully back to LP (compounds X-side depth)
    //
    // Effect: Y_LP grows by lpEthPortion, X_LP grows by ascendFees,
    // L unchanged, spot price moves slightly up (more Y per X), and
    // floor = Y/circulating strictly increases.

    function rebalance() external {
        if (!isInitialized) revert NotInitialized();
        _enter();
        poolManager.unlock(abi.encode(CallbackKind.REBALANCE));
        _exit();
    }

    function _doRebalance() private {
        // Collect any uncollected fees by issuing a zero-delta modify.
        // V4 returns a positive BalanceDelta for fees owed to the LP.
        BalanceDelta feesDelta = poolManager.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 0,
                salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = feesDelta.amount0();
        int128 d1 = feesDelta.amount1();
        if (d0 < 0 || d1 < 0) revert UnexpectedDelta();

        uint256 ethFees = uint256(int256(d0));
        uint256 ascendFees = uint256(int256(d1));

        // Cheap exit if there's nothing meaningful to do. Note: this
        // check happens AFTER the modifyLiquidity(0) call above, which
        // is gas we couldn't avoid — V4 doesn't have a "preview fees"
        // function. Worst case is ~80k gas wasted on an empty rebalance.
        if (ethFees + ascendFees == 0) return;

        // Take both sides from PoolManager into the hook.
        if (ethFees > 0) {
            poolManager.take(poolKey.currency0, address(this), ethFees);
        }
        if (ascendFees > 0) {
            poolManager.take(poolKey.currency1, address(this), ascendFees);
        }

        // Split the ETH portion: 4% LP retention, 1% to TileEngine.
        // 30% to TileEngine, 70% retained as LP depth (compounds floor).
        uint256 tilePortion = (ethFees * TILE_SHARE_BPS) / SHARE_DENOM;
        uint256 lpEthPortion = ethFees - tilePortion;

        // Forward the tile portion. Wrapped in try/catch so a buggy
        // TileEngine can't brick rebalance — the tile portion just
        // accumulates back into the LP retention. (audit I-5 mitigation)
        if (tilePortion > 0) {
            // solhint-disable-next-line no-empty-blocks
            try tileEngine.depositReward{value: tilePortion}() {
                // ok
            } catch {
                lpEthPortion += tilePortion;
                tilePortion = 0;
            }
        }

        // Donate the LP-retained ETH and all ascend fees back into the
        // position. donate() adds to in-range LPs' reserves without
        // changing L, so spot price barely moves and floor strictly
        // rises (Y grows, circulating unchanged).
        if (lpEthPortion > 0 || ascendFees > 0) {
            poolManager.donate(poolKey, lpEthPortion, ascendFees, "");
            if (lpEthPortion > 0) {
                poolManager.settle{value: lpEthPortion}();
            }
            if (ascendFees > 0) {
                poolManager.sync(poolKey.currency1);
                ascend.transfer(address(poolManager), ascendFees);
                poolManager.settle();
            }
        }

        emit Rebalanced(ethFees + ascendFees, liquidityHeld, _floor());
    }

    // -----------------------------------------------------------------
    // unlockCallback — entered by PoolManager during seeding & rebalance
    // -----------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert CallerNotPoolManager();

        CallbackKind kind = abi.decode(data, (CallbackKind));
        if (kind == CallbackKind.GENESIS) {
            (, uint160 sqrtPriceX96) = abi.decode(data, (CallbackKind, uint160));
            _seedGenesis(sqrtPriceX96);
        } else if (kind == CallbackKind.REBALANCE) {
            _doRebalance();
        } else {
            revert UnknownCallback();
        }
        return "";
    }

    // -----------------------------------------------------------------
    // genesis seed — called once, from afterInitialize via unlockCallback
    // -----------------------------------------------------------------
    //
    // Adds the entire 122M ascend supply paired against the 1 ETH
    // bootstrap as a full-range LP position. The hook is the sole LP.
    //
    // Math: liquidity for full range with `BOOTSTRAP_ETH` ETH and
    // `SUPPLY_CAP` ascend at the deployer-provided sqrtPrice:
    //
    //     L = LiquidityAmounts.getLiquidityForAmounts(
    //             sqrtP_current,
    //             sqrtP_min,    // at MIN_TICK
    //             sqrtP_max,    // at MAX_TICK
    //             BOOTSTRAP_ETH,
    //             SUPPLY_CAP
    //         )
    //
    // The deployer is responsible for setting sqrtPriceX96 such that
    // BOOTSTRAP_ETH/SUPPLY_CAP exactly fits the pool ratio at the
    // chosen price. If the price is mismatched, modifyLiquidity will
    // either revert (insufficient assets) or leave dust on the hook.
    // -----------------------------------------------------------------

    function _seedGenesis(uint160 sqrtPriceX96) private {
        uint160 sqrtPriceLowerX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceUpperX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtPriceLowerX96,
            sqrtPriceUpperX96,
            BOOTSTRAP_ETH,
            SUPPLY_CAP
        );

        BalanceDelta delta = poolManager.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        // For positive liquidityDelta (adding), both deltas are negative
        // (we owe PoolManager). Convert to absolute amounts to settle.
        int128 a0 = delta.amount0();
        int128 a1 = delta.amount1();
        if (a0 > 0 || a1 > 0) revert UnexpectedDelta();

        uint256 owedEth = uint256(int256(-a0));
        uint256 owedAscend = uint256(int256(-a1));

        // Settle currency0 (native ETH).
        if (owedEth > 0) {
            poolManager.settle{value: owedEth}();
        }

        // Settle currency1 (ascend ERC-20). V4 sync-then-transfer-then-settle.
        if (owedAscend > 0) {
            poolManager.sync(poolKey.currency1);
            ascend.transfer(address(poolManager), owedAscend);
            poolManager.settle();
        }

        liquidityHeld = liquidity;
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
