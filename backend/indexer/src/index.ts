import Fastify from "fastify";
import { createPublicClient, formatEther, http, parseAbiItem } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { openDb } from "./db.js";
import { stateUpdatedEvent } from "./abi.js";

const HOOK = (process.env.HOOK_ADDRESS ?? "") as `0x${string}`;
const RPC = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);
const PORT = Number(process.env.PORT ?? 8787);
const POLL_MS = Number(process.env.POLL_MS ?? 12_000);
const START_BLOCK = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : undefined;

const chain = CHAIN_ID === 1 ? mainnet : sepolia;
const client = createPublicClient({ chain, transport: http(RPC) });
const db = openDb(process.env.DB_PATH ?? "ascent.db");

const eventAbi = parseAbiItem(
  "event StateUpdated(int256 F, int256 D, int256 C, int256 multiplier)",
);

async function poll() {
  if (!HOOK) return;
  const head = await client.getBlockNumber();
  const cursor = db.cursor.get("lastBlock");
  const from = cursor != null ? BigInt(cursor) + 1n : (START_BLOCK ?? head - 5_000n);
  if (from > head) return;

  const logs = await client.getLogs({
    address: HOOK,
    event: eventAbi,
    fromBlock: from,
    toBlock: head,
  });

  for (const log of logs) {
    const args = log.args as {
      F: bigint;
      D: bigint;
      C: bigint;
      multiplier: bigint;
    };
    const block = await client.getBlock({ blockNumber: log.blockNumber });
    db.insert({
      blockNumber: Number(log.blockNumber),
      timestamp: Number(block.timestamp),
      multiplier: Number(formatEther(args.multiplier)),
      F: Number(formatEther(args.F)),
      D: Number(formatEther(args.D)),
      C: Number(formatEther(args.C)),
      txHash: log.transactionHash ?? "",
    });
  }

  db.cursor.set("lastBlock", Number(head));
  if (logs.length) console.log(`indexed ${logs.length} events up to ${head}`);
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
app.get("/health", async () => ({ ok: true }));
app.get<{ Querystring: { limit?: string } }>("/history", async (req) => {
  const limit = Math.min(2_000, Math.max(1, Number(req.query.limit ?? 200)));
  return db.recent(limit);
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`indexer api on :${PORT}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

loop();

stateUpdatedEvent; // keep import for future ABI consumers
