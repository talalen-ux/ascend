// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/utils/BaseHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

import {SD59x18, sd, exp, ln, UNIT} from "@prb/math/src/SD59x18.sol";

/// @title  AscentHook
/// @notice Stateful Uniswap v4 hook that distorts the AMM with cumulative buy pressure.
///
///         m(E) = exp(F/S1) * (1 + ln(1 + D/S2)) / (1 + C/S3)        (clamped)
///
///         BUY  (currency0 -> currency1):  user receives baseOut / m
///         SELL (currency1 -> currency0):  user receives baseOut * m  (subsidised
///                                          from buy-side tax accumulated in hook)
///
///         Solvency is preserved by capping the sell bonus at the hook's own
///         treasury balance; if the treasury cannot cover the bonus, the bonus
///         is reduced. The system is reflexive but bounded.
///
///         This contract is illustrative. v4 hook delta semantics are subtle —
///         test thoroughly with the v4 deployer suite before any mainnet use.
contract AscentHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;
    using SafeCast for int256;

    // ---------------------------------------------------------------- state

    /// @notice Net buy pressure (currency0 in - currency0 out). Decays per block.
    int256 public F;
    /// @notice Depth — slow-moving demand integral.
    int256 public D;
    /// @notice Compression — sell-side memory; dampens the multiplier.
    int256 public C;

    /// @notice Treasury balance of currency0 collected as buy-side pressure tax.
    uint256 public treasury;

    uint256 public lastBlock;

    // ------------------------------------------------------------ constants

    int256 public constant S1 = 300 ether;
    int256 public constant S2 = 500 ether;
    int256 public constant S3 = 200 ether;

    int256 public constant DECAY_F_PER_BLOCK = 0.01 ether;
    int256 public constant DECAY_C_PER_BLOCK = 0.02 ether;

    // exp() input is clamped to [-4e18, +4e18] so m ∈ [~0.018, ~54.6]
    int256 public constant MIN_EXP_INPUT = -4e18;
    int256 public constant MAX_EXP_INPUT = 4e18;

    // ------------------------------------------------------------- events

    event StateUpdated(int256 F, int256 D, int256 C, int256 multiplier);
    event PressureTaxed(uint256 amount, uint256 treasury);
    event SellSubsidy(uint256 requested, uint256 paid, uint256 treasury);

    // ------------------------------------------------------------ ctor

    constructor(IPoolManager _manager) BaseHook(_manager) {
        lastBlock = block.number;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
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

    // ----------------------------------------------------- decay & math

    function _decay() internal {
        uint256 blocks = block.number - lastBlock;
        if (blocks == 0) return;

        int256 dF = int256(blocks) * DECAY_F_PER_BLOCK;
        int256 dC = int256(blocks) * DECAY_C_PER_BLOCK;

        if (F > 0) {
            F = F > dF ? F - dF : int256(0);
        } else if (F < 0) {
            F = F < -dF ? F + dF : int256(0);
        }
        if (C > dC) C -= dC;
        else C = 0;

        lastBlock = block.number;
    }

    /// @notice Compute the multiplier in 1e18 fixed-point. Pure of state mutation.
    function computeMultiplier() public view returns (uint256) {
        int256 fOverS1 = (F * 1e18) / S1;
        if (fOverS1 > MAX_EXP_INPUT) fOverS1 = MAX_EXP_INPUT;
        if (fOverS1 < MIN_EXP_INPUT) fOverS1 = MIN_EXP_INPUT;

        SD59x18 expTerm = exp(sd(fOverS1));

        int256 dOverS2 = (D * 1e18) / S2;
        if (dOverS2 < 0) dOverS2 = 0; // ln domain
        SD59x18 logTerm = ln(sd(int256(1e18) + dOverS2));

        SD59x18 numerator = expTerm.mul(UNIT + logTerm);

        int256 cOverS3 = (C * 1e18) / S3;
        SD59x18 denom = sd(int256(1e18) + cOverS3);

        SD59x18 m = numerator.div(denom);
        int256 mInt = m.unwrap();
        if (mInt < 0) return 0;
        return uint256(mInt);
    }

    // ----------------------------------------------------- hook callback

    /// @inheritdoc BaseHook
    function _beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        _decay();

        // We require exact-input swaps for predictable pressure accounting.
        // Exact-output flows are passed through without state mutation.
        if (params.amountSpecified >= 0) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 amountIn = uint256(-params.amountSpecified);
        uint256 m = computeMultiplier();
        BeforeSwapDelta delta = BeforeSwapDeltaLibrary.ZERO_DELTA;

        if (params.zeroForOne) {
            // BUY: tax (m-1)/m of input ETH into the treasury.
            F += int256(amountIn);
            D += int256(amountIn / 4);
            if (C > int256(amountIn / 10)) C -= int256(amountIn / 10);
            else C = 0;

            if (m > 1e18) {
                uint256 tax = (amountIn * (m - 1e18)) / m;
                if (tax > 0 && tax < amountIn) {
                    treasury += tax;
                    poolManager.take(key.currency0, address(this), tax);
                    // specifiedDelta positive => hook consumed `tax` of input.
                    delta = toBeforeSwapDelta(int128(int256(tax)), int128(0));
                    emit PressureTaxed(tax, treasury);
                }
            }
        } else {
            // SELL: pay user a bonus of (m-1) on the output ETH from treasury.
            F -= int256(amountIn);
            C += int256(amountIn);

            if (m > 1e18 && treasury > 0) {
                // Estimate raw output as amountIn (worst-case 1:1 quote);
                // a production hook would fetch the spot quote. This caps
                // the subsidy conservatively at min(treasury, requested).
                uint256 requested = (amountIn * (m - 1e18)) / 1e18;
                uint256 paid = requested > treasury ? treasury : requested;
                if (paid > 0) {
                    treasury -= paid;
                    poolManager.sync(key.currency0);
                    key.currency0.transfer(address(poolManager), paid);
                    poolManager.settle();
                    // unspecifiedDelta negative => hook supplied extra output.
                    delta = toBeforeSwapDelta(int128(0), -int128(int256(paid)));
                    emit SellSubsidy(requested, paid, treasury);
                }
            }
        }

        emit StateUpdated(F, D, C, int256(m));
        return (BaseHook.beforeSwap.selector, delta, 0);
    }
}
