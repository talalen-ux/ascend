#!/usr/bin/env bash
# scripts/bootstrap-wallets.sh — distribute initial supply across N wallets.
#
# Auto-detects two modes based on contracts/.bootstrap-wallets.json:
#
#   MODE A: file doesn't exist
#     → Generate N fresh wallets
#     → Save keys to .bootstrap-wallets.json (chmod 600)
#     → Deployer funds each with MINT_PER_WALLET+gas (default 0.105 ETH)
#     → Each wallet mints with MINT_PER_WALLET ETH (async)
#
#   MODE B: file exists (wallets pre-funded by you with variable amounts)
#     → Load keys from .bootstrap-wallets.json
#     → SKIP funding phase
#     → Each wallet mints (1 − GAS_RESERVE_PCT) × its current balance,
#       keeping the rest for gas
#     → Wallets are SORTED low → high balance: smallest stack mints first
#       (cheapest curve position), largest stack mints last (highest
#       curve position). Mints are sent SERIALLY so the on-chain order
#       is guaranteed.
#     → Wallets below MIN_MINT_AMOUNT are skipped (uneconomic)
#
# Configurable via env:
#   NUM_WALLETS=20         (mode A only — mode B uses file length)
#   MINT_PER_WALLET=0.1    (mode A only)
#   GAS_BUFFER=0.005       (mode A only — extra ETH for mint gas)
#   GAS_RESERVE_PCT=15     (mode B — % of balance held back for gas)
#   MIN_MINT_AMOUNT=0.005  (mode B — skip wallets below this mint size)
#   FORCE_FUND=1           (force mode A even if file exists)
# --------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)"
ENV_FILE="$REPO_ROOT/contracts/.env.mainnet"
WALLETS_FILE="$REPO_ROOT/contracts/.bootstrap-wallets.json"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "missing $ENV_FILE" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PRIVATE_KEY:?PRIVATE_KEY required in $ENV_FILE}"
: "${MAINNET_RPC_URL:?MAINNET_RPC_URL required in $ENV_FILE}"
: "${ASCEND_ROUTER:?ASCEND_ROUTER required — add it to $ENV_FILE after deploy}"

CAST="$HOME/.foundry/bin/cast"
RPC="$MAINNET_RPC_URL"

MINT_PER_WALLET=${MINT_PER_WALLET:-0.1}
GAS_BUFFER=${GAS_BUFFER:-0.005}
NUM_WALLETS=${NUM_WALLETS:-20}
FORCE_FUND=${FORCE_FUND:-0}
GAS_RESERVE_PCT=${GAS_RESERVE_PCT:-15}
MIN_MINT_AMOUNT=${MIN_MINT_AMOUNT:-0.005}

# Priority fee tip (gwei) for bootstrap mint txs. 5 gwei makes our txs
# expensive to outbid for a low-cap launch; snipers chasing one
# position would have to pay similarly or more, eating into their
# upside (MAX_MINT_PER_TX = 3.5 ETH cap). Set to 0 to disable.
PRIORITY_TIP_GWEI=${PRIORITY_TIP_GWEI:-5}

# -------------------------------------------------------------------
# Detect mode
# -------------------------------------------------------------------
MODE=""
if [[ -f "$WALLETS_FILE" ]] && [[ "$FORCE_FUND" != "1" ]]; then
    MODE="B"
    # Count entries
    NUM_WALLETS=$(python3 -c "import json; print(len(json.load(open('$WALLETS_FILE'))))")
    echo "Mode B: using existing $WALLETS_FILE ($NUM_WALLETS wallets)"
else
    MODE="A"
    echo "Mode A: generating $NUM_WALLETS fresh wallets"
fi

# -------------------------------------------------------------------
# Load or generate wallets
# -------------------------------------------------------------------
declare -a ADDRS=()
declare -a KEYS=()

if [[ "$MODE" == "B" ]]; then
    while IFS= read -r line; do
        ADDRS+=("$(echo "$line" | cut -d'|' -f1)")
        KEYS+=("$(echo "$line" | cut -d'|' -f2)")
    done < <(python3 -c "
import json
for w in json.load(open('$WALLETS_FILE')):
    print(f\"{w['address']}|{w['privateKey']}\")
")
else
    echo "Generating wallets..."
    for i in $(seq 1 "$NUM_WALLETS"); do
        OUT=$($CAST wallet new)
        ADDR=$(echo "$OUT" | grep -E "^Address:" | awk '{print $2}')
        KEY=$(echo "$OUT" | grep -E "^Private key:" | awk '{print $3}')
        ADDRS+=("$ADDR")
        KEYS+=("$KEY")
        printf "  [%2d/%d] %s\n" "$i" "$NUM_WALLETS" "$ADDR"
    done
    {
        echo "["
        for i in "${!ADDRS[@]}"; do
            if [[ $i -lt $((${#ADDRS[@]} - 1)) ]]; then SEP=","; else SEP=""; fi
            printf '  {"address": "%s", "privateKey": "%s"}%s\n' "${ADDRS[$i]}" "${KEYS[$i]}" "$SEP"
        done
        echo "]"
    } > "$WALLETS_FILE"
    chmod 600 "$WALLETS_FILE"
    echo "  → keys saved to $WALLETS_FILE (chmod 600)"
fi

# -------------------------------------------------------------------
# Pre-flight summary
# -------------------------------------------------------------------
DEPLOYER=$($CAST wallet address --private-key "$PRIVATE_KEY")
BAL_DEPLOYER=$($CAST balance "$DEPLOYER" --rpc-url "$RPC" --ether)
GAS_GWEI=$(echo "scale=2; $($CAST gas-price --rpc-url "$RPC") / 1000000000" | bc)

# -------------------------------------------------------------------
# Mode B: compute per-wallet mint sizes from on-chain balances and
# sort low → high so the cheapest stack hits the curve first.
# -------------------------------------------------------------------
declare -a MINT_ORDER_ADDR=()
declare -a MINT_ORDER_KEY=()
declare -a MINT_ORDER_WEI=()
declare -a MINT_ORDER_BAL_ETH=()
SKIPPED_COUNT=0
TOTAL_MINT_WEI=0

if [[ "$MODE" == "B" ]]; then
    echo ""
    echo "Reading on-chain balances and sizing mints ($GAS_RESERVE_PCT% held back for gas)..."
    # Build a "balanceWei|index" list, sort numerically by balance ascending.
    BAL_LIST=""
    for i in "${!ADDRS[@]}"; do
        ADDR="${ADDRS[$i]}"
        BAL_WEI=$($CAST balance "$ADDR" --rpc-url "$RPC")
        BAL_LIST="${BAL_LIST}${BAL_WEI}|${i}"$'\n'
    done

    # Stable numeric sort, ascending by balance.
    MIN_WEI=$($CAST --to-wei "$MIN_MINT_AMOUNT" ether)
    SORTED=$(printf "%s" "$BAL_LIST" | sort -t'|' -k1,1n)

    while IFS='|' read -r BAL_WEI IDX; do
        [[ -z "$BAL_WEI" ]] && continue
        ADDR="${ADDRS[$IDX]}"
        KEY="${KEYS[$IDX]}"
        BAL_ETH=$(echo "scale=6; $BAL_WEI / 1000000000000000000" | bc)
        # mint = balance * (1 - GAS_RESERVE_PCT/100)
        MINT_WEI=$(python3 -c "print(int(int('$BAL_WEI') * (100 - $GAS_RESERVE_PCT) // 100))")
        MINT_ETH=$(echo "scale=6; $MINT_WEI / 1000000000000000000" | bc)

        if [[ $(echo "$MINT_WEI < $MIN_WEI" | bc) == "1" ]]; then
            printf "  skip  %s : bal %s ETH (mint %s < min %s)\n" \
                "$ADDR" "$BAL_ETH" "$MINT_ETH" "$MIN_MINT_AMOUNT"
            SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
            continue
        fi

        MINT_ORDER_ADDR+=("$ADDR")
        MINT_ORDER_KEY+=("$KEY")
        MINT_ORDER_WEI+=("$MINT_WEI")
        MINT_ORDER_BAL_ETH+=("$BAL_ETH")
        TOTAL_MINT_WEI=$(echo "$TOTAL_MINT_WEI + $MINT_WEI" | bc)
    done <<< "$SORTED"

    TOTAL_MINT_ETH=$(echo "scale=6; $TOTAL_MINT_WEI / 1000000000000000000" | bc)
    ACTIVE_COUNT=${#MINT_ORDER_ADDR[@]}
else
    # Mode A: fixed plan, all mints equal.
    FUND_PER_WALLET=$(echo "scale=6; $MINT_PER_WALLET + $GAS_BUFFER" | bc)
    TOTAL_FUND=$(echo "scale=6; $FUND_PER_WALLET * $NUM_WALLETS" | bc)
    TOTAL_MINT_ETH=$(echo "scale=6; $MINT_PER_WALLET * $NUM_WALLETS" | bc)
    ACTIVE_COUNT=$NUM_WALLETS
fi

echo ""
cat <<EOF
═══════════════════════════════════════════════════════════════
              BOOTSTRAP WALLETS — PRE-FLIGHT
═══════════════════════════════════════════════════════════════
  Mode            : $MODE $([ "$MODE" == "B" ] && echo "(pre-funded; dynamic sizing)" || echo "(deployer funds wallets)")
  Wallets total   : $NUM_WALLETS
EOF

if [[ "$MODE" == "A" ]]; then
cat <<EOF
  Mint/wallet     : $MINT_PER_WALLET ETH
  Fund/wallet     : $FUND_PER_WALLET ETH (mint + $GAS_BUFFER gas buffer)
  Total fund      : $TOTAL_FUND ETH (from deployer)
  Deployer bal    : $BAL_DEPLOYER ETH
EOF
else
cat <<EOF
  Active wallets  : $ACTIVE_COUNT (skipped $SKIPPED_COUNT under $MIN_MINT_AMOUNT ETH)
  Gas reserve     : $GAS_RESERVE_PCT% per wallet
  Mint order      : low → high balance (smallest curve position first)
EOF
fi

cat <<EOF
  Total mint vol  : $TOTAL_MINT_ETH ETH (curve advance)
  Router          : $ASCEND_ROUTER
  Gas price       : $GAS_GWEI gwei
═══════════════════════════════════════════════════════════════
EOF

if [[ "$MODE" == "B" ]]; then
    echo ""
    echo "Mint plan (low → high):"
    for i in "${!MINT_ORDER_ADDR[@]}"; do
        MINT_ETH=$(echo "scale=6; ${MINT_ORDER_WEI[$i]} / 1000000000000000000" | bc)
        printf "  [%2d/%d] %s   bal %s   → mint %s ETH\n" \
            "$((i+1))" "$ACTIVE_COUNT" \
            "${MINT_ORDER_ADDR[$i]}" \
            "${MINT_ORDER_BAL_ETH[$i]}" \
            "$MINT_ETH"
    done
fi

echo ""
echo "To proceed, type exactly:  BOOTSTRAP"
echo "Anything else aborts."
read -r -p "> " CONFIRM
if [[ "$CONFIRM" != "BOOTSTRAP" ]]; then
    echo "Aborted." >&2
    exit 1
fi

# -------------------------------------------------------------------
# Mode A: fund wallets
# -------------------------------------------------------------------
if [[ "$MODE" == "A" ]]; then
    echo ""
    echo "Phase 1: funding $NUM_WALLETS wallets with $FUND_PER_WALLET ETH each..."
    FUND_WEI=$($CAST --to-wei "$FUND_PER_WALLET" ether)
    START_NONCE=$($CAST nonce "$DEPLOYER" --rpc-url "$RPC")
    for i in "${!ADDRS[@]}"; do
        NONCE=$((START_NONCE + i))
        ADDR="${ADDRS[$i]}"
        printf "  [%2d/%d] fund %s (nonce %d)\n" "$((i+1))" "$NUM_WALLETS" "$ADDR" "$NONCE"
        $CAST send "$ADDR" \
            --value "$FUND_WEI" \
            --private-key "$PRIVATE_KEY" \
            --rpc-url "$RPC" \
            --nonce "$NONCE" \
            --async > /dev/null 2>&1 &
        if [[ $((i % 5)) -eq 4 ]]; then
            wait
            sleep 1
        fi
    done
    wait

    EXPECTED_NONCE=$((START_NONCE + NUM_WALLETS))
    echo "  waiting for $NUM_WALLETS funding confirmations..."
    until [ "$($CAST nonce "$DEPLOYER" --rpc-url "$RPC")" -ge "$EXPECTED_NONCE" ]; do
        sleep 5
    done
    echo "  ✓ all funding confirmed"
fi

# -------------------------------------------------------------------
# Mint phase
# -------------------------------------------------------------------
echo ""

if [[ "$MODE" == "A" ]]; then
    echo "Phase 2: each wallet mints $MINT_PER_WALLET ETH via router.buy() (async)..."
    MINT_WEI=$($CAST --to-wei "$MINT_PER_WALLET" ether)
    for i in "${!ADDRS[@]}"; do
        ADDR="${ADDRS[$i]}"
        KEY="${KEYS[$i]}"
        printf "  [%2d/%d] mint from %s\n" "$((i+1))" "$NUM_WALLETS" "$ADDR"
        $CAST send "$ASCEND_ROUTER" 'buy(uint256,address)(uint256)' 0 "$ADDR" \
            --value "$MINT_WEI" \
            --private-key "$KEY" \
            --rpc-url "$RPC" \
            --async > /dev/null 2>&1 &
        if [[ $((i % 5)) -eq 4 ]]; then
            wait
            sleep 2
        fi
    done
    wait

    echo "  waiting for mints to confirm..."
    until [ "$($CAST nonce "${ADDRS[$((NUM_WALLETS - 1))]}" --rpc-url "$RPC")" -ge 1 ]; do
        sleep 5
    done
    echo "  ✓ at least the last wallet's mint confirmed"
else
    # Mode B: serial mint in sorted order. Each tx waits for confirmation
    # so the next mint sees the post-trade curve. This guarantees the
    # low → high curve ordering the user asked for.
    #
    # Sniper defence: each mint pays PRIORITY_TIP_GWEI as the EIP-1559
    # priority tip. Snipers chasing the same curve position would need
    # to outbid that tip; for a low-cap launch the gas cost vs. the
    # MAX_MINT_PER_TX-capped upside makes this uneconomic for them.
    PRIORITY_WEI=$(python3 -c "print(int($PRIORITY_TIP_GWEI * 1e9))")
    PRIORITY_ARGS=()
    if [[ "$PRIORITY_TIP_GWEI" != "0" ]]; then
        PRIORITY_ARGS=(--priority-gas-price "$PRIORITY_WEI")
    fi
    echo "Phase 2: minting in low → high order (serial, $ACTIVE_COUNT wallets, $PRIORITY_TIP_GWEI gwei tip)..."
    FAILED=0
    for i in "${!MINT_ORDER_ADDR[@]}"; do
        ADDR="${MINT_ORDER_ADDR[$i]}"
        KEY="${MINT_ORDER_KEY[$i]}"
        MINT_WEI="${MINT_ORDER_WEI[$i]}"
        MINT_ETH=$(echo "scale=6; $MINT_WEI / 1000000000000000000" | bc)
        printf "  [%2d/%d] %s → mint %s ETH ... " \
            "$((i+1))" "$ACTIVE_COUNT" "$ADDR" "$MINT_ETH"
        if $CAST send "$ASCEND_ROUTER" 'buy(uint256,address)(uint256)' 0 "$ADDR" \
            --value "$MINT_WEI" \
            --private-key "$KEY" \
            --rpc-url "$RPC" \
            ${PRIORITY_ARGS[@]+"${PRIORITY_ARGS[@]}"} \
            > /tmp/bs_mint_$$.log 2>&1; then
            echo "ok"
        else
            echo "FAIL"
            cat /tmp/bs_mint_$$.log
            FAILED=$((FAILED + 1))
        fi
    done
    rm -f /tmp/bs_mint_$$.log
    if [[ $FAILED -gt 0 ]]; then
        echo ""
        echo "⚠️  $FAILED mint(s) failed — see logs above"
    fi
fi

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "BOOTSTRAP COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo "  Mode used         : $MODE"
echo "  Wallets minted    : $ACTIVE_COUNT"
[[ "$MODE" == "B" ]] && echo "  Wallets skipped   : $SKIPPED_COUNT"
echo "  Total mint volume : $TOTAL_MINT_ETH ETH"
echo "  Keys file         : $WALLETS_FILE"
echo ""
echo "Each wallet now holds a fresh ascend balance proportional to its"
echo "position on the curve. Earliest wallets got the most tokens."
