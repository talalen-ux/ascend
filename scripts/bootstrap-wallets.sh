#!/usr/bin/env bash
# scripts/bootstrap-wallets.sh — generate N wallets, fund each with X ETH,
# have each mint via the deployed router. Run AFTER deploy-mainnet.sh.
#
# Defaults: 20 wallets × 0.1 ETH each = 2 ETH total mint volume.
# Override via env: NUM_WALLETS=10 MINT_PER_WALLET=0.05 ./scripts/bootstrap-wallets.sh
#
# Outputs:
#   contracts/.bootstrap-wallets.json (gitignored)
#     → JSON array of {address, privateKey} for the 20 wallets.
#       Keep this file safe — anyone with it controls those wallets.
#
# Phases:
#   1. Generate N fresh wallets via `cast wallet new`
#   2. Save keys to .bootstrap-wallets.json (chmod 600)
#   3. Deployer sends (MINT_PER_WALLET + buffer) ETH to each wallet
#   4. Each wallet calls router.buy() to mint with MINT_PER_WALLET ETH
#   5. Print summary
#
# Safety: requires manual "BOOTSTRAP" confirmation before broadcasting.
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

NUM_WALLETS=${NUM_WALLETS:-20}
MINT_PER_WALLET=${MINT_PER_WALLET:-0.1}
# Add a small buffer for gas — each wallet needs to pay for its own mint tx.
# At 1 gwei × ~250k gas = ~0.00025 ETH per mint, 0.005 is generous.
GAS_BUFFER=${GAS_BUFFER:-0.005}
FUND_PER_WALLET=$(echo "scale=6; $MINT_PER_WALLET + $GAS_BUFFER" | bc)
TOTAL_FUND=$(echo "scale=6; $FUND_PER_WALLET * $NUM_WALLETS" | bc)
TOTAL_MINT=$(echo "scale=6; $MINT_PER_WALLET * $NUM_WALLETS" | bc)

DEPLOYER=$($CAST wallet address --private-key "$PRIVATE_KEY")
BAL_ETH=$($CAST balance "$DEPLOYER" --rpc-url "$RPC" --ether)

# Sanity: ensure deployer has enough
BAL_FLOAT=$(echo "$BAL_ETH" | awk '{print $1}')
NEED=$(echo "scale=6; $TOTAL_FUND + 0.01" | bc) # 0.01 for funding tx gas
SUFFICIENT="yes"
if (( $(echo "$BAL_FLOAT < $NEED" | bc -l) )); then
    SUFFICIENT="NO — needs ~$NEED ETH, has $BAL_ETH"
fi

cat <<EOF
═══════════════════════════════════════════════════════════════
              BOOTSTRAP WALLETS — PRE-FLIGHT
═══════════════════════════════════════════════════════════════
  Deployer        : $DEPLOYER
  Deployer bal    : $BAL_ETH ETH
  Router          : $ASCEND_ROUTER
  Wallets         : $NUM_WALLETS
  Mint/wallet     : $MINT_PER_WALLET ETH
  Fund/wallet     : $FUND_PER_WALLET ETH (mint + $GAS_BUFFER gas buffer)
  Total fund      : $TOTAL_FUND ETH
  Total mint vol  : $TOTAL_MINT ETH
  Sufficient?     : $SUFFICIENT

  Output keys → $WALLETS_FILE (gitignored, chmod 600)

⚠️  Notes:
  • The 20 wallets' private keys will be written to disk. Whoever
    has access to that file controls those wallets. Back them up
    securely or delete after use.
  • This advances the bonding curve by ~$TOTAL_MINT ETH, distributing
    that share of supply across $NUM_WALLETS distinct addresses.
  • All wallets are derived from \`cast wallet new\` (fresh, random).

To proceed, type exactly:  BOOTSTRAP
Anything else aborts.

EOF

if [[ "$SUFFICIENT" != "yes" ]]; then
    echo "Insufficient balance. Fund the deployer first and re-run." >&2
    exit 1
fi

read -r -p "> " CONFIRM
if [[ "$CONFIRM" != "BOOTSTRAP" ]]; then
    echo "Aborted." >&2
    exit 1
fi

# -------------------------------------------------------------------
# Phase 1: generate wallets
# -------------------------------------------------------------------
echo ""
echo "Phase 1: generating $NUM_WALLETS wallets..."
declare -a ADDRS=()
declare -a KEYS=()
for i in $(seq 1 "$NUM_WALLETS"); do
    OUT=$($CAST wallet new)
    ADDR=$(echo "$OUT" | grep -E "^Address:" | awk '{print $2}')
    KEY=$(echo "$OUT" | grep -E "^Private key:" | awk '{print $3}')
    ADDRS+=("$ADDR")
    KEYS+=("$KEY")
    printf "  [%2d/%d] %s\n" "$i" "$NUM_WALLETS" "$ADDR"
done

# Save as JSON
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

# -------------------------------------------------------------------
# Phase 2: fund wallets
# -------------------------------------------------------------------
echo ""
echo "Phase 2: funding $NUM_WALLETS wallets with $FUND_PER_WALLET ETH each..."
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
    # Throttle: batch of 5, then sync
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

# -------------------------------------------------------------------
# Phase 3: each wallet mints
# -------------------------------------------------------------------
echo ""
echo "Phase 3: each wallet mints $MINT_PER_WALLET ETH via router.buy()..."
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

# Give the mints a moment to confirm. Each is independent so we just
# poll a sample wallet's nonce to know we're done.
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
DEPLOYER_END=$($CAST balance "$DEPLOYER" --rpc-url "$RPC" --ether)
echo "  Deployer final balance : $DEPLOYER_END ETH"
echo "  Wallets generated      : $NUM_WALLETS"
echo "  Total mint volume      : $TOTAL_MINT ETH"
echo "  Keys file              : $WALLETS_FILE"
echo ""
echo "Verify in the dapp: each wallet should now hold a fresh ascend balance."
