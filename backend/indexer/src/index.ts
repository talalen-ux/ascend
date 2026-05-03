import Fastify from "fastify";
import { createPublicClient, formatEther, http, parseAbiItem } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { openDb } from "./db.js";

const HOOK = (process.env.HOOK_ADDRESS ?? "") as `0x${string}`;
const RPC = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);
const PORT = Number(process.env.PORT ?? 8787);
const POLL_MS = Number(process.env.POLL_MS ?? 12_000);
const START_BLOCK = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : undefined;
const RANGE = BigInt(process.env.LOG_RANGE ?? 5_000);

const chain = CHAIN_ID === 1 ? mainnet : sepolia;
const client = createPublicClient({ chain, transport: http(RPC) });
const db = openDb(process.env.DB_PATH ?? "ascent.db");

const stateUpdated = parseAbiItem(
  "event StateUpdated(bytes32 indexed poolId, int256 F, int256 V, int256 D, int256 C, uint256 multiplier, uint256 treasury)",
);

async function poll() {
  if (!HOOK) return;
  const head = await client.getBlockNumber();
  const cursor = db.cursor.get("lastBlock");
  let from = cursor != null ? BigInt(cursor) + 1n : (START_BLOCK ?? (head > RANGE ? head - RANGE : 0n));

  while (from <= head) {
    const to = from + RANGE - 1n > head ? head : from + RANGE - 1n;
    const logs = await client.getLogs({
      address: HOOK,
      event: stateUpdated,
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      const args = log.args as {
        poolId: `0x${string}`;
        F: bigint;
        V: bigint;
        D: bigint;
        C: bigint;
        multiplier: bigint;
        treasury: bigint;
      };
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      db.insert({
        poolId: args.poolId,
        blockNumber: Number(log.blockNumber),
        timestamp: Number(block.timestamp),
        multiplier: Number(formatEther(args.multiplier)),
        treasury: Number(formatEther(args.treasury)),
        F: Number(formatEther(args.F)),
        V: Number(formatEther(args.V)),
        D: Number(formatEther(args.D)),
        C: Number(formatEther(args.C)),
        txHash: log.transactionHash ?? "",
      });
    }

    if (logs.length) console.log(`indexed ${logs.length} events ${from}..${to}`);
    db.cursor.set("lastBlock", Number(to));
    from = to + 1n;
  }
}

async function loop() {
  for (;;) {
    try {
      await poll();
    } catch (e) {
      console.error("poll error:", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const app = Fastify({ logger: false });
app.get("/health", async () => ({ ok: true, head: Number(await client.getBlockNumber()) }));
app.get<{ Querystring: { limit?: string; poolId?: string } }>("/history", async (req) => {
  const limit = Math.min(2_000, Math.max(1, Number(req.query.limit ?? 200)));
  return db.recent(req.query.poolId, limit);
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`indexer api on :${PORT}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

loop();
