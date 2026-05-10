"use client";

import { motion } from "framer-motion";
import { useAscendState } from "@/hooks/useAscendState";
import { useActivity } from "@/hooks/useActivity";
import {
  K,
  USD_PER_ETH,
  BURN_FEE_RATE,
  ethToUsd,
  marginalMintPriceAt,
} from "@/lib/floor_v3";

const C = {
  supply: "#c5ee47",
  price: "#f6a93f",
  burn: "#f06292",
  bone: "#ededf0",
  ash: "#71717a",
};

function fmtSupply(n: number, places = 2): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(places) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(places) + "k";
  return n.toFixed(0);
}

function fmtUsd(eth: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(eth) || eth <= 0) return "$0";
  const usd = ethToUsd(eth);
  if (usd < 1e-5) return "$" + usd.toExponential(2);
  if (usd < 1e-3) return "$" + usd.toFixed(7);
  if (usd < 0.01) return "$" + usd.toFixed(6);
  if (usd < 1) return "$" + usd.toFixed(4);
  if (usd < 100) return "$" + usd.toFixed(2);
  if (usd < 10_000) return "$" + usd.toFixed(0);
  if (usd < 1e6) return opts.compact ? "$" + (usd / 1e3).toFixed(2) + "k" : "$" + Math.round(usd).toLocaleString();
  return "$" + (usd / 1e6).toFixed(2) + "m";
}

function fmtEth(eth: number, places = 4): string {
  if (!Number.isFinite(eth)) return "—";
  if (eth >= 1000) return eth.toFixed(0);
  if (eth >= 1) return eth.toFixed(places);
  return eth.toFixed(places);
}

function Cell({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-ash">{label}</span>
      <div className="text-right">
        <div className={`font-mono text-[13px] ${valueClass ?? "text-bone"}`}>{value}</div>
        {sub && <div className="font-mono text-[10px] text-ash">{sub}</div>}
      </div>
    </div>
  );
}

export function SatoData() {
  const state = useAscendState();
  const act = useActivity();

  const priceMint = marginalMintPriceAt(state.ethCum);
  // Per-token burn floor (Sato monotone). Computed from on-chain state.
  const supplyForBurn = state.supply > 0 ? state.supply : 1;
  const mF = state.mintedFair > 0 ? state.mintedFair : 0;
  const priceBurn =
    mF > 0 && mF < K ? (0.3 / (K - mF)) * (mF / supplyForBurn) * (1 - BURN_FEE_RATE) : 0;
  // Note: we use S=0.3 inline above so the import doesn't need updating per S.
  // It would be cleaner to import S, but since useAscendState already exposes
  // floorEth (the on-chain value), let's prefer that:
  const priceBurnEth = state.floorEth > 0 ? state.floorEth : priceBurn;

  const fdvEth = priceMint * K;
  const circMcapEth = priceMint * state.supply;

  const ethBackingPerSato = state.supply > 0 ? state.reserveEth / state.supply : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="panel mt-6 p-5 md:p-6"
    >
      <header className="mb-4 flex items-center gap-3">
        <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          ascend data
        </span>
        <span className="text-[11px] text-ash">live · refreshes every 30s</span>
      </header>

      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Supply
          </h3>
          <Cell label="max" value={fmtSupply(K, 0)} />
          <Cell label="circulating" value={fmtSupply(state.supply, 2)} />
          <Cell
            label="forward"
            value={fmtSupply(state.forwardSupply, 2)}
            sub={state.drift > 1 ? `drift ${fmtSupply(state.drift, 2)}` : undefined}
          />
          <Cell
            label="holders"
            value={act.isLoading ? "…" : act.holders.toLocaleString()}
          />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Price
          </h3>
          <Cell label="market" value={fmtUsd(priceMint)} valueClass="text-bone" />
          <Cell
            label="burn"
            value={fmtUsd(priceBurnEth)}
            valueClass=""
          />
          <Cell label="mint" value={fmtUsd(priceMint)} valueClass="" />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Valuation
          </h3>
          <Cell label="mcap (fd)" value={fmtUsd(fdvEth)} sub={`${fmtEth(fdvEth, 2)} Ξ`} />
          <Cell
            label="mcap (circ)"
            value={fmtUsd(circMcapEth)}
            sub={`${fmtEth(circMcapEth, 4)} Ξ`}
          />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Reserve
          </h3>
          <Cell
            label="liquidity"
            value={fmtUsd(state.reserveEth)}
            sub={`${fmtEth(state.reserveEth, 4)} Ξ`}
          />
          <Cell label="eth backing per ascend" value={fmtUsd(ethBackingPerSato)} />
          <Cell
            label="burnt fees"
            value={act.isLoading ? "…" : `${fmtEth(act.burntFeesEth, 4)} Ξ`}
          />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Activity 24h
          </h3>
          <Cell label="vol" value={act.isLoading ? "…" : fmtUsd(act.vol24hEth)} sub={act.isLoading ? "" : `${fmtEth(act.vol24hEth, 4)} Ξ`} />
          <Cell label="txns" value={act.isLoading ? "…" : act.txns24h.toLocaleString()} />
          <Cell
            label="net mint flow"
            value={act.isLoading ? "…" : fmtSupply(act.mintFlowAscend - act.burnFlowAscend, 2)}
            sub={
              act.isLoading
                ? ""
                : `+${fmtSupply(act.mintFlowAscend, 2)} / −${fmtSupply(act.burnFlowAscend, 2)}`
            }
          />
        </div>
      </div>
    </motion.section>
  );
}
