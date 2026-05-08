# Foundry deploy guide — first-time walkthrough

A step-by-step guide for someone who's never used Foundry. Reads
top-to-bottom; every command is copy-paste ready. Treats safety
seriously — there are checkpoints between phases that you should not
skip.

**Estimated total time:** ~3 hours of active work spread across 1–2
weeks (most of the calendar time is testnet rehearsal + waiting for
gas markets to be calm).

**Estimated mainnet cost:** ~$200–$500 of gas at typical mainnet
prices. The 1 ETH bootstrap is locked in the hook permanently; budget
for that as protocol seed, not as gas.

---

## Phase 0 — Prerequisites you need before you start

You need each of these. If any are missing, stop and get them first.

| thing | why | how to get |
|---|---|---|
| **A computer** with a Unix-like shell | foundry is a CLI | macOS, Linux, or Windows + WSL2 |
| **An EOA wallet** (the "deployer") | signs the deploy tx | MetaMask is fine for sepolia; **use a hardware wallet (Ledger / Trezor) for mainnet** |
| **~1.05 ETH on mainnet** in the deployer | 1 ETH bootstrap + gas | buy on a CEX, withdraw to deployer address |
| **An RPC URL** | foundry talks to Ethereum through this | Alchemy free tier works, also Infura, dRPC, your own node |
| **An Etherscan API key** | verifies the source code on Etherscan | https://etherscan.io/apis (free, takes 2 minutes) |
| **The mainnet V4 PoolManager address** | deploy script needs it | `https://docs.uniswap.org/contracts/v4/deployments` |
| **Sepolia testnet ETH** | for rehearsal deploys | https://www.alchemy.com/faucets/ethereum-sepolia |

**Critical:** do NOT proceed to mainnet without rehearsing on sepolia
first. The whole sequence below should be done end-to-end on sepolia
once before mainnet.

---

## Phase 1 — Install Foundry

Foundry is a Rust-based toolchain. Three binaries you'll use:
- `forge` — compiler, test runner, deploy script runner
- `cast` — direct RPC calls (read state, send txs)
- `anvil` — local mainnet fork (for local testing)

### Install

```bash
curl -L https://foundry.paradigm.xyz | bash
# this adds foundryup to your shell. close+reopen the terminal, then:
foundryup
```

`foundryup` installs the latest stable. Run `forge --version` to
verify. You should see something like `forge 0.2.0 (...)`.

### Configure

In your home directory, create or edit `~/.foundry/foundry.toml` if
needed, but the project's own `contracts/foundry.toml` already has
everything required.

---

## Phase 2 — Install dependencies and build

The repo declares its remappings in `contracts/foundry.toml`. We need
to install the actual library sources.

```bash
cd contracts                # all forge commands run from here
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install Uniswap/v4-core --no-commit
forge install Uniswap/v4-periphery --no-commit
```

`--no-commit` keeps git clean (the libraries land in `contracts/lib/`
which is already in `.gitignore`).

### Pin versions for reproducibility

After install, lock the commit hashes you got. They're in
`.gitmodules`. The exact versions matter for V4 — sign conventions
have shifted between RCs.

### Build

```bash
forge build
```

**This is the first moment of truth.** If the contracts compile
clean, you're past the syntax+import gate.

If you see errors:
- **"file not found"** — a remapping didn't resolve. Check that the
  library is in `contracts/lib/` and `foundry.toml`'s `remappings`
  match the import paths.
- **"function not declared"** — V4 may have renamed something between
  versions. Search v4-core's CHANGELOG and adjust the import or call
  site.
- **stack-too-deep** — `via_ir = true` is already set in
  `foundry.toml`, which fixes most of these.

### Build output

```bash
ls out/AscendHookV2.sol/
ls out/Genesis.sol/
ls out/TileEngine.sol/
```

You should see `.json` artifacts containing ABI and bytecode for each.

---

## Phase 3 — Run the test suite (THE H-2 GATE)

This is the most important step before any deploy. The audit lists H-2
(unverified V4 sign convention) as the only remaining HIGH-severity
finding. Tests resolve it by running our contracts against a real
PoolManager build.

### Run all tests

```bash
forge test -vv
```

`-vv` prints test names + revert reasons. Use `-vvv` for stack traces
on failures, `-vvvv` for full call traces.

### What you want to see

Every test in `test/AscendHookV2.t.sol` should pass:

```
Running 14 tests for test/AscendHookV2.t.sol:AscendHookV2Test
[PASS] test_initialState() (gas: ~1M)
[PASS] test_constructorRequiresExactBootstrap() (gas: ~50k)
[PASS] test_addLiquidityIsRejectedFromExternal() (gas: ~100k)
[PASS] test_buyMovesPriceUp() (gas: ~300k)
[PASS] test_sellMovesPriceDown() (gas: ~400k)
[PASS] test_dynamicFeeIsFivePercent() (...)         ← rename to test_dynamicFeeIsOnePercent in test
[PASS] test_rebalanceLiftsFloor() (...)
[PASS] test_floorNeverDecreasesUnderRandomSequence() (...)
[PASS] test_tileDepositRequiresHookCaller() (...)
[PASS] test_tileClaimRequiresHolding() (...)
[PASS] test_tileOneClaimPerEpoch() (...)
[PASS] test_tileSecondAddressFailsOnSameTile() (...)
[PASS] test_tileMultiplierIsBounded() (...)
[PASS] test_tilePoolSolvent() (...)
[PASS] test_tileEpochAdvances() (...)
[PASS] test_tileDonationsRejected() (...)
Test result: ok. 14 passed; 0 failed
```

### What to do if tests fail

**Don't deploy.** Fix the test or the contract first. Common
failures:

| symptom | likely cause | fix |
|---|---|---|
| `BeforeSwapDelta` arithmetic in v1-style tests | sign convention drift | invert the sign in `_executeBuy/_executeSell` (v1) or in our case the `BeforeSwapDelta` returns; rerun |
| modifyLiquidity reverts during seed | sender check in `_beforeAddLiquidity` | log who's calling; the V4 version may pass a different sender |
| dynamic-fee tests show 0% fee | the `OVERRIDE_FEE_FLAG` constant moved | grep v4-core for the current name |
| StateLibrary call fails | function signature changed | update the call site |

The audit doc has each gate noted. Fix one test at a time. Re-run
after each fix.

### Gas profile

```bash
forge snapshot
```

Generates `.gas-snapshot`. Sanity-check: a buy should be ~150k gas, a
rebalance ~200k. If a function is wildly expensive, audit it before
mainnet.

---

## Phase 4 — Local mainnet fork rehearsal

Before sepolia, do one local rehearsal. anvil forks mainnet so the
deploy uses real V4 PoolManager.

### Start anvil with mainnet fork

```bash
# in a separate terminal
anvil --fork-url https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

Leaves anvil running on `http://127.0.0.1:8545`.

### Run the deploy script against it

In your main terminal:

```bash
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil's default test key #0; HAS NO REAL VALUE
export POOL_MANAGER=0x000000000004444c5dC75cB358380D2e3dE08A90  # mainnet V4 PoolManager — verify on uniswap docs

forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

What you want to see:
```
predicted hook: 0x...
sqrtPriceX96  : ...
AscendHookV2  : 0x...
ascend        : 0x...
TileEngine    : 0x...
liquidityHeld : ...
floor()       : ...
```

If this works on the fork, your script is correct. The fork uses real
V4, so this resolves H-2 in addition to the test suite.

If it fails:
- `error: failed to mine salt` → HookMiner needs more time; let it
  run. On a slow laptop, salt mining for 4 flags takes 10–60 seconds.
- `error: address mismatch` → the predicted address didn't match
  what CREATE2 produced. This means the bytecode changed between
  predict and deploy; rebuild and retry.
- `revert: WrongCurrencyZero` etc. → pool key didn't validate. Check
  the script's `PoolKey` matches what `_afterInitialize` expects.

---

## Phase 5 — Sepolia rehearsal

Now the same flow, but on a public testnet. This catches issues with
RPCs, gas estimation, etc.

### Get sepolia ETH

Faucet sites give free testnet ETH. You need ~1.05 sepolia-ETH:
- 1 ETH for the bootstrap
- 0.05 ETH for gas

Visit:
- https://www.alchemy.com/faucets/ethereum-sepolia
- https://sepoliafaucet.com/
- https://faucets.chain.link/sepolia

### Find sepolia V4 PoolManager

The Uniswap V4 deployments page lists addresses per chain. As of
early 2025, sepolia V4 was at `0x...` — check the docs for the
current address.

### Deploy

```bash
export PRIVATE_KEY=0x...                                                    # the deployer wallet's private key
export POOL_MANAGER=0x...                                                   # sepolia V4 PoolManager
export SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
export ETHERSCAN_API_KEY=YOUR_KEY

forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url $SEPOLIA_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

The `--verify` flag publishes source code to sepolia.etherscan.io
automatically. Without this, your contract is a "black box" on the
explorer.

### Verify on the explorer

After the script finishes, check:

1. **AscendHookV2** is verified at the address it printed
2. **Ascend** ERC-20 is verified
3. **TileEngine** is verified
4. **Genesis** contract was deployed and self-destructed (or just
   sits there with no further calls)
5. The pool's slot0 is set; `liquidityHeld` on the hook is non-zero

### Test on sepolia

Use Uniswap's V4 sepolia interface (or a v4 testnet aggregator) to:
- Buy ascend with sepolia ETH
- Hold a moment, then sell some
- Verify the same-block-burn revert: try buying then selling in the
  same tx (should revert)
- Wait for the LP to accumulate fees, then call `rebalance()`
- Try claiming a tile from the TileEngine

If anything misbehaves, fix it and redeploy. Sepolia ETH is free; use
it.

---

## Phase 6 — The mainnet deploy

**Do not skip phase 5.** Multiple successful sepolia deployments + UI
testing must happen before this phase.

### The day before

- Pick a low-gas time (Sunday morning UTC tends to be cheap)
- Have your hardware wallet ready
- Confirm the mainnet V4 PoolManager address is current
- Confirm the deployer address has 1.05+ ETH on mainnet
- Have the sepolia output saved as a "what success looks like"
  reference

### Use a hardware wallet

For mainnet, do NOT put your private key in `$PRIVATE_KEY`. Instead:

```bash
# Option 1: cast wallet
cast wallet import deployer --interactive
# you'll be prompted for the private key once; it's stored encrypted
# in ~/.foundry/keystores/deployer with a password

# Then:
forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url $MAINNET_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --account deployer \
  --sender 0xYourAddress
```

This prompts for the keystore password each time, never exposing the
key in environment variables or shell history.

```bash
# Option 2: hardware wallet via cast/forge
forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url $MAINNET_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --ledger \
  --hd-paths "m/44'/60'/0'/0/0" \
  --sender 0xYourAddress
```

You'll need to confirm transactions on the device.

### Run

```bash
export POOL_MANAGER=0x000000000004444c5dC75cB358380D2e3dE08A90  # mainnet V4 PoolManager
export MAINNET_RPC=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
export ETHERSCAN_API_KEY=YOUR_KEY

# pick whichever wallet flag from above

# Optional: do a dry-run first (no --broadcast) to see what would happen
forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url $MAINNET_RPC \
  --account deployer \
  --sender 0xYourAddress

# then for real
forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url $MAINNET_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --account deployer \
  --sender 0xYourAddress
```

The script prints:
```
predicted hook: 0x...
AscendHookV2  : 0x...   (matches predicted)
ascend        : 0x...
TileEngine    : 0x...
liquidityHeld : ...     (non-zero — LP seeded)
floor()       : ...     (non-zero — protocol live)
```

**Save these addresses.** They will be embedded in the dapp config,
shared with DexScreener / aggregators, and never change.

---

## Phase 7 — Post-deploy

### Configure the dapp

Edit `.env.local` in the dapp root:

```
NEXT_PUBLIC_CHAIN_ID=1
NEXT_PUBLIC_POOL_MANAGER=0x000000000004444c5dC75cB358380D2e3dE08A90
NEXT_PUBLIC_ASCEND_HOOK=0x...           # from script output
NEXT_PUBLIC_ASCEND_TOKEN=0x...          # from script output
NEXT_PUBLIC_TILE_ENGINE=0x...           # from script output
NEXT_PUBLIC_POOL_ID=0x...               # the pool key id; computable from the printed addresses
```

Restart the dapp; it should now read live state from mainnet.

### Submit to listing services

DexScreener, GeckoTerminal, and Uniswap's own indexer pick up V4
pools automatically. Optionally:

- **DexScreener "Update token info"** — write project description,
  add socials. Costs ~0.05 ETH for the official tier.
- **CoinGecko / CMC submission** — manual forms, takes weeks.

### Monitor

For the first 100 blocks (~20 minutes), the anti-bot fee multiplier
is active. After that, the contract is in steady state.

Watch:
- The hook's ETH balance via Etherscan (should equal `liquidityHeld`
  worth of ETH at the genesis price, plus any retained fees)
- The TileEngine's ETH balance (grows with volume; first epoch's
  pool drains as holders claim)
- The first few `Buy`, `Sell`, `Rebalanced`, `TileClaimed` events

If anything looks wrong, **the contract is immutable**. There is no
pause, no upgrade, no withdraw. The only recovery is a fresh deploy
with fixed code.

---

## Common pitfalls

### Salt mining timeout

`HookMiner.find` can take 10–60s for 4 flags. If your shell aborts
before it finishes, increase the timeout or run on a faster machine.

### Wrong V4 PoolManager address

Each chain has a different PoolManager. Mainnet, sepolia, base,
arbitrum, optimism all differ. Verify against
https://docs.uniswap.org/contracts/v4/deployments before every
deploy.

### Etherscan verification failure

If `--verify` fails (rate limit, API issue), you can verify after the
fact:

```bash
forge verify-contract \
  --watch \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" $POOL_MANAGER) \
  0xYourHookAddress \
  src/AscendHookV2.sol:AscendHookV2
```

### Anti-bot window timing

If you deploy and immediately announce, bots will pile in during the
first 100 blocks and pay the random extra fee. That's the design.
But don't be surprised if the first hour's stats look noisy.

### Out-of-gas during deploy

The constructor is heavy (deploys 3 contracts inside it). If gas
estimation gets it wrong, manually set `--gas-limit 10000000` and
`--gas-price <wei>` in the forge script invocation.

---

## Reference: minimal command cheatsheet

```bash
# install
curl -L https://foundry.paradigm.xyz | bash && foundryup

# project setup
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts \
  Uniswap/v4-core Uniswap/v4-periphery --no-commit
forge build
forge test -vv

# import deployer key once
cast wallet import deployer --interactive

# deploy (sepolia rehearsal)
forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url $SEPOLIA_RPC \
  --broadcast --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --account deployer --sender 0xYourAddress

# deploy (mainnet, hardware wallet)
forge script script/DeployV2.s.sol:DeployV2 \
  --rpc-url $MAINNET_RPC \
  --broadcast --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --ledger --hd-paths "m/44'/60'/0'/0/0" \
  --sender 0xYourAddress

# read post-deploy state
cast call $HOOK_ADDR "floor()(uint256)" --rpc-url $MAINNET_RPC
cast call $HOOK_ADDR "liquidityHeld()(uint128)" --rpc-url $MAINNET_RPC
cast balance $TILE_ENGINE_ADDR --rpc-url $MAINNET_RPC
```

---

## Help if you get stuck

- **Foundry book** (excellent reference): https://book.getfoundry.sh/
- **Uniswap V4 docs**: https://docs.uniswap.org/contracts/v4/
- **V4 hook examples**: https://github.com/Uniswap/v4-periphery/tree/main/src/hooks
- **forge command help**: `forge help <command>` (e.g. `forge help script`)
- **The audit doc** in this repo flags every assumption that might
  break a deploy

When something fails, copy the error and search the foundry book +
the v4-core repo's CHANGELOG. Most issues are version drift between
v4 RC versions. Keep your `lib/` deps locked once you have a passing
test suite.

Don't deploy at 3am, don't deploy when you're tired, don't deploy
without sleeping on it. The contract is permanent.
