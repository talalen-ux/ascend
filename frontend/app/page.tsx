import { Dashboard } from "@/components/Dashboard";
import { TradePanel } from "@/components/TradePanel";
import { MomentumGraph } from "@/components/MomentumGraph";
import { InsightBox } from "@/components/InsightBox";

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-12 flex items-baseline justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.32em] text-ash">Ascent</div>
          <h1 className="mt-1 font-mono text-3xl text-bone">Trading Against Memory</h1>
        </div>
        <div className="text-right text-xs text-ash">
          <div>Uniswap v4 Hook</div>
          <div className="font-mono">m(E) = exp(F/S₁)·(1+ln(1+D/S₂)) / (1+C/S₃)</div>
        </div>
      </header>

      <div className="space-y-8">
        <Dashboard />
        <div className="grid gap-6 md:grid-cols-2">
          <TradePanel />
          <div className="space-y-6">
            <MomentumGraph />
            <InsightBox />
          </div>
        </div>
      </div>

      <footer className="mt-16 text-xs text-ash">
        Cumulative buy pressure encoded directly into the AMM. Decays per block.
      </footer>
    </main>
  );
}
