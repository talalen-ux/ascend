/**
 * Post-deploy: seed a tiny Uniswap V2 rise/WETH pool and lock the LP.
 *
 * Why: trackers like Dexscreener and GeckoTerminal index Uniswap pools.
 * Without one, rise has no public price feed even though the engine is
 * the real liquidity venue. A small locked-LP pool gives those trackers
 * something to index. Arbitrageurs keep its mid-price aligned with the
 * engine floor (within the 1% / 3% round-trip band).
 *
 * What this does (in order):
 *   1. quotes & buys SEED_ETH worth of rise from the engine
 *   2. approves the Uniswap V2 router for the resulting rise
 *   3. calls addLiquidityETH with deadline = now + 600s
 *   4. transfers the resulting LP tokens to BURN_ADDRESS (locked forever)
 *
 * Inputs (env):
 *   PRIVATE_KEY      hex private key of the deployer
 *   RPC_URL          ethereum RPC
 *   RISE_ENGINE      0x... engine address (from deploy output)
 *   UNI_V2_ROUTER    0x... uniswap v2 router (mainnet: 0x7a25...488D)
 *   SEED_ETH         decimal ETH amount for the seed (default: 0.1)
 *
 * Run:
 *   PRIVATE_KEY=0x... RPC_URL=... RISE_ENGINE=0x... UNI_V2_ROUTER=0x... \
 *     npx tsx scripts/seedUniswap.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

const ENGINE_ABI = [
  { type: "function", name: "rise", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
] as const;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const UNI_V2_ROUTER_ABI = [
  {
    type: "function",
    name: "addLiquidityETH",
    stateMutability: "payable",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint256" },
    ],
    outputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
  },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "WETH", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;

async function main() {
  const pk = required("PRIVATE_KEY") as `0x${string}`;
  const rpcUrl = required("RPC_URL");
  const engineAddr = required("RISE_ENGINE") as `0x${string}`;
  const routerAddr = required("UNI_V2_ROUTER") as `0x${string}`;
  const seedEth = process.env.SEED_ETH ?? "0.1";

  const account = privateKeyToAccount(pk);
  const transport = http(rpcUrl);
  const pub = createPublicClient({ chain: mainnet, transport });
  const wallet = createWalletClient({ account, chain: mainnet, transport });

  console.log(`deployer:     ${account.address}`);
  console.log(`engine:       ${engineAddr}`);
  console.log(`v2 router:    ${routerAddr}`);
  console.log(`seed amount:  ${seedEth} ETH (× 2 — half buys rise, half pairs as ETH)\n`);

  // ----------------------------------------------------------------- 1. buy rise from engine
  const seedWei = parseEther(seedEth);
  const [quotedRise] = await pub.readContract({
    address: engineAddr,
    abi: ENGINE_ABI,
    functionName: "quoteBuy",
    args: [seedWei],
  });
  console.log(`quoting:  ${seedEth} ETH → ${formatEther(quotedRise)} rise`);

  const buyHash = await wallet.writeContract({
    address: engineAddr,
    abi: ENGINE_ABI,
    functionName: "buy",
    value: seedWei,
  });
  console.log(`buy tx:   ${buyHash}`);
  await pub.waitForTransactionReceipt({ hash: buyHash });

  const riseAddr = await pub.readContract({
    address: engineAddr,
    abi: ENGINE_ABI,
    functionName: "rise",
  });

  const balance = await pub.readContract({
    address: riseAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`got:      ${formatEther(balance)} rise\n`);

  // ----------------------------------------------------------------- 2. approve router
  console.log(`approving router for rise…`);
  const approveHash = await wallet.writeContract({
    address: riseAddr,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [routerAddr, balance],
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });

  // ----------------------------------------------------------------- 3. add liquidity
  const ethForLp = seedWei; // same ETH amount on the WETH side
  console.log(`adding liquidity: ${formatEther(balance)} rise + ${formatEther(ethForLp)} ETH`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const addHash = await wallet.writeContract({
    address: routerAddr,
    abi: UNI_V2_ROUTER_ABI,
    functionName: "addLiquidityETH",
    args: [
      riseAddr,
      balance,
      (balance * 99n) / 100n, // 1% slippage on rise side
      (ethForLp * 99n) / 100n,
      account.address,
      deadline,
    ],
    value: ethForLp,
  });
  console.log(`add tx:   ${addHash}`);
  await pub.waitForTransactionReceipt({ hash: addHash });

  // ----------------------------------------------------------------- 4. lock LP
  const factoryAddr = await pub.readContract({
    address: routerAddr,
    abi: UNI_V2_ROUTER_ABI,
    functionName: "factory",
  });
  const wethAddr = await pub.readContract({
    address: routerAddr,
    abi: UNI_V2_ROUTER_ABI,
    functionName: "WETH",
  });
  const pairAddr = await pub.readContract({
    address: factoryAddr,
    abi: FACTORY_ABI,
    functionName: "getPair",
    args: [riseAddr, wethAddr],
  });
  if (pairAddr === zeroAddress) throw new Error("pair not created");

  const lpBalance = await pub.readContract({
    address: pairAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`pair:     ${pairAddr}`);
  console.log(`LP held:  ${lpBalance.toString()}`);
  console.log(`burning LP to ${BURN_ADDRESS}…`);
  const burnHash = await wallet.writeContract({
    address: pairAddr,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [BURN_ADDRESS, lpBalance],
  });
  await pub.waitForTransactionReceipt({ hash: burnHash });
  console.log(`burn tx:  ${burnHash}`);

  console.log(`\ndone.\n`);
  console.log(`dexscreener will pick this up automatically once it indexes the new pair.`);
  console.log(`pair address (share this in announcements): ${pairAddr}`);

  // silence unused
  void parseUnits;
}

function required(name: string) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
