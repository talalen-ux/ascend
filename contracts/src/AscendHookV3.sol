// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {
    BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";

import {UD60x18, ud, exp, ln, mul, div, add, sub, intoUint256} from "prb-math/UD60x18.sol";
import {UNIT} from "prb-math/ud60x18/Constants.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Ascend} from "./Ascend.sol";
import {TileEngine} from "./TileEngine.sol";

/// @title  AscendHookV3 — exponential-curve bonding curve issuer on Uniswap V4.
///
/// @notice Supply starts at 0; mint creates new ascend per the curve
///         q(e) = K · (1 − e^(−e/S)). Burn redeems against the inverse
///         curve Δe = S · ln((K − q + b) / (K − q)). The hook is the
///         issuer; there is no LP, no pre-mint, no bootstrap.
///
///         Every interaction is a V4 swap on the (ETH, ascend) pool.
///         The hook intercepts via `beforeSwap` and returns a
///         `BeforeSwapDelta` that nets out the AMM math entirely —
///         the pool exists as a routing/charting surface only.
///
/// @dev    Reserve is held as ERC-6909 currency0 (ETH) claim tokens
///         with the PoolManager. Token accumulating from burns is
///         held as currency1 (ascend) claim tokens; the public
///         `sweep()` periodically burns those tokens from circulation
///         and routes the tile share to TileEngine.
///
///         Curve parameters (exponential bonding curve):
///           K = 100,000,000 ascend  (asymptotic supply cap)
///           S = 20 ETH            (curve scale factor)
///         Fee parameters:
///           MINT_FEE_BPS = 70   (0.7% on mint, 50 bps reserve + 20 bps tile)
///           BURN_FEE_BPS = 70   (0.7% on burn, same split)
///         Anti-MEV:
///           MAX_MINT_PER_TX = 3.5 ETH    (per-tx vacuum cap)
///           same-block burn-after-mint reverts (anti-flash-loan)
contract AscendHookV3 is BaseHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;
    using SafeCast for int256;

    // -----------------------------------------------------------------
    // curve and economics constants
    // -----------------------------------------------------------------

    /// @notice Asymptotic supply cap. The curve makes minting beyond
    ///         this point increasingly expensive; effective reachable
    ///         supply is bounded near this value.
    uint256 public constant K = 100_000_000 * 1e18;

    /// @notice Curve scale factor. Higher S → flatter curve.
    ///         Mainnet calibration: S = 20 ETH for slow
    ///         meaningful USD prices ($1+) within a ~3 ETH cumulative
    ///         budget. This S is sized to
    ///         spread mining across a much larger ETH budget.
    uint256 public constant S = 20 ether;

    /// @notice Total mint fee in basis points (0.7%).
    uint256 public constant MINT_FEE_BPS = 70;

    /// @notice Total burn fee in basis points (0.7%).
    uint256 public constant BURN_FEE_BPS = 70;

    /// @notice Tile share, in basis points. Sent to TileEngine on sweep.
    ///         Reserve fee = total fee − tile share, retained as reserve.
    uint256 public constant TILE_FEE_BPS = 20;

    /// @notice Surplus take, in BPS. 3% of every (post-fee) mint goes
    ///         to a separate `surplusReserve` accumulator that
    ///         overcollateralizes the curve. NEVER advances the curve
    ///         and NEVER mints supply — pure backing buffer that gets
    ///         spent on long-hold burn bonuses.
    uint256 public constant SURPLUS_BPS = 300;

    /// @notice Token-side burn fee on sells (1% of input destroyed
    ///         without ETH out). Compounds the (mF/supply) ratio.
    uint256 public constant BURN_TOKEN_FEE_BPS = 100;

    // ----- block-age burn penalty (smooth exponential decay) --------
    /// Penalty applied to burn payout based on blocks since the
    /// burner's last receive. Stolen amount is recycled into surplusReserve.
    /// Smooth exponential decay:
    ///     payout(b) = FLOOR + (CEIL − FLOOR) · (1 − e^(−b/TAU))
    /// where TAU is the decay constant (in blocks). Past CAP_BLOCKS the
    /// value is so close to CEIL that we hard-code it to save the exp call.
    uint256 public constant PENALTY_FLOOR_BPS  = 9000;   // 90% at block 0
    uint256 public constant PENALTY_CEIL_BPS   = 10000;  // 100% asymptote
    uint256 public constant PENALTY_TAU_BLOCKS = 100;    // decay constant
    uint256 public constant PENALTY_CAP_BLOCKS = 1000;   // past this, return CEIL

    // ----- reserve-aware burn bonus ---------------------------------
    /// When `surplusReserve / cumulativeEthIn` exceeds the trigger,
    /// burns get a bonus paid out of the surplus. Capped at MAX_BONUS_BPS.
    uint256 public constant BONUS_TRIGGER_BPS = 1000;      // 10% over-collateralized
    uint256 public constant MAX_BONUS_BPS     = 500;       // 5% max bonus
    uint256 public constant BONUS_SLOPE_DIVISOR = 5;       // bonus = (ratio − trigger) / slope

    /// @notice Denominator for fee/bps math.
    uint256 public constant FEE_DENOM = 10_000;

    /// @notice Per-tx mint cap to prevent vacuum-mints.
    uint256 public constant MAX_MINT_PER_TX = 3.5 ether;

    // -----------------------------------------------------------------
    // immutable state
    // -----------------------------------------------------------------

    Ascend public immutable ascend;
    TileEngine public immutable tileEngine;
    uint256 public immutable deploymentBlock;
    Currency internal immutable _ETH = CurrencyLibrary.ADDRESS_ZERO;

    // -----------------------------------------------------------------
    // mutable state
    // -----------------------------------------------------------------

    /// @notice Net cumulative ETH paid in (after fees). The "e" in q(e).
    ///         Monotone non-decreasing — frozen on burns.
    uint256 public cumulativeEthIn;

    /// @notice Stored fair supply. Incremented by _curveForward() on each
    ///         mint; never decremented. Differs from forwardSupply (which
    ///         is the formula q(cumulativeEthIn) evaluated freshly) by
    ///         a drift value — this is the structural PRBMath rounding
    ///         gap that grows with every trade and is the reason mint
    ///         price > burn price.
    uint256 public mintedFair;

    /// @notice Current fair supply on the curve. Equal to mintedFair on a
    ///         freshly-deployed contract; less after burns. Tracked
    ///         separately from the ERC-20 totalSupply because burned
    ///         tokens accumulate as hook claim tokens until `sweep()` is
    ///         called.
    uint256 public currentSupply;

    /// @notice TileEngine accrual accumulating from mint+burn fees.
    ///         Sent to TileEngine on `sweep()`.
    uint256 public tileAccrual;

    /// @notice Overcollateralization buffer. Grows by SURPLUS_BPS of
    ///         every mint and by penalty fees on early burns. Drained
    ///         by reserve-aware burn bonuses. Always counted toward
    ///         `reserveEth()` because the actual ETH lives in the
    ///         hook's currency0 claim balance — `surplusReserve` is
    ///         just the ledger entry tracking how much of that pool is
    ///         beyond curve obligations.
    uint256 public surplusReserve;

    PoolKey public poolKey;
    PoolId public poolId;
    bool public isInitialized;

    /// @notice Last block in which `tx.origin` initiated a mint. Same-block
    ///         burn-after-mint reverts (anti-flash-loan).
    mapping(address => uint256) public lastMintBlock;

    /// @notice Per-holder weighted-average block at which the holder's
    ///         current balance was acquired. Updated via `onTokenReceive`
    ///         on every mint AND every incoming transfer, weighted by
    ///         amount. Drives the block-age burn penalty so that
    ///         routing tokens through a fresh wallet doesn't dodge it.
    mapping(address => uint256) public weightedReceiveBlock;

    // -----------------------------------------------------------------
    // errors and events
    // -----------------------------------------------------------------

    error AlreadyInitialized();
    error NotInitialized();
    error WrongCurrencyZero();
    error WrongCurrencyOne();
    error WrongFeeOrTickSpacing();
    error LiquidityNotAllowed();
    error WrongPool();
    error MintTooLarge();
    error MintTooSmall();
    error ExactOutputUnsupported();
    error SameBlockBurnAfterMint();
    error CurveExhausted();
    error InsufficientReserve();
    error UnsolicitedETH();
    error UnauthorizedCaller();

    event Mint(
        address indexed sender,
        uint256 ethIn,
        uint256 totalFee,
        uint256 tileShare,
        uint256 mintAmount,
        uint256 newEthCum,
        uint256 newSupply
    );
    event Burn(
        address indexed sender,
        uint256 ascendIn,
        uint256 totalFee,
        uint256 tileShare,
        uint256 ethOut,
        uint256 newEthCum,
        uint256 newSupply
    );
    event Swept(uint256 ascendBurned, uint256 ethToTile, uint256 newReserve);
    event ClaimMint(address indexed recipient, uint256 ethIn, uint256 mintAmount);

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
        ascend = new Ascend(address(this));
        tileEngine = new TileEngine(address(this), IERC20(address(ascend)));
        deploymentBlock = block.number;
    }

    // -----------------------------------------------------------------
    // permissions
    // -----------------------------------------------------------------

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: true,
            beforeRemoveLiquidity: true,
            afterAddLiquidity: false,
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
    // afterInitialize — bind to one pool, validate config
    // -----------------------------------------------------------------

    function _afterInitialize(address, PoolKey calldata key, uint160, int24)
        internal
        override
        returns (bytes4)
    {
        if (isInitialized) revert AlreadyInitialized();
        if (!key.currency0.isAddressZero()) revert WrongCurrencyZero();
        if (Currency.unwrap(key.currency1) != address(ascend)) revert WrongCurrencyOne();
        if (key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG || key.tickSpacing == 0) {
            revert WrongFeeOrTickSpacing();
        }

        poolKey = key;
        poolId = key.toId();
        isInitialized = true;
        return BaseHook.afterInitialize.selector;
    }

    // -----------------------------------------------------------------
    // reject all external liquidity adds/removes — there is no LP
    // -----------------------------------------------------------------

    function _beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4)
    {
        revert LiquidityNotAllowed();
    }

    function _beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4)
    {
        revert LiquidityNotAllowed();
    }

    // -----------------------------------------------------------------
    // beforeSwap — implements bonding curve mint/burn via BeforeSwapDelta
    // -----------------------------------------------------------------

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!isInitialized) revert NotInitialized();
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(poolId)) revert WrongPool();
        if (params.amountSpecified > 0) revert ExactOutputUnsupported();

        uint256 amountIn = uint256(-params.amountSpecified);

        if (params.zeroForOne) {
            return _doMint(amountIn);
        } else {
            return _doBurn(amountIn);
        }
    }

    // -----------------------------------------------------------------
    // mint — ETH → ascend, dynamically issued from the curve
    // -----------------------------------------------------------------

    function _doMint(uint256 ethIn) internal returns (bytes4, BeforeSwapDelta, uint24) {
        if (ethIn > MAX_MINT_PER_TX) revert MintTooLarge();
        if (ethIn == 0) revert MintTooSmall();

        // Three-way split of every mint:
        //   1. fee   = 0.3% (10 bps after our split: 5 reserve / 5 tile? no, MINT_FEE_BPS=70)
        //              actually MINT_FEE_BPS=70 is 0.7%; tile share = 20bps of that
        //   2. surplus = 3% of post-fee → surplusReserve (overcollateralization)
        //   3. curve = remainder → advances cumulativeEthIn
        uint256 totalFee = (ethIn * MINT_FEE_BPS) / FEE_DENOM;
        uint256 tileShare = (ethIn * TILE_FEE_BPS) / FEE_DENOM;
        if (tileShare > totalFee) tileShare = totalFee;

        uint256 postFee = ethIn - totalFee;
        uint256 surplusTake = (postFee * SURPLUS_BPS) / FEE_DENOM;
        uint256 ethToCurve = postFee - surplusTake;
        if (ethToCurve == 0) revert MintTooSmall();

        // Anti-flash-loan: record the block.
        lastMintBlock[tx.origin] = block.number;

        // Curve forward: q(e_new) − q(e_old).
        uint256 ethCumOld = cumulativeEthIn;
        uint256 ethCumNew = ethCumOld + ethToCurve;
        uint256 mintAmount = _curveForward(ethCumOld, ethCumNew);
        if (mintAmount == 0) revert CurveExhausted();

        // State updates: curve advances by ethToCurve (97% of post-fee),
        // user gets the full mintAmount, surplus accumulates separately.
        cumulativeEthIn = ethCumNew;
        mintedFair += mintAmount;
        currentSupply += mintAmount;
        tileAccrual += tileShare;
        surplusReserve += surplusTake;

        // V4 plumbing:
        poolManager.sync(poolKey.currency1);
        ascend.mint(address(poolManager), mintAmount);
        poolManager.settle();
        poolManager.mint(address(this), _ETH.toId(), ethIn);

        emit Mint(tx.origin, ethIn, totalFee, tileShare, mintAmount, ethCumNew, currentSupply);

        return (
            BaseHook.beforeSwap.selector,
            toBeforeSwapDelta(ethIn.toInt128(), -int256(mintAmount).toInt128()),
            0
        );
    }

    // -----------------------------------------------------------------
    // burn — ascend → ETH, redeemed against the inverse curve
    // -----------------------------------------------------------------

    function _doBurn(uint256 ascendIn) internal returns (bytes4, BeforeSwapDelta, uint24) {
        if (ascendIn == 0) revert MintTooSmall();
        if (lastMintBlock[tx.origin] == block.number) revert SameBlockBurnAfterMint();
        if (ascendIn >= currentSupply) revert CurveExhausted();

        // exponential-curve burn. mintedFair (= q(cumulativeEthIn)) is FROZEN
        // during burns — burns don't reverse the curve. Only currentSupply
        // shrinks. The displayed floor uses (mF/supply), so it monotonically
        // rises across both mints and burns.
        //
        // The actual ETH-out computation is the *curve inverse* applied to
        // the frozen mF — same formula as a fresh-mF burn would give.
        // This is mathematically symmetric with the forward mint cost, so
        // a round-trip mint-then-burn nets out to just the fee.
        //
        //     Δe = S · ln((K − mF + b) / (K − mF))      [gross, before fee]
        //     ethOut = Δe · (1 − fee)
        uint256 mF = _mintedFair();
        if (mF == 0 || mF >= K) revert CurveExhausted();

        // Token-side burn fee: 1% of input destroyed outright.
        uint256 ascendBurnFee = (ascendIn * BURN_TOKEN_FEE_BPS) / FEE_DENOM;
        uint256 ascendToCurve = ascendIn - ascendBurnFee;
        if (ascendToCurve == 0) revert MintTooSmall();

        uint256 deltaE = _curveInverse(mF, ascendToCurve);
        uint256 totalFee = (deltaE * BURN_FEE_BPS) / FEE_DENOM;
        uint256 tileShare = (deltaE * TILE_FEE_BPS) / FEE_DENOM;
        if (tileShare > totalFee) tileShare = totalFee;
        uint256 basePayout = deltaE - totalFee;

        // Block-age penalty. Per-holder weighted receive block — closes
        // the transfer-bypass exploit (sending tokens to a fresh wallet
        // before burning would otherwise reset age to "ancient").
        uint256 wrb = weightedReceiveBlock[tx.origin];
        // If the burner never received any tracked tokens, treat as
        // tier-1 (max penalty) — they shouldn't be holding ascend
        // without our tracking knowing about it. Fail-closed.
        uint256 holdAge = wrb == 0 ? 0 : block.number - wrb;
        uint256 multBps = _penaltyMultBps(holdAge);
        uint256 grossPayout = (basePayout * multBps) / FEE_DENOM;
        uint256 penaltyTaken = basePayout - grossPayout;

        // Reserve-aware bonus, paid out of surplusReserve.
        uint256 bonusBps = _bonusBps();
        uint256 bonusAmount = (grossPayout * bonusBps) / FEE_DENOM;
        if (bonusAmount > surplusReserve + penaltyTaken) {
            bonusAmount = surplusReserve + penaltyTaken;
        }

        uint256 ethOut = grossPayout + bonusAmount;
        if (ethOut > reserveEthInternal()) revert InsufficientReserve();

        // State updates
        currentSupply -= ascendIn;
        tileAccrual += tileShare;
        // Surplus accounting: gain from penalty, lose from bonus.
        surplusReserve = surplusReserve + penaltyTaken - bonusAmount;

        // V4 plumbing:
        // 1. Take the user's ascend as currency1 claim tokens. PM's actual
        //    ascend balance will rise when the swapper settles after swap;
        //    these claims then represent burnable supply — `sweep()`
        //    later actually burns the ERC-20 supply.
        //    Effect: hook currency1 delta −= ascendIn, claims += ascendIn.
        poolManager.mint(address(this), poolKey.currency1.toId(), ascendIn);

        // 2. Burn currency0 claims to credit the hook's currency0 delta
        //    by ethOut. Effect: hook currency0 delta += ethOut, claims −= ethOut.
        //    The BeforeSwapDelta below subtracts ethOut, netting to 0.
        poolManager.burn(address(this), _ETH.toId(), ethOut);

        emit Burn(tx.origin, ascendIn, totalFee, tileShare, ethOut, cumulativeEthIn, currentSupply);

        // BeforeSwapDelta(+ascendIn specified, −ethOut unspecified):
        //  • specified += ascendIn → AMM amountToSwap = 0
        //  • hook delta += (zeroForOne=false → swap order)
        //    hookDelta currency0 = unspecified = −ethOut
        //    hookDelta currency1 = specified   = +ascendIn
        //    combined with prior burn-claim (+ethOut currency0) and
        //    mint-claim (−ascendIn currency1): hook deltas net to 0 ✓
        //  • caller swapDelta = 0 − hookDelta = (+ethOut, −ascendIn)
        return (
            BaseHook.beforeSwap.selector,
            toBeforeSwapDelta(ascendIn.toInt128(), -int256(ethOut).toInt128()),
            0
        );
    }

    // -----------------------------------------------------------------
    // sweep — public cleanup: burn accumulated ascend claims, route
    // tile share to TileEngine, refresh the on-chain reserve view
    // -----------------------------------------------------------------

    function sweep() external {
        if (!isInitialized) revert NotInitialized();
        poolManager.unlock(abi.encode(SweepData(tileAccrual)));
    }

    struct SweepData {
        uint256 ethToTile;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnsolicitedETH();
        SweepData memory sd = abi.decode(data, (SweepData));

        // 1. Burn accumulated ascend claims and remove from supply.
        uint256 ascendClaims = poolManager.balanceOf(address(this), poolKey.currency1.toId());
        if (ascendClaims > 0) {
            poolManager.burn(address(this), poolKey.currency1.toId(), ascendClaims);
            poolManager.take(poolKey.currency1, address(this), ascendClaims);
            ascend.burn(address(this), ascendClaims);
        }

        // 2. Route tile share to TileEngine.
        uint256 ethToTile = sd.ethToTile;
        if (ethToTile > 0 && ethToTile <= reserveEthInternal()) {
            poolManager.burn(address(this), _ETH.toId(), ethToTile);
            poolManager.take(_ETH, address(this), ethToTile);
            tileAccrual = 0;
            // try/catch so a buggy TileEngine cannot brick sweep
            try tileEngine.depositReward{value: ethToTile}() {
                // ok
            } catch {
                // ETH stays in hook contract; can be retried by re-routing
                // through tileAccrual and another sweep.
                tileAccrual = ethToTile;
            }
        }

        emit Swept(ascendClaims, ethToTile, reserveEthInternal());
        return "";
    }

    /// @dev Internal helper because we read claim balance at multiple points
    ///      during sweep; spelled out to keep the public view stable.
    function reserveEthInternal() internal view returns (uint256) {
        return poolManager.balanceOf(address(this), _ETH.toId());
    }

    // -----------------------------------------------------------------
    // weighted-receive-block tracking — closes transfer-bypass on the
    // block-age burn penalty
    // -----------------------------------------------------------------
    //
    // The Ascend ERC-20 calls this on every mint and every transfer
    // (skipped on burns). We update the recipient's weighted-average
    // acquisition block. Burning then uses the burner's
    // `weightedReceiveBlock` (not `lastMintBlock[tx.origin]`), so:
    //
    //   • Alice mints and holds → her wRB stays at the mint block, age is full
    //   • Alice transfers to Bob (fresh) → Bob's wRB becomes the transfer block
    //     (age starts from 0 for Bob, full penalty applies if he burns soon)
    //   • Alice receives more tokens later → wRB moves toward the new block,
    //     proportional to the amount received

    function onTokenReceive(address recipient, uint256 amount) external {
        if (msg.sender != address(ascend)) revert UnauthorizedCaller();
        if (amount == 0) return;
        if (recipient == address(0) || recipient == address(this)
            || recipient == address(poolManager)) return;

        // ascend has already updated `balanceOf(recipient)` (super._update
        // ran before our callback). Subtract the inbound `amount` to get
        // the prior balance.
        uint256 priorBalance = ascend.balanceOf(recipient);
        priorBalance = priorBalance > amount ? priorBalance - amount : 0;

        if (priorBalance == 0) {
            weightedReceiveBlock[recipient] = block.number;
        } else {
            uint256 oldBlock = weightedReceiveBlock[recipient];
            uint256 newBalance = priorBalance + amount;
            weightedReceiveBlock[recipient] =
                (oldBlock * priorBalance + block.number * amount) / newBalance;
        }
    }

    // -----------------------------------------------------------------
    // claim-as-buy: TileEngine routes payout through the curve
    // -----------------------------------------------------------------
    //
    // Instead of TileEngine paying out ETH directly, claim flows mint
    // ascend to the recipient at the current curve price. Three effects:
    //   • protocol's reserve grows by the reward amount (because the
    //     ETH is added to the curve)
    //   • the curve advances, lifting price for every existing holder
    //   • the recipient receives ascend (which they can hold or burn
    //     for ETH at the current floor — their choice)
    //
    // No mint surcharge or fee is charged on this internal flow — it's
    // a protocol-level rebate, not a user-initiated mint.

    function claimReward(address recipient)
        external
        payable
        returns (uint256 mintAmount)
    {
        if (msg.sender != address(tileEngine)) revert UnauthorizedCaller();
        if (!isInitialized) revert NotInitialized();
        if (msg.value == 0) return 0;

        uint256 ethCumOld = cumulativeEthIn;
        uint256 ethCumNew = ethCumOld + msg.value;
        mintAmount = _curveForward(ethCumOld, ethCumNew);
        if (mintAmount == 0) revert CurveExhausted();

        cumulativeEthIn = ethCumNew;
        mintedFair += mintAmount;
        currentSupply += mintAmount;

        // Mint ascend directly to the recipient. ETH stays in this
        // contract as part of the reserve (the receive() reject path is
        // not triggered because msg.value arrives via the function call).
        ascend.mint(recipient, mintAmount);

        emit ClaimMint(recipient, msg.value, mintAmount);
    }

    // -----------------------------------------------------------------
    // views
    // -----------------------------------------------------------------

    /// @notice ETH held as currency0 claim tokens with PoolManager — the reserve.
    function reserveEth() public view returns (uint256) {
        return poolManager.balanceOf(address(this), _ETH.toId());
    }

    /// @notice The "forward" supply — what the curve formula q(e) =
    ///         K·(1−e^(−e/S)) says the supply *should* be at the current
    ///         cumulativeEthIn. Computed in one shot from the formula.
    ///         Always ≥ stored `mintedFair` (the difference is `drift()`).
    function forwardSupply() public view returns (uint256) {
        return _forwardSupply();
    }

    /// @notice Structural rounding drift = forwardSupply − mintedFair.
    ///         Grows with every trade due to PRBMath UD60x18 truncation
    ///         on each `_curveForward` increment. Always favors the
    ///         protocol (mintedFair < forward), which is why mint price
    ///         is structurally above burn price even ignoring the fee.
    function drift() external view returns (uint256) {
        uint256 fwd = _forwardSupply();
        return fwd > mintedFair ? fwd - mintedFair : 0;
    }

    /// @notice Per-token burn redemption price (the monotone-floor formula). Floor only
    ///         goes UP under both mints (mintedFair grows) and burns
    ///         (currentSupply shrinks → ratio correction grows).
    ///         = (S / (K − mF)) · (mF / currentSupply) · (1 − feeBps/10000)
    function floor() public view returns (uint256) {
        if (currentSupply == 0) return 0;
        uint256 mF = mintedFair;
        if (mF == 0 || mF >= K) return 0;
        UD60x18 marginal = div(mul(ud(S), ud(mF)), sub(ud(K), ud(mF)));
        UD60x18 perToken = div(marginal, ud(currentSupply));
        UD60x18 afterFee = mul(perToken, div(ud(FEE_DENOM - BURN_FEE_BPS), ud(FEE_DENOM)));
        return intoUint256(afterFee);
    }

    /// @notice Marginal mint price in ETH per ascend, before fee.
    ///         = S/K · e^(e/S)  (the curve's forward-marginal price)
    function spotPrice() public view returns (uint256) {
        UD60x18 base = div(ud(S), ud(K));
        UD60x18 expTerm = exp(div(ud(cumulativeEthIn), ud(S)));
        return intoUint256(mul(base, expTerm));
    }

    /// @notice Quote a mint of `ethIn` — returns ascend received and the
    ///         protocol fee. The 3% surplus take is NOT a user-visible
    ///         loss in tokens; it just means a smaller slice of `ethIn`
    ///         advances the curve, so the user gets fewer tokens per
    ///         ETH than the bare curve would suggest.
    function quoteMint(uint256 ethIn) external view returns (uint256 mintAmount, uint256 totalFee) {
        if (ethIn > MAX_MINT_PER_TX || ethIn == 0) return (0, 0);
        totalFee = (ethIn * MINT_FEE_BPS) / FEE_DENOM;
        uint256 postFee = ethIn - totalFee;
        uint256 surplusTake = (postFee * SURPLUS_BPS) / FEE_DENOM;
        uint256 ethToCurve = postFee - surplusTake;
        if (ethToCurve == 0) return (0, totalFee);
        mintAmount = _curveForward(cumulativeEthIn, cumulativeEthIn + ethToCurve);
    }

    /// @notice Quote a burn of `ascendIn` for `burner` — applies the 1%
    ///         token-side fee, the curve-inverse, the protocol fee, the
    ///         block-age penalty (using `burner`'s weightedReceiveBlock),
    ///         and the reserve-aware bonus.
    function quoteBurn(uint256 ascendIn, address burner) external view returns (uint256 ethOut, uint256 totalFee) {
        if (ascendIn == 0 || ascendIn >= currentSupply) return (0, 0);
        uint256 mF = mintedFair;
        if (mF == 0 || mF >= K) return (0, 0);
        uint256 ascendBurnFee = (ascendIn * BURN_TOKEN_FEE_BPS) / FEE_DENOM;
        uint256 ascendToCurve = ascendIn - ascendBurnFee;
        if (ascendToCurve == 0) return (0, 0);
        uint256 deltaE = _curveInverse(mF, ascendToCurve);
        totalFee = (deltaE * BURN_FEE_BPS) / FEE_DENOM;
        uint256 basePayout = deltaE - totalFee;

        uint256 wrb = weightedReceiveBlock[burner];
        uint256 holdAge = wrb == 0 ? 0 : block.number - wrb;
        uint256 grossPayout = (basePayout * _penaltyMultBps(holdAge)) / FEE_DENOM;
        uint256 bonusBps = _bonusBps();
        uint256 bonus = (grossPayout * bonusBps) / FEE_DENOM;
        uint256 penaltyTaken = basePayout - grossPayout;
        if (bonus > surplusReserve + penaltyTaken) bonus = surplusReserve + penaltyTaken;
        ethOut = grossPayout + bonus;
    }

    // -----------------------------------------------------------------
    // curve math (pure)
    // -----------------------------------------------------------------

    /// @dev mintAmount for advancing cumulativeEthIn from ePrev to eNext.
    ///      = K · (e^(−ePrev/S) − e^(−eNext/S))
    ///      = K · (1/exp(ePrev/S) − 1/exp(eNext/S))
    function _curveForward(uint256 ePrev, uint256 eNext) internal pure returns (uint256) {
        UD60x18 invOld = div(UNIT, exp(div(ud(ePrev), ud(S))));
        UD60x18 invNew = div(UNIT, exp(div(ud(eNext), ud(S))));
        if (intoUint256(invOld) <= intoUint256(invNew)) return 0;
        return intoUint256(mul(ud(K), sub(invOld, invNew)));
    }

    /// @dev Δe for burning b ascend out of supply q (forward inverse curve).
    ///      = S · ln((K − q + b) / (K − q))
    ///      Used by tests and any code that wants the V3-naive inverse.
    function _curveInverse(uint256 q, uint256 b) internal pure returns (uint256) {
        UD60x18 num = add(sub(ud(K), ud(q)), ud(b));
        UD60x18 denom = sub(ud(K), ud(q));
        UD60x18 ratio = div(num, denom);
        UD60x18 lnRatio = ln(ratio);
        return intoUint256(mul(ud(S), lnRatio));
    }

    // -----------------------------------------------------------------
    // economic-policy helpers
    // -----------------------------------------------------------------

    /// @dev Block-age burn penalty multiplier in BPS. Smooth exponential
    ///      decay — every additional block aged moves the payout up by a
    ///      continuously decreasing amount. No corners, no cliffs. The
    ///      "stolen" portion gets recycled into surplusReserve.
    ///
    ///         payout(b) = FLOOR + (CEIL − FLOOR) · (1 − e^(−b/TAU))
    ///
    ///      Past CAP_BLOCKS the exponential is within rounding of zero
    ///      (e^(−10) ≈ 4.5e-5, so payout ≈ CEIL − 0.045 bps); short-circuit
    ///      to CEIL to skip the exp call and save gas on long holds.
    function _penaltyMultBps(uint256 blocksHeld) internal pure returns (uint256) {
        if (blocksHeld >= PENALTY_CAP_BLOCKS) return PENALTY_CEIL_BPS;
        if (blocksHeld == 0) return PENALTY_FLOOR_BPS;
        // factor = 1 − 1/e^(blocks/TAU). UD60x18 fixed-point.
        UD60x18 ratio = div(ud(blocksHeld * 1e18), ud(PENALTY_TAU_BLOCKS * 1e18));
        UD60x18 invExp = div(UNIT, exp(ratio));
        UD60x18 factor = sub(UNIT, invExp);
        uint256 span = PENALTY_CEIL_BPS - PENALTY_FLOOR_BPS;
        uint256 reduction = (span * intoUint256(factor)) / 1e18;
        return PENALTY_FLOOR_BPS + reduction;
    }

    /// @dev Reserve-aware burn bonus, in BPS. Activates when surplus
    ///      exceeds BONUS_TRIGGER_BPS (10%) of curve-owed reserves.
    ///      Linear ramp at 1/BONUS_SLOPE_DIVISOR; capped at MAX_BONUS_BPS.
    ///      The bonus comes out of `surplusReserve`.
    function _bonusBps() internal view returns (uint256) {
        if (cumulativeEthIn == 0) return 0;
        uint256 ratioBps = (surplusReserve * FEE_DENOM) / cumulativeEthIn;
        if (ratioBps <= BONUS_TRIGGER_BPS) return 0;
        uint256 bps = (ratioBps - BONUS_TRIGGER_BPS) / BONUS_SLOPE_DIVISOR;
        if (bps > MAX_BONUS_BPS) bps = MAX_BONUS_BPS;
        return bps;
    }

    /// @notice Public view of the surplus ratio (in BPS) for the dapp.
    function surplusRatioBps() external view returns (uint256) {
        if (cumulativeEthIn == 0) return 0;
        return (surplusReserve * FEE_DENOM) / cumulativeEthIn;
    }

    /// @notice Public view of the current burn bonus (in BPS).
    function currentBonusBps() external view returns (uint256) {
        return _bonusBps();
    }

    /// @notice Public view of the burn penalty multiplier for `blocksHeld`.
    function penaltyMultBps(uint256 blocksHeld) external pure returns (uint256) {
        return _penaltyMultBps(blocksHeld);
    }

    /// @dev Forward curve position implied by cumulativeEthIn.
    ///      q(e) = K · (1 − e^(−e/S)). Computed in one shot — slightly
    ///      higher than the stored stepwise `mintedFair` due to rounding.
    function _forwardSupply() internal view returns (uint256) {
        if (cumulativeEthIn == 0) return 0;
        UD60x18 invE = div(UNIT, exp(div(ud(cumulativeEthIn), ud(S))));
        return intoUint256(mul(ud(K), sub(UNIT, invE)));
    }

    /// @dev Lookup of mintedFair used by _doMint and _doBurn (kept for
    ///      symmetry with the previous internal API).
    function _mintedFair() internal view returns (uint256) {
        return mintedFair;
    }

    // -----------------------------------------------------------------
    // ETH receiver — only PoolManager allowed
    // -----------------------------------------------------------------

    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnsolicitedETH();
    }
}
