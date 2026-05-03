import { Dashboard } from "@/components/Dashboard";
import { TradePanel } from "@/components/TradePanel";
import { MomentumGraph } from "@/components/MomentumGraph";
import { InsightBox } from "@/components/InsightBox";
import { Header } from "@/components/Header";

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <Header />

      <div className="space-y-10">
        <Dashboard />
        <div className="grid gap-6 md:grid-cols-2">
          <TradePanel />
          <div className="space-y-6">
            <MomentumGraph />
            <InsightBox />
          </div>
        </div>
      </div>

      <footer className="mt-20 flex items-center justify-between text-[11px] text-ash">
        <span>Cumulative buy pressure encoded into the AMM. Decays per block.</span>
        <span className="font-mono">v0.1</span>
      </footer>
    </main>
  );
}
