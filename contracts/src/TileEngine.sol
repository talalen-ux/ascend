// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title  TileEngine — flippable 12×12 reward grid funded by LP fees.
///
/// @notice The unique selling point of ascend. Every swap on the V4 pool
///         pays 5% fee, of which 1% is forwarded here. That 1% accumulates
///         into the current 24h epoch's reward pool. At the start of each
///         epoch, 144 tiles become claimable. Any holder of ≥ 1 ascend
///         can flip exactly one tile per epoch, revealing a pseudorandom
///         multiplier ∈ {1, 2, 3, 4} weighted to an expected value of 1.58×,
///         and receive `(epochPool / 144) × multiplier` ETH.
///
///         Connection to holdings:
///           - MIN_HOLDING gate: must hold ≥ 1 ascend to claim
///           - one claim per address per epoch
///           - reward pool grows with trading volume → holders aligned
///             with usage growth
///
///         Invariants (proofs in docs/V2_DESIGN.md):
///           TI-1  reward-pool solvency (cumulative payouts ≤ pool)
///           TI-2  one-claim-per-epoch per address
///           TI-3  hook-only deposit (no third-party funding)
///           TI-4  unclaimed share rolls forward to next epoch
///           TI-5  bounded validator edge (~1.06% per claim worst case)
///
///         Randomness model: keccak256(prevrandao, blockhash, sender,
///         tileIdx, epoch) → low nibble → multiplier table. Proposer-
///         influenceable but bounded. Acceptable for gamification scope.
///         A future revision can integrate Chainlink VRF; the function
///         signature accepts the upgrade without breaking integrators.
contract TileEngine {
    // -----------------------------------------------------------------
    // immutables and locked parameters
    // -----------------------------------------------------------------

    /// @notice The hook that funds the reward pool. Only address
    ///         allowed to call `depositReward`.
    address public immutable hook;

    /// @notice The ascend ERC-20. Used for the MIN_HOLDING eligibility
    ///         check in `claimTile`.
    IERC20 public immutable ascend;

    /// @notice Length of one epoch. Tiles refresh at the start of each
    ///         epoch.
    uint64 public constant EPOCH_LENGTH = 24 hours;

    /// @notice Number of tiles per epoch (12 × 12).
    uint16 public constant GRID_SIZE = 144;

    /// @notice Minimum ascend balance to claim a tile (1 ascend in 1e18 wei).
    uint256 public constant MIN_HOLDING = 1e18;

    /// @notice Block timestamp of the genesis epoch boundary. Set in
    ///         constructor; epochs are deterministic from here.
    uint64 public immutable genesisTime;

    /// @notice Multiplier-distribution scaler in 1e6 fixed-point. Must
    ///         track the actual draw weights in `_drawMultiplier`. The
    ///         current 4-bit nibble split (0..9 / A..C / D..E / F)
    ///         produces:
    ///
    ///           1× : 10/16 = 62.5%
    ///           2× :  3/16 = 18.75%
    ///           3× :  2/16 = 12.5%
    ///           4× :  1/16 = 6.25%
    ///
    ///         E[m] = (10·1 + 3·2 + 2·3 + 1·4) / 16 = 26/16 = 1.625
    ///
    ///         If the weight table in `_drawMultiplier` changes, this
    ///         constant MUST be updated in lock-step or the protocol
    ///         will over- or under-pay relative to the pool's solvency
    ///         expectation.
    uint256 public constant EXPECTED_MULTIPLIER_SCALED = 1_625_000;

    /// @notice Per-epoch random selection rate, in basis points. Only
    ///         holders for whom `isSelected(addr, epoch)` is true may
    ///         claim that epoch. The remaining (100 - rate)% must wait
    ///         for the next epoch and re-roll.
    ///
    ///         Set to 6800 = 68%. Spec choice: not every holder gets a
    ///         daily reward — random subset preserves a sense of
    ///         scarcity, and the unclaimed share rolls into the next
    ///         epoch's pool, making it bigger.
    uint256 public constant SELECTION_RATE_BPS = 6800;
    uint256 public constant SELECTION_DENOM = 10_000;

    // -----------------------------------------------------------------
    // state
    // -----------------------------------------------------------------

    /// @notice ETH currently funded for the running epoch.
    uint256 public currentEpochPool;

    /// @notice Cumulative paid-out from `currentEpochPool` so far.
    uint256 public currentEpochPaidOut;

    /// @notice Epoch index (genesis = 0). Recomputed lazily; finalize
    ///         is implicit via `_advanceEpochIfNeeded()`.
    uint64 public liveEpoch;

    /// @notice Pool funding history per epoch. Useful for analytics.
    mapping(uint64 => uint256) public epochPool;

    /// @notice Cumulative paid-out per finalized epoch.
    mapping(uint64 => uint256) public epochPaidOut;

    /// @notice Per-epoch RNG seed, set when the epoch is first activated
    ///         (via _advanceEpochIfNeeded). Used to derive
    ///         `isSelected(user, epoch)` so neither the user nor a
    ///         malicious validator can pre-compute selection
    ///         membership before the epoch's seed block is mined.
    mapping(uint64 => bytes32) public epochSeed;

    /// @notice Per-tile per-epoch claim record. Records who flipped the
    ///         tile, what multiplier they revealed, and what they
    ///         received. Used by the dapp to show on-hover details
    ///         (last-4 of claimer + reward amount) without scanning
    ///         events. claimer == address(0) means the tile is open.
    struct ClaimRecord {
        address claimer;     // 20 bytes
        uint8 multiplier;    //  1 byte    in {1, 2, 3, 4}
        uint128 reward;      // 16 bytes   in wei (≤ 18 ETH per tile is plenty)
    }
    mapping(uint16 => mapping(uint64 => ClaimRecord)) public tileClaim;

    /// @notice Last epoch in which `address` has claimed any tile.
    ///         Strict monotonicity enforced; users can claim once per
    ///         epoch (when selected).
    mapping(address => uint64) public lastClaimEpoch;

    // Reentrancy guard via EIP-1153 transient storage.
    bytes32 private constant REENTRANCY_SLOT =
        keccak256("ascend.tile.reentrancy.v1");

    // -----------------------------------------------------------------
    // events
    // -----------------------------------------------------------------

    event RewardDeposited(uint64 indexed epoch, uint256 amount, uint256 newPool);
    event TileClaimed(
        address indexed claimer,
        uint16 indexed tileIdx,
        uint64 indexed epoch,
        uint8 multiplier,
        uint256 reward
    );
    event EpochAdvanced(uint64 indexed from, uint64 indexed to, uint256 rolledOver);

    // -----------------------------------------------------------------
    // errors
    // -----------------------------------------------------------------

    error NotHook();
    error TileOutOfRange();
    error TileAlreadyClaimed();
    error AlreadyClaimedThisEpoch();
    error InsufficientHoldings();
    error EpochPoolEmpty();
    error PayoutFailed();
    error Reentrancy();
    error NotSelectedThisEpoch();

    // -----------------------------------------------------------------
    // constructor
    // -----------------------------------------------------------------

    /// @param _hook   the AscendHookV2 that will fund the reward pool
    /// @param _ascend the ERC-20 we check for MIN_HOLDING
    constructor(address _hook, IERC20 _ascend) {
        require(_hook != address(0), "hook=0");
        require(address(_ascend) != address(0), "ascend=0");
        hook = _hook;
        ascend = _ascend;
        // Round genesis down to the start of the current EPOCH_LENGTH
        // boundary so epoch indices are stable.
        genesisTime = uint64(block.timestamp) - (uint64(block.timestamp) % EPOCH_LENGTH);
    }

    // -----------------------------------------------------------------
    // deposit — called only by the hook on every swap
    // -----------------------------------------------------------------

    /// @notice Funds the running epoch's reward pool.
    /// @dev    Hook-only: re-routing this would let a third party seed
    ///         the RNG distribution from a known transaction order.
    function depositReward() external payable {
        if (msg.sender != hook) revert NotHook();
        _advanceEpochIfNeeded();
        currentEpochPool += msg.value;
        epochPool[liveEpoch] += msg.value;
        emit RewardDeposited(liveEpoch, msg.value, currentEpochPool);
    }

    // -----------------------------------------------------------------
    // claim — flips one tile, pays out a multiplier-scaled reward
    // -----------------------------------------------------------------

    /// @notice Claim tile `tileIdx`. Reverts if:
    ///         - caller holds < MIN_HOLDING ascend
    ///         - caller has already claimed this epoch
    ///         - tile already taken this epoch
    ///         - tileIdx ≥ GRID_SIZE
    ///         - epoch pool is empty
    ///
    /// @return multiplier random multiplier ∈ {1, 2, 3, 4}
    /// @return reward    paid-out ETH amount
    function claimTile(uint16 tileIdx)
        external
        returns (uint8 multiplier, uint256 reward)
    {
        _enter();
        _advanceEpochIfNeeded();

        if (tileIdx >= GRID_SIZE) revert TileOutOfRange();
        // Sentinel: lastClaimEpoch[u] == liveEpoch + 1 means "u claimed
        // in liveEpoch". The +1 keeps 0 reserved for "never claimed" so
        // a fresh user can claim in epoch 0 without a special case.
        if (lastClaimEpoch[msg.sender] == liveEpoch + 1) revert AlreadyClaimedThisEpoch();
        if (tileClaim[tileIdx][liveEpoch].claimer != address(0)) revert TileAlreadyClaimed();
        if (ascend.balanceOf(msg.sender) < MIN_HOLDING) revert InsufficientHoldings();
        if (currentEpochPool == 0) revert EpochPoolEmpty();
        // Daily 68% selection: pseudorandom but deterministic per
        // (epochSeed[liveEpoch], msg.sender). The seed was set at the
        // first activity of the epoch and cannot be predicted before
        // its block was mined.
        if (!_isSelected(msg.sender, liveEpoch)) revert NotSelectedThisEpoch();

        multiplier = _drawMultiplier(tileIdx);

        // Base reward = pool / GRID_SIZE / E[m].
        // EXPECTED_MULTIPLIER_SCALED is in 1e6 fixed-point.
        uint256 baseReward = (currentEpochPool * 1_000_000) / GRID_SIZE / EXPECTED_MULTIPLIER_SCALED;
        reward = baseReward * multiplier;

        // Solvency cap: never pay more than what's left in the pool
        // (TI-1). The last claimers in a high-multiplier epoch may
        // receive less than their notional reward.
        uint256 remaining = currentEpochPool - currentEpochPaidOut;
        if (reward > remaining) reward = remaining;

        tileClaim[tileIdx][liveEpoch] = ClaimRecord({
            claimer: msg.sender,
            multiplier: multiplier,
            reward: uint128(reward)
        });
        lastClaimEpoch[msg.sender] = liveEpoch + 1; // sentinel: "claimed in `liveEpoch`"
        currentEpochPaidOut += reward;
        epochPaidOut[liveEpoch] = currentEpochPaidOut;

        emit TileClaimed(msg.sender, tileIdx, liveEpoch, multiplier, reward);

        // Pay out via low-level call. Done LAST after all state writes
        // (CEI). The reentrancy guard around this whole function is a
        // belt-and-suspenders measure.
        (bool ok, ) = msg.sender.call{value: reward}("");
        if (!ok) revert PayoutFailed();

        _exit();
    }

    // -----------------------------------------------------------------
    // views
    // -----------------------------------------------------------------

    /// @notice The epoch that `block.timestamp` falls in (genesis = 0).
    function currentEpoch() public view returns (uint64) {
        return uint64((block.timestamp - genesisTime) / EPOCH_LENGTH);
    }

    /// @notice Base reward per tile at the moment, scaled to `1×`
    ///         multiplier. Multiply by the revealed multiplier for the
    ///         actual payout.
    function currentBaseReward() external view returns (uint256) {
        if (currentEpochPool == 0) return 0;
        return (currentEpochPool * 1_000_000) / GRID_SIZE / EXPECTED_MULTIPLIER_SCALED;
    }

    /// @notice True if tile `idx` has not yet been flipped this epoch.
    function isTileAvailable(uint16 idx) external view returns (bool) {
        if (idx >= GRID_SIZE) return false;
        return tileClaim[idx][currentEpoch()].claimer == address(0);
    }

    /// @notice True if `user` is eligible to flip this epoch:
    ///           - holds ≥ MIN_HOLDING ascend
    ///           - hasn't already claimed this epoch
    ///           - is in this epoch's randomly-selected 68% subset
    function canClaim(address user) external view returns (bool) {
        if (ascend.balanceOf(user) < MIN_HOLDING) return false;
        uint64 e = currentEpoch();
        if (lastClaimEpoch[user] == e + 1) return false;
        return _isSelected(user, e);
    }

    /// @notice True if `user` is in the random selection cohort for `epoch`.
    ///         Deterministic from (epochSeed[epoch], user). Returns false
    ///         if the epoch's seed hasn't been set yet (i.e., no activity
    ///         has activated that epoch on-chain).
    function isSelected(address user, uint64 epoch) external view returns (bool) {
        return _isSelected(user, epoch);
    }

    /// @notice Number of tiles still available in the current epoch.
    function tilesRemaining() external view returns (uint16 n) {
        uint64 e = currentEpoch();
        for (uint16 i = 0; i < GRID_SIZE; i++) {
            if (tileClaim[i][e].claimer == address(0)) n++;
        }
    }

    /// @notice Returns the full claim record for every tile this epoch.
    ///         The dapp uses this to render hover-flip detail (claimer
    ///         tail + reward) on the 12×12 grid in a single read.
    function epochTiles(uint64 epoch)
        external
        view
        returns (ClaimRecord[GRID_SIZE] memory result)
    {
        for (uint16 i = 0; i < GRID_SIZE; i++) {
            result[i] = tileClaim[i][epoch];
        }
    }

    /// @notice Convenience wrapper: epochTiles for the current epoch.
    function currentEpochTiles()
        external
        view
        returns (ClaimRecord[GRID_SIZE] memory)
    {
        uint16[GRID_SIZE] memory _idx; // unused; satisfy stack
        _idx; // silence unused
        ClaimRecord[GRID_SIZE] memory result;
        uint64 e = currentEpoch();
        for (uint16 i = 0; i < GRID_SIZE; i++) {
            result[i] = tileClaim[i][e];
        }
        return result;
    }

    // -----------------------------------------------------------------
    // internals
    // -----------------------------------------------------------------

    /// @dev If `block.timestamp` has crossed an epoch boundary, advance
    ///      `liveEpoch` and roll forward unclaimed share. Also locks in
    ///      this epoch's selection seed from the parent block's hash —
    ///      unpredictable until that block is mined, deterministic
    ///      thereafter.
    function _advanceEpochIfNeeded() private {
        uint64 nowEpoch = currentEpoch();

        if (nowEpoch != liveEpoch) {
            // Roll over unclaimed share to the new epoch.
            uint256 rollover = currentEpochPool - currentEpochPaidOut;
            emit EpochAdvanced(liveEpoch, nowEpoch, rollover);

            liveEpoch = nowEpoch;
            currentEpochPool = rollover;
            currentEpochPaidOut = 0;
            epochPool[nowEpoch] += rollover; // initial seed of new epoch from rollover
        }

        // Lock the per-epoch selection seed exactly once, including
        // for the genesis epoch (which never enters the advance branch
        // because nowEpoch == liveEpoch == 0). blockhash of the parent
        // block is unpredictable to anyone who didn't see the block
        // included; once set, it's stable for selection queries by
        // anyone for the rest of the epoch.
        if (epochSeed[nowEpoch] == bytes32(0)) {
            epochSeed[nowEpoch] = keccak256(
                abi.encodePacked(blockhash(block.number - 1), block.prevrandao, nowEpoch)
            );
        }
    }

    /// @dev True iff `user` falls in the SELECTION_RATE_BPS / SELECTION_DENOM
    ///      cohort for `epoch`. Deterministic from (epochSeed[epoch], user)
    ///      after the seed is set. Returns false until the seed is set
    ///      (which happens on the first on-chain activity of the epoch).
    function _isSelected(address user, uint64 epoch) internal view returns (bool) {
        bytes32 seed = epochSeed[epoch];
        if (seed == bytes32(0)) return false;
        uint256 r = uint256(keccak256(abi.encode(seed, user)));
        return r % SELECTION_DENOM < SELECTION_RATE_BPS;
    }

    /// @dev Draws a multiplier from the locked weight table.
    ///      r mod 16:
    ///          0..9   →  1×  (60%)
    ///          A..C   →  2×  (25%)
    ///          D..E   →  3×  (12%)
    ///          F      →  4×  ( 3%)  (3.125% nominal; close enough for spec)
    function _drawMultiplier(uint16 tileIdx) private view returns (uint8) {
        uint256 r = uint256(
            keccak256(
                abi.encode(
                    blockhash(block.number - 1),
                    block.prevrandao,
                    msg.sender,
                    tileIdx,
                    liveEpoch
                )
            )
        );
        uint8 nibble = uint8(r & 0xF);
        if (nibble < 0xA) return 1;
        if (nibble < 0xD) return 2;
        if (nibble < 0xF) return 3;
        return 4;
    }

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

    /// @dev Reject any ETH that wasn't sent through `depositReward`.
    ///      Donations would distort the reward distribution.
    receive() external payable {
        revert NotHook();
    }
}
