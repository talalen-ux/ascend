/**
 * Convenience wrapper that invokes the Foundry deploy script.
 *
 * Usage:
 *   POOL_MANAGER=0x... TOKEN_RECIPIENT=0x... PRIVATE_KEY=0x... \
 *     npx tsx scripts/deploy.ts --rpc https://sepolia.gateway.example
 *
 * For production deployments use forge directly.
 */
import { spawnSync } from "node:child_process";
import { argv } from "node:process";

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const rpc = flag("rpc") ?? process.env.RPC_URL;
if (!rpc) {
  console.error("missing --rpc <url> or RPC_URL env");
  process.exit(1);
}

const args = [
  "script",
  "script/Deploy.s.sol:Deploy",
  "--rpc-url",
  rpc,
  "--broadcast",
  "-vvv",
];

const res = spawnSync("forge", args, { cwd: "contracts", stdio: "inherit" });
process.exit(res.status ?? 1);
