"use client";

import { motion } from "framer-motion";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  K,
  S,
  PENALTY_FLOOR_BPS,
  PENALTY_CEIL_BPS,
  PENALTY_TAU_BLOCKS,
  PENALTY_CAP_BLOCKS,
  penaltyMultBps,
} from "@/lib/floor_v3";

// ────────────────────────────────────────────────────────────────────────
// Inline visualizations
// ────────────────────────────────────────────────────────────────────────

const COLORS = {
  accent: "#c5ee47",
  amber: "#f6a93f",
  pink: "#f06292",
  bone: "#ededf0",
  ash: "#71717a",
  edge: "#1f1f25",
};

/// The bonding curve. supply vs cumulative ETH paid in.
function BondingCurveChart() {
  const eMax = 5 * S;
  const data = Array.from({ length: 100 }, (_, i) => {
    const e = (i / 99) * eMax;
    const supply = K * (1 - Math.exp(-e / S));
    return { e, supply };
  });
  return (
    <div className="my-6 h-56 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
          <defs>
            <linearGradient id="wpCurveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.28} />
              <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={COLORS.edge} strokeDasharray="2 6" />
          <XAxis
            dataKey="e"
            type="number"
            domain={[0, eMax]}
            ticks={[0, S, 2 * S, 3 * S, 4 * S, 5 * S]}
            tickFormatter={(v) => (v === 0 ? "0" : `${v.toFixed(2)} ETH`)}
            stroke={COLORS.ash}
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: COLORS.edge }}
            label={{
              value: "ETH deposited",
              position: "insideBottom",
              offset: -4,
              fill: COLORS.ash,
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            domain={[0, K]}
            ticks={[0, K * 0.25, K * 0.5, K * 0.75, K]}
            tickFormatter={(v) => `${(v / 1e6).toFixed(0)}m`}
            stroke={COLORS.ash}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Area
            type="monotone"
            dataKey="supply"
            stroke={COLORS.accent}
            strokeWidth={1.75}
            fill="url(#wpCurveFill)"
            isAnimationActive={false}
          />
          <ReferenceLine
            y={K}
            stroke={COLORS.bone}
            strokeOpacity={0.35}
            strokeDasharray="4 4"
            label={{
              value: "100m cap (never reached)",
              position: "insideTopRight",
              fill: COLORS.bone,
              fontSize: 9,
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/// The patience curve. burn payout % vs hold-age in blocks.
function PatienceCurveChart() {
  const xMax = 500;
  const data = Array.from({ length: 100 }, (_, i) => {
    const b = (i / 99) * xMax;
    return { b, payout: penaltyMultBps(b) / 100 };
  });
  return (
    <div className="my-6 h-56 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
          <defs>
            <linearGradient id="wpPatienceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.28} />
              <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={COLORS.edge} strokeDasharray="2 6" />
          <XAxis
            dataKey="b"
            type="number"
            domain={[0, xMax]}
            ticks={[0, 100, 200, 300, 400, 500]}
            tickFormatter={(v) => {
              if (v === 0) return "now";
              if (v === 100) return "~20 min";
              if (v === 500) return "~1.7 hr";
              return `${v}b`;
            }}
            stroke={COLORS.ash}
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: COLORS.edge }}
            label={{
              value: "blocks since you received ascend",
              position: "insideBottom",
              offset: -4,
              fill: COLORS.ash,
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            domain={[88, 101]}
            ticks={[90, 95, 99, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke={COLORS.ash}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <ReferenceLine
            y={100}
            stroke={COLORS.bone}
            strokeOpacity={0.35}
            strokeDasharray="4 4"
            label={{
              value: "full payout",
              position: "insideTopRight",
              fill: COLORS.bone,
              fontSize: 9,
            }}
          />
          <Area
            type="monotone"
            dataKey="payout"
            stroke={COLORS.accent}
            strokeWidth={1.75}
            fill="url(#wpPatienceFill)"
            isAnimationActive={false}
          />
          <ReferenceDot
            x={0}
            y={90}
            r={5}
            fill={COLORS.pink}
            stroke="none"
            label={{
              value: "flipper · 10% penalty",
              position: "right",
              fill: COLORS.pink,
              fontSize: 10,
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/// Tile multiplier distribution chart.
function RewardDistributionChart() {
  const data = [
    { mult: "×1", prob: 62.5, color: "#5d6678" },
    { mult: "×2", prob: 18.75, color: "#9caf3e" },
    { mult: "×3", prob: 12.5, color: "#c5ee47" },
    { mult: "×4", prob: 6.25, color: "#f6a93f" },
  ];
  return (
    <div className="my-6 h-44 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 12, bottom: 24, left: 4 }}>
          <CartesianGrid stroke={COLORS.edge} strokeDasharray="2 6" />
          <XAxis
            dataKey="mult"
            stroke={COLORS.ash}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            label={{
              value: "multiplier · expected = 1.625×",
              position: "insideBottom",
              offset: -4,
              fill: COLORS.ash,
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            domain={[0, 75]}
            ticks={[0, 25, 50, 75]}
            tickFormatter={(v) => `${v}%`}
            stroke={COLORS.ash}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Bar dataKey="prob" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Whitepaper page
// ────────────────────────────────────────────────────────────────────────

export default function Whitepaper() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 md:py-20">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-16"
      >
        <p className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          whitepaper · the mining adventure
        </p>
        <h1 className="mt-3 text-4xl font-medium leading-[1.05] tracking-tight text-bone md:text-[56px]">
          a curious machine on the
          <br />
          <span className="text-accent">ethereum frontier</span>.
        </h1>
        <p className="mt-6 text-[15px] leading-relaxed text-ash md:text-[17px]">
          no team. no admin. no presale. no telegram group of insiders.
          one contract, one exponential curve, and a question that&rsquo;ll
          decide whether you make money or fund somebody else who does:
          {" "}
          <span className="text-bone italic">how long can you hold?</span>
        </p>
      </motion.header>

      <Chapter num="1" title="the frontier">
        <p>
          You stumble onto an Ethereum contract. It accepts ETH. It mints
          something called <strong className="text-bone">ascend</strong> in
          return. The total supply is capped at <Strong>100,000,000</Strong> —
          a hard mathematical ceiling the curve approaches but can never reach.
          Same idea Bitcoin had with its 21M cap, scaled up.
        </p>
        <p>
          You poke around. There&rsquo;s no documentation about who runs it.
          No Twitter announcement of a token launch. No vesting schedule.
          No &ldquo;founder allocation.&rdquo; You read the source code: there&rsquo;s no{" "}
          <Code>onlyOwner</Code> function. There&rsquo;s no{" "}
          <Code>setFee()</Code> setter. There&rsquo;s no <Code>pause()</Code> switch.
          The fees, the math, the rules — all hardcoded in the constructor.
          The deployer&rsquo;s key is already irrelevant.
        </p>
        <p>
          You realize: this is a machine. Not a company. Not a DAO. A{" "}
          <Strong>machine</Strong>. It runs on math. It runs forever. And
          it&rsquo;s asking you a question: <em>do you want to mine some?</em>
        </p>
      </Chapter>

      <Chapter num="2" title="striking ore">
        <p>
          You send <Strong>0.1 ETH</Strong>. The machine doesn&rsquo;t just hand you
          a flat number of tokens. It runs your ETH through this curve:
        </p>
        <Formula>supply = 100,000,000 × (1 − e^(−ETH_deposited / S))</Formula>
        <p>Don&rsquo;t worry about the math — here&rsquo;s what it looks like:</p>

        <BondingCurveChart />

        <p>
          The curve is <strong className="text-bone">steep at the start, flat at the end</strong>.
          That&rsquo;s the whole story.
        </p>
        <ul className="mt-4 space-y-2 pl-6 list-disc">
          <li>
            The first miner to deposit 0.1 ETH gets <Strong>millions</Strong> of ascend.
          </li>
          <li>The 100th miner pays the same 0.1 ETH and gets thousands.</li>
          <li>The 10,000th miner pays 0.1 ETH and gets a handful.</li>
        </ul>
        <p>
          Every miner moves the curve forward by exactly the amount of ETH
          they put in. Every miner pays a higher per-token price than the
          one before them.{" "}
          <strong className="text-bone">The early prospector eats well.</strong>
        </p>
        <Callout>
          Like Bitcoin&rsquo;s halving schedule — the issuance rate decays.
          Early adopters benefit structurally. There&rsquo;s no whitelist.
          No gatekeeper. The curve is the same for everyone. The only
          unfair advantage is showing up early.
        </Callout>
      </Chapter>

      <Chapter num="3" title="the patience game">
        <p>So you have ascend. Now what?</p>
        <p>
          You can hold it. You can transfer it. You can <em>burn it</em> — send it
          back into the curve in exchange for ETH. The contract has a function
          called <Code>sell</Code>. You call it, it pays you out.
        </p>
        <p>
          But here&rsquo;s where the machine gets clever. The amount you receive
          depends on how long you&rsquo;ve been holding:
        </p>

        <PatienceCurveChart />

        <p>Three things to notice on this curve:</p>
        <ul className="mt-4 space-y-2 pl-6 list-disc">
          <li>
            <Strong>Burn instantly = lose 10%</Strong>. The contract takes a tenth
            of what you&rsquo;d otherwise get.
          </li>
          <li>
            <Strong>Wait ~14 minutes = lose only 5%</Strong>. The penalty curves
            smoothly downward.
          </li>
          <li>
            <Strong>Wait ~1.7 hours = lose nothing</Strong>. Past 500 blocks, you
            get the full curve payout.
          </li>
        </ul>
        <p>
          Now ask: where does the 10% penalty go? It doesn&rsquo;t burn into
          the void. It doesn&rsquo;t go to some treasury that a team controls.
          It goes into a <Strong>surplus reserve</Strong> — a pool sitting inside
          the same machine.
        </p>
        <p>
          And once that surplus crosses a threshold,{" "}
          <strong className="text-bone">it starts paying bonuses to anyone burning patiently</strong>.
        </p>
        <p className="text-bone">
          So: flippers literally fund diamond hands. The faster someone
          panic-sells, the more they donate to the patient holder. It&rsquo;s not
          a marketing slogan — it&rsquo;s a contract instruction. Look at the
          code if you doubt it.
        </p>
      </Chapter>

      <Chapter num="4" title="the ascension grid">
        <p>
          There&rsquo;s another mechanic. Every time someone mints or burns,{" "}
          <Strong>0.2% of the fee</Strong> gets shaved off and sent to a separate
          contract called the <Strong>TileEngine</Strong>.
        </p>
        <p>Every 24 hours, this contract runs a deterministic lottery:</p>
        <ul className="mt-4 space-y-2 pl-6 list-disc">
          <li>
            <strong className="text-bone">68% of holders</strong> get cryptographically selected.
          </li>
          <li>
            Selected holders can claim <strong className="text-bone">one tile</strong>{" "}
            out of a 12×12 grid (144 tiles total).
          </li>
          <li>Each tile reveals a hidden multiplier when claimed: 1× to 4×.</li>
        </ul>

        <RewardDistributionChart />

        <p>
          The distribution is locked in the contract. ×1 is common (62.5%),
          ×4 is rare (6.25%). On average, your reward is{" "}
          <Strong>1.625× the base</Strong> the pool sets for the epoch.
        </p>
        <p>
          But here&rsquo;s the unique part:{" "}
          <strong className="text-bone">you don&rsquo;t get paid in ETH</strong>.
          The TileEngine takes your reward ETH and routes it back through the
          bonding curve as a fresh mint. You get the resulting ascend.
        </p>
        <Callout>
          So every tile claim is a <em>protocol-backed buyback</em>. The
          ETH advances the curve, lifting the marginal price for every
          existing holder. The freshly minted ascend goes to you. The
          claimer wins; the holders win; the curve grows. Nobody pays for it
          but the original fee revenue, which is recycled back into the asset.
        </Callout>
      </Chapter>

      <Chapter num="5" title="the asymptote">
        <p>
          Bitcoin&rsquo;s 21M cap isn&rsquo;t a hard-coded limit. It&rsquo;s the sum of
          an infinite geometric series of halving block rewards: 50 + 25 + 12.5 + ...
          The math itself converges to 21M and never goes past.
        </p>
        <p>
          ascend uses the same idea, scaled to 100M. The curve{" "}
          <Code>q(e) = K × (1 − e^(−e/S))</Code> approaches 100M from below,
          asymptotically. After <Strong>5 × S</Strong> of ETH has been deposited,
          supply reaches 99.3% of cap. After 10 × S, it&rsquo;s 99.9995%. But
          never quite 100,000,000.
        </p>
        <p>
          The last ascend can never be minted. Eventually the curve flattens
          so much that even <em>massive</em> ETH inputs produce only fractional
          tokens. The cap is structural, not stipulated.
        </p>
        <p>
          This isn&rsquo;t deflationary marketing. It&rsquo;s arithmetic. The
          contract refuses to mint past the integral of an exponentially
          decaying rate.
        </p>
      </Chapter>

      <Chapter num="6" title="walking away">
        <p>
          The hardest thing about most token projects: someone is at the
          wheel. The dev can change parameters. The DAO can vote to inflate.
          The multisig can pause. The treasury can &ldquo;rebalance.&rdquo;
          You&rsquo;re always in someone else&rsquo;s house.
        </p>
        <p>ascend is different by construction.</p>
        <ul className="mt-4 space-y-2 pl-6 list-disc">
          <li>
            No <Code>Ownable</Code> base class. The contract has no owner role.
          </li>
          <li>No <Code>upgradeTo()</Code> function. It&rsquo;s not a proxy.</li>
          <li>No <Code>pause()</Code>. No emergency switch.</li>
          <li>No admin allow-list for the token mint function.</li>
          <li>
            The constructor sets every constant — K, S, fees, penalty curve,
            tile distribution — and the bytecode is then immutable.
          </li>
        </ul>
        <p>
          Read the source. Find the admin. There isn&rsquo;t one. When the
          deployer walks away from the keyboard, the contract keeps running
          on the same rules. The blockchain is the operator. The math is the
          spec. <strong className="text-bone">There is no shutdown.</strong>
        </p>
      </Chapter>

      <Chapter num="7" title="why this matters">
        <p>
          You came for the same reason anyone comes to a new chain: you want
          a position in something that might be big later. Most tokens give
          you that, but in exchange you sign up for a team&rsquo;s good
          behavior. Their roadmap. Their decisions. Their potential rugpull.
        </p>
        <p>
          ascend gives you a position too, but the deal is different. The
          rules are math, visible in the source, immutable forever. The early
          miner gets cheap tokens. The patient holder gets the full curve
          payout plus a bonus from flippers. The flipper gets a structural
          loss. The tile claimer gets a buyback-funded reward.
        </p>
        <p>
          <strong className="text-bone">No one gets a special deal.</strong>{" "}
          Not even the deployer.
        </p>
        <p>
          That&rsquo;s the whole adventure. Mine when the curve is shallow.
          Hold past the penalty. Claim your tiles. Watch the surplus grow.
          And when the curve eventually saturates near 100M, you&rsquo;ll either
          have been part of it from the start, or you&rsquo;ll be a late buyer
          paying premium prices to early miners who came in cheap.
        </p>
        <p className="text-bone">
          Either way, the contract doesn&rsquo;t care. It just runs.
        </p>
      </Chapter>

      <Chapter num="8" title="for the nerds">
        <p>
          The above was the story. Here&rsquo;s the precise machinery, for
          anyone who wants to read the contract.
        </p>

        <SubChapter title="curve">
          <Formula>q(e) = K · (1 − e^(−e/S))</Formula>
          <Formula>p(e) = (S/K) · e^(e/S) — marginal mint price</Formula>
          <Formula>
            ΔE(b) = S · ln((K − mF + b) / (K − mF)) — inverse curve for burns
          </Formula>
          <p>
            mintedFair is the cumulative sum of all minted amounts. It&rsquo;s
            frozen during burns — only <Code>currentSupply</Code> shrinks when
            ascend is destroyed. This is what makes the displayed{" "}
            <Code>floor</Code> monotone non-decreasing forever.
          </p>
        </SubChapter>

        <SubChapter title="block-age penalty (smooth exponential decay)">
          <Formula>payout(b) = FLOOR + (CEIL − FLOOR) · (1 − e^(−b/TAU))</Formula>
          <p>
            With <Code>FLOOR = {PENALTY_FLOOR_BPS}bps</Code>,{" "}
            <Code>CEIL = {PENALTY_CEIL_BPS}bps</Code>,{" "}
            <Code>TAU = {PENALTY_TAU_BLOCKS} blocks</Code>,{" "}
            <Code>CAP = {PENALTY_CAP_BLOCKS} blocks</Code>. Hold-age is tracked
            per-holder via a weighted-average receive block — closes the
            transfer-bypass exploit. Sending tokens to a fresh wallet doesn&rsquo;t
            reset the penalty; the receiving wallet&rsquo;s wRB advances to the
            current block on every receive.
          </p>
        </SubChapter>

        <SubChapter title="surplus and bonus">
          <Formula>
            surplusRatioBps = (surplusReserve · 10000) / cumulativeEthIn
          </Formula>
          <Formula>
            bonusBps = max(0, (surplusRatioBps − 1000) / 5) capped at 500
          </Formula>
          <p>
            Bonus activates once over-collateralization tops 10% of curve
            obligation. Linear ramp at 1/5 to a 5% maximum at 35% over-collat.
            Bonus is paid from the surplus reserve, which grew from block-age
            penalties + the 3% surplus take on every mint.
          </p>
        </SubChapter>

        <SubChapter title="tile rewards">
          <p>
            Selection:{" "}
            <Code>keccak256(epochSeed, wallet) mod 10000 &lt; 6800</Code>. 68%
            of holders eligible per 24-hour epoch.
          </p>
          <p>
            Reward routing: <Code>TileEngine.claimTile()</Code> →{" "}
            <Code>hook.claimReward&#123;value: reward&#125;(claimer)</Code> →
            hook treats it like a mint (curve advances, ascend minted to
            claimer, ETH stays in reserve). Recipients don&rsquo;t receive ETH —
            they receive fresh ascend at the marginal curve price.
          </p>
          <p>
            Multiplier draw: keccak256-based, low nibble. Distribution
            10/3/2/1 over 16 nibbles → ×1 (62.5%), ×2 (18.75%), ×3 (12.5%), ×4
            (6.25%). Expected multiplier = 1.625, locked in{" "}
            <Code>EXPECTED_MULTIPLIER_SCALED = 1_625_000</Code>.
          </p>
        </SubChapter>

      </Chapter>

      <footer className="mt-20 border-t border-edge pt-8 text-[11px] leading-relaxed text-ash">
        <p>
          ascend — v3.0 — released to the public domain. the contract is the
          spec. read the source at the repo. trust the math, not the marketing.
          there is no marketing. there is only the curve and the question:
          how long can you hold?
        </p>
      </footer>
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Layout helpers
// ────────────────────────────────────────────────────────────────────────

function Chapter({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="mt-16 space-y-4 text-[15px] leading-[1.75] text-bone/85 md:text-[16px]"
    >
      <h2 className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] uppercase tracking-widest2 text-accent">
          ch · {num}
        </span>
        <span className="text-[20px] font-medium leading-tight text-bone md:text-[24px]">
          {title}
        </span>
      </h2>
      {children}
    </motion.section>
  );
}

function SubChapter({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 space-y-3">
      <h3 className="text-[13px] font-medium uppercase tracking-widest2 text-ash">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <p className="my-3 rounded-md border border-edge bg-canvas/60 px-4 py-2.5 font-mono text-[12px] leading-[1.7] text-bone/90 md:text-[13px]">
      {children}
    </p>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <aside className="my-5 border-l-2 border-accent bg-accent/[0.04] px-4 py-3 text-[13px] leading-relaxed text-bone/85 md:text-[14px]">
      {children}
    </aside>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-edge/60 px-1.5 py-0.5 font-mono text-[12px] text-bone/90">
      {children}
    </code>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-bone">{children}</strong>;
}
