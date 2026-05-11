"use client";

import { motion } from "framer-motion";
import { useAscendState } from "@/hooks/useAscendState";
import { useActivity } from "@/hooks/useActivity";
import {
  K,
  marginalMintPriceAt,
  livePerTokenBurnAt,
} from "@/lib/floor_v3";
import { useEthPrice } from "@/hooks/useEthPrice";

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

function fmtUsd(eth: number, rate: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(eth) || eth <= 0) return "$0";
  const usd = eth * rate;
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
  const ethUsd = useEthPrice();

  const priceMint = marginalMintPriceAt(state.ethCum);
  // Sato monotone floor — conceptual long-term anchor. Read from chain.
  const priceFloorEth = state.floorEth;
  // Live burn payout per ascend at tier-1 (90% payout, fresh wallet) —
  // includes 1% token fee, 0.7% protocol fee, block-age penalty, bonus.
  const priceLiveBurnEth = livePerTokenBurnAt(state);

  const fdvEth = priceMint * K;
  const circMcapEth = priceMint * state.supply;

  const ethBackingPerSato = state.supply > 0 ? state.reserveEth / state.supply : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="panel p-5 md:p-6"
    >
      <header className="mb-4 flex items-center gap-3">
        <span className="text-[10px] font-medium uppercase tracking-widest2 text-ash">
          ascend data
        </span>
        <span className="text-[11px] text-ash">live · refreshes every 30s</span>
      </header>

      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
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
          <Cell label="mint" value={fmtUsd(priceMint, ethUsd)} valueClass="text-bone" />
          <Cell
            label="live burn"
            value={fmtUsd(priceLiveBurnEth, ethUsd)}
            sub="tier-1, after fees + penalty"
          />
          <Cell
            label="floor (mono)"
            value={fmtUsd(priceFloorEth, ethUsd)}
            sub="lifetime min if held"
          />
          <Cell
            label="exit cost"
            value={
              priceMint > 0
                ? `${(((priceMint - priceLiveBurnEth) / priceMint) * 100).toFixed(2)}%`
                : "—"
            }
            sub="round-trip mint→burn loss"
          />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Valuation
          </h3>
          <Cell label="mcap (fd)" value={fmtUsd(fdvEth, ethUsd)} sub={`${fmtEth(fdvEth, 2)} Ξ`} />
          <Cell
            label="mcap (circ)"
            value={fmtUsd(circMcapEth, ethUsd)}
            sub={`${fmtEth(circMcapEth, 4)} Ξ`}
          />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Reserve
          </h3>
          <Cell
            label="liquidity"
            value={fmtUsd(state.reserveEth, ethUsd)}
            sub={`${fmtEth(state.reserveEth, 4)} Ξ`}
          />
          <Cell label="eth/ascend" value={fmtUsd(ethBackingPerSato, ethUsd)} />
          <Cell
            label="burnt fees"
            value={act.isLoading ? "…" : `${fmtEth(act.burntFeesEth, 4)} Ξ`}
          />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Surplus
          </h3>
          <Cell
            label="overcollat"
            value={`${(state.surplusRatioBps / 100).toFixed(2)}%`}
            sub={`${fmtEth(state.surplusEth, 4)} Ξ`}
            valueClass={
              state.surplusRatioBps >= 1000 ? "text-accent" : "text-bone"
            }
          />
          <Cell
            label="bonus active"
            value={
              state.bonusBps > 0
                ? `+${(state.bonusBps / 100).toFixed(2)}%`
                : state.surplusRatioBps >= 1000
                ? "<0.01%"
                : "0%"
            }
            sub={
              state.bonusBps > 0
                ? "paid on every burn"
                : state.surplusRatioBps >= 1000
                ? "trigger crossed; ramp warming"
                : `triggers @ 10%`
            }
            valueClass={state.bonusBps > 0 ? "text-accent" : "text-bone"}
          />
          <Cell
            label="model"
            value="Sato + 3% surplus"
            sub="penalty: 0–10/100/1000 blk"
          />
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest2 text-ash">
            Activity 24h
          </h3>
          <Cell label="vol" value={act.isLoading ? "…" : fmtUsd(act.vol24hEth, ethUsd)} sub={act.isLoading ? "" : `${fmtEth(act.vol24hEth, 4)} Ξ`} />
          <Cell label="txns" value={act.isLoading ? "…" : act.txns24h.toLocaleString()} />
          <Cell
            label="net flow"
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
