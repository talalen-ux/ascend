#!/usr/bin/env bash
# scripts/launch.sh — one-shot launch sequence: deploy + auto-populate
# addresses + bootstrap. Collapses the human-in-the-loop env-var fill
# step that snipers can exploit.
#
# Sequence:
#   1. Run deploy-mainnet.sh (which does deploy + position-0 first mint
#      atomically via Flashbots Protect — see DeployV3.s.sol)
#   2. Parse contracts/broadcast/DeployV3.s.sol/1/run-latest.json to
#      extract AscendHookV3 + AscendRouterV3 addresses
#   3. Call hook.ascend() / hook.tileEngine() / hook.poolId() to
#      derive the rest of the address set
#   4. Write all 5 addresses into contracts/.env.mainnet (sed-replace
#      placeholder values; back up to .env.mainnet.bak)
#   5. Immediately invoke bootstrap-wallets.sh — the bootstrap wallets
#      fire serially via Flashbots Protect right after the deploy
#      confirms, shrinking the sniper window to ~1 block.
#
# This script still requires the user to type "DEPLOY MAINNET" and
# "BOOTSTRAP" — the two safety prompts inside the sub-scripts.
# --------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)"
ENV_FILE="$REPO_ROOT/contracts/.env.mainnet"
BROADCAST="$REPO_ROOT/contracts/broadcast/DeployV3.s.sol/1/run-latest.json"
CAST="$HOME/.foundry/bin/cast"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "missing $ENV_FILE" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MAINNET_RPC_URL:?MAINNET_RPC_URL required in $ENV_FILE}"

# -------------------------------------------------------------------
# Phase 1: deploy
# -------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  PHASE 1: DEPLOY"
echo "═══════════════════════════════════════════════════════════════"
"$REPO_ROOT/scripts/deploy-mainnet.sh"

# -------------------------------------------------------------------
# Phase 2: extract addresses from broadcast JSON
# -------------------------------------------------------------------
if [[ ! -f "$BROADCAST" ]]; then
    echo "missing $BROADCAST — deploy may have failed" >&2
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  PHASE 2: EXTRACT ADDRESSES"
echo "═══════════════════════════════════════════════════════════════"

HOOK=$(python3 -c "
import json
data = json.load(open('$BROADCAST'))
for tx in data['transactions']:
    if tx.get('contractName') == 'AscendHookV3':
        print(tx['contractAddress'])
        break
")
ROUTER=$(python3 -c "
import json
data = json.load(open('$BROADCAST'))
for tx in data['transactions']:
    if tx.get('contractName') == 'AscendRouterV3':
        print(tx['contractAddress'])
        break
")

if [[ -z "$HOOK" || -z "$ROUTER" ]]; then
    echo "could not extract hook/router addresses from $BROADCAST" >&2
    exit 1
fi

# Derive token + tile engine from the hook (deployed in its constructor,
# so not surfaced as top-level entries in the broadcast JSON).
TOKEN_RAW=$($CAST call "$HOOK" "ascend()(address)" --rpc-url "$MAINNET_RPC_URL")
TILE_RAW=$($CAST call "$HOOK" "tileEngine()(address)" --rpc-url "$MAINNET_RPC_URL")
POOL_ID_RAW=$($CAST call "$HOOK" "poolId()(bytes32)" --rpc-url "$MAINNET_RPC_URL")

# Strip any cast formatting (newlines, surrounding spaces)
TOKEN=$(echo "$TOKEN_RAW" | awk '{print $1}' | tr -d '\n ')
TILE=$(echo "$TILE_RAW" | awk '{print $1}' | tr -d '\n ')
POOL_ID=$(echo "$POOL_ID_RAW" | awk '{print $1}' | tr -d '\n ')

echo "  AscendHookV3   : $HOOK"
echo "  Ascend (ERC20) : $TOKEN"
echo "  TileEngine     : $TILE"
echo "  AscendRouterV3 : $ROUTER"
echo "  PoolId         : $POOL_ID"

# -------------------------------------------------------------------
# Phase 3: write addresses into .env.mainnet
# -------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  PHASE 3: UPDATE ENV"
echo "═══════════════════════════════════════════════════════════════"

cp "$ENV_FILE" "$ENV_FILE.bak"

# In-place replace of placeholder lines. macOS sed quirk: -i requires
# an extension arg (already paired above via .bak).
update_env_var() {
    local key=$1
    local val=$2
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i.tmp "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
        rm -f "$ENV_FILE.tmp"
    else
        echo "${key}=${val}" >> "$ENV_FILE"
    fi
}

update_env_var "ASCEND_HOOK" "$HOOK"
update_env_var "ASCEND_TOKEN" "$TOKEN"
update_env_var "TILE_ENGINE" "$TILE"
update_env_var "ASCEND_ROUTER" "$ROUTER"
update_env_var "POOL_ID" "$POOL_ID"

echo "  → addresses written to $ENV_FILE (backup at $ENV_FILE.bak)"

# -------------------------------------------------------------------
# Phase 4: bootstrap immediately
# -------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  PHASE 4: BOOTSTRAP"
echo "═══════════════════════════════════════════════════════════════"
"$REPO_ROOT/scripts/bootstrap-wallets.sh"

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  LAUNCH COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo "  AscendHookV3   : $HOOK"
echo "  Ascend (ERC20) : $TOKEN"
echo "  TileEngine     : $TILE"
echo "  AscendRouterV3 : $ROUTER"
echo "  PoolId         : $POOL_ID"
echo ""
echo "  Next: update .env.local for the dapp (chain id 1 + above addresses)"
