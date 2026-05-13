#!/usr/bin/env bash
# scripts/deploy-mainnet.sh — production mainnet deployment.
#
# 1. cp contracts/.env.mainnet.example contracts/.env.mainnet (already done)
# 2. fill in PRIVATE_KEY, MAINNET_RPC_URL, POOL_MANAGER, ETHERSCAN_API_KEY
# 3. fund the deployer wallet with enough ETH for the broadcast
# 4. ./scripts/deploy-mainnet.sh
#
# This script will:
#   - Pre-flight: show deployer balance, gas price, addresses to be deployed
#   - Require manual "DEPLOY MAINNET" confirmation before broadcasting
#   - Broadcast the deploy script
#   - Print the deployed addresses
#   - Optionally verify on Etherscan
# --------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)"
ENV_FILE="$REPO_ROOT/contracts/.env.mainnet"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "missing $ENV_FILE — fill in mainnet env vars first" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PRIVATE_KEY:?PRIVATE_KEY required in $ENV_FILE}"
: "${POOL_MANAGER:?POOL_MANAGER required in $ENV_FILE}"
: "${MAINNET_RPC_URL:?MAINNET_RPC_URL required in $ENV_FILE}"

CAST="$HOME/.foundry/bin/cast"
FORGE="$HOME/.foundry/bin/forge"

# Pre-flight info
DEPLOYER=$($CAST wallet address --private-key "$PRIVATE_KEY")
BAL_WEI=$($CAST balance "$DEPLOYER" --rpc-url "$MAINNET_RPC_URL")
BAL_ETH=$($CAST balance "$DEPLOYER" --rpc-url "$MAINNET_RPC_URL" --ether)
GAS_WEI=$($CAST gas-price --rpc-url "$MAINNET_RPC_URL")
GAS_GWEI=$(echo "scale=4; $GAS_WEI / 1000000000" | bc)
BLOCK=$($CAST block-number --rpc-url "$MAINNET_RPC_URL")

# Estimate cost (~7.85M gas based on dry-run)
EST_GAS=7850000
EST_COST_WEI=$((EST_GAS * GAS_WEI))
EST_COST_ETH=$(echo "scale=6; $EST_COST_WEI / 1000000000000000000" | bc)

VERIFY_NOTE="no"
VERIFY_ARGS=()
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
    VERIFY_ARGS=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
    VERIFY_NOTE="yes (Etherscan)"
fi

cat <<EOF
═══════════════════════════════════════════════════════════════
                MAINNET DEPLOYMENT — PRE-FLIGHT
═══════════════════════════════════════════════════════════════
  Chain         : Ethereum mainnet (chain id 1)
  Block         : $BLOCK
  Deployer      : $DEPLOYER
  Balance       : $BAL_ETH ETH
  Gas price now : $GAS_GWEI gwei
  PoolManager   : $POOL_MANAGER
  Estimate (gas): ~$EST_GAS
  Estimate (cost): ~$EST_COST_ETH ETH (at current gas)
  Verify        : $VERIFY_NOTE
═══════════════════════════════════════════════════════════════

THIS IS A PRODUCTION MAINNET DEPLOYMENT. The contracts will be
immutable on Ethereum forever. Triple-check:

  - Is the audit complete?
  - Are the constants (K, S, fees, penalty curve) correct?
  - Is the deployer balance enough (~10x the cost estimate)?
  - Is this a calm gas window?

To proceed, type exactly:  DEPLOY MAINNET
Anything else aborts.

EOF

read -r -p "> " CONFIRM
if [[ "$CONFIRM" != "DEPLOY MAINNET" ]]; then
    echo "Aborted. Nothing broadcast." >&2
    exit 1
fi

echo ""
echo "Broadcasting to mainnet..."
echo ""

cd "$REPO_ROOT/contracts"
SCRIPT="${DEPLOY_SCRIPT:-script/DeployV3.s.sol:DeployV3}"
$FORGE script "$SCRIPT" \
    --rpc-url "$MAINNET_RPC_URL" \
    --broadcast \
    --chain-id 1 \
    ${VERIFY_ARGS[@]+"${VERIFY_ARGS[@]}"}

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Read the addresses from the script log above and update:"
echo "  contracts/.env.mainnet → add ASCEND_HOOK, ASCEND_TOKEN, etc."
echo "  .env.local             → repoint dapp to mainnet"
echo ""
echo "Next step: run ./scripts/bootstrap-wallets.sh to seed initial supply"
echo "via 20 wallets × 0.1 ETH each."
