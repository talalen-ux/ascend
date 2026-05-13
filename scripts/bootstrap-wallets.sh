#!/usr/bin/env bash
# scripts/bootstrap-wallets.sh — distribute initial supply across N wallets.
#
# Auto-detects two modes based on contracts/.bootstrap-wallets.json:
#
#   MODE A: file doesn't exist
#     → Generate N fresh wallets
#     → Save keys to .bootstrap-wallets.json (chmod 600)
#     → Deployer funds each with MINT_PER_WALLET+gas (default 0.105 ETH)
#     → Each wallet mints with MINT_PER_WALLET ETH
#
#   MODE B: file exists (wallets already generated, you'll fund manually)
#     → Load keys from .bootstrap-wallets.json
#     → SKIP funding phase
#     → Check each wallet has enough balance to mint
#     → Each wallet mints with MINT_PER_WALLET ETH
#
# Configurable via env:
#   NUM_WALLETS=20   (mode A only — mode B uses file length)
#   MINT_PER_WALLET=0.1
#   GAS_BUFFER=0.005 (mode A only — extra ETH for mint gas)
#   FORCE_FUND=1     (force mode A even if file exists)
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
FUND_PER_WALLET=$(echo "scale=6; $MINT_PER_WALLET + $GAS_BUFFER" | bc)
TOTAL_FUND=$(echo "scale=6; $FUND_PER_WALLET * $NUM_WALLETS" | bc)
TOTAL_MINT=$(echo "scale=6; $MINT_PER_WALLET * $NUM_WALLETS" | bc)

echo ""
cat <<EOF
═══════════════════════════════════════════════════════════════
              BOOTSTRAP WALLETS — PRE-FLIGHT
═══════════════════════════════════════════════════════════════
  Mode            : $MODE $([ "$MODE" == "B" ] && echo "(wallets pre-funded by you)" || echo "(deployer funds wallets)")
  Wallets         : $NUM_WALLETS
  Mint/wallet     : $MINT_PER_WALLET ETH
EOF

if [[ "$MODE" == "A" ]]; then
cat <<EOF
  Fund/wallet     : $FUND_PER_WALLET ETH (mint + $GAS_BUFFER gas buffer)
  Total fund     : $TOTAL_FUND ETH (from deployer)
  Deployer bal    : $BAL_DEPLOYER ETH
EOF
fi

cat <<EOF
  Total mint vol  : $TOTAL_MINT ETH (curve advance)
  Router          : $ASCEND_ROUTER
  Gas price       : $GAS_GWEI gwei
═══════════════════════════════════════════════════════════════
EOF

# -------------------------------------------------------------------
# Mode B: check wallet balances
# -------------------------------------------------------------------
if [[ "$MODE" == "B" ]]; then
    echo ""
    echo "Checking wallet balances..."
    MINT_WEI_FLOAT=$(echo "scale=6; $MINT_PER_WALLET + 0.001" | bc)
    MINT_WEI_REQUIRED=$($CAST --to-wei "$MINT_WEI_FLOAT" ether)
    SHORT_COUNT=0
    for i in "${!ADDRS[@]}"; do
        ADDR="${ADDRS[$i]}"
        BAL_WEI=$($CAST balance "$ADDR" --rpc-url "$RPC")
        BAL_ETH=$(echo "scale=6; $BAL_WEI / 1000000000000000000" | bc)
        if [[ $(echo "$BAL_WEI < $MINT_WEI_REQUIRED" | bc) == "1" ]]; then
            STATUS="✗ NEED ≥ $MINT_WEI_FLOAT ETH"
            SHORT_COUNT=$((SHORT_COUNT + 1))
        else
            STATUS="✓"
        fi
        printf "  [%2d/%d] %s : %s ETH %s\n" "$((i+1))" "$NUM_WALLETS" "$ADDR" "$BAL_ETH" "$STATUS"
    done
    if [[ $SHORT_COUNT -gt 0 ]]; then
        echo ""
        echo "⚠️  $SHORT_COUNT wallet(s) underfunded. Send at least $MINT_WEI_FLOAT ETH"
        echo "    to each before running this script."
        exit 1
    fi
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
# Mint phase (both modes)
# -------------------------------------------------------------------
echo ""
echo "Phase 2: each wallet mints $MINT_PER_WALLET ETH via router.buy()..."
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

# Wait for mints to confirm by polling the last wallet's nonce
echo "  waiting for mints to confirm..."
until [ "$($CAST nonce "${ADDRS[$((NUM_WALLETS - 1))]}" --rpc-url "$RPC")" -ge 1 ]; do
    sleep 5
done
echo "  ✓ at least the last wallet's mint confirmed"

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "BOOTSTRAP COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo "  Mode used              : $MODE"
echo "  Wallets                : $NUM_WALLETS"
echo "  Total mint volume      : $TOTAL_MINT ETH"
echo "  Keys file              : $WALLETS_FILE"
echo ""
echo "Each wallet now holds a fresh ascend balance proportional to its"
echo "position on the curve. Earliest wallets got the most tokens."
