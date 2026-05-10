#!/usr/bin/env bash
# --------------------------------------------------------------------
# scripts/deploy-sepolia.sh — wrap forge script for Sepolia deploys.
#
# 1. cp contracts/.env.sepolia.example contracts/.env.sepolia
# 2. fill in PRIVATE_KEY + SEPOLIA_RPC_URL (and optionally ETHERSCAN_API_KEY)
# 3. ./scripts/deploy-sepolia.sh
#
# The deploy is one tx (Genesis constructor + LP seed + AscendRouter)
# requiring exactly 1 ETH bootstrap on the deployer.
# --------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)"
ENV_FILE="$REPO_ROOT/contracts/.env.sepolia"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "missing $ENV_FILE — copy contracts/.env.sepolia.example and fill in" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PRIVATE_KEY:?PRIVATE_KEY required in $ENV_FILE}"
: "${POOL_MANAGER:?POOL_MANAGER required in $ENV_FILE}"
: "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL required in $ENV_FILE}"

VERIFY_ARGS=()
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
    VERIFY_ARGS=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
fi

cd "$REPO_ROOT/contracts"
SCRIPT="${DEPLOY_SCRIPT:-script/DeployV3.s.sol:DeployV3}"
forge script "$SCRIPT" \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    "${VERIFY_ARGS[@]}"
