import { Dashboard } from "@/components/Dashboard";
import { TradePanel } from "@/components/TradePanel";
import { MomentumGraph } from "@/components/MomentumGraph";
import { InsightBox } from "@/components/InsightBox";
import { Header } from "@/components/Header";
import { Docs } from "@/components/Docs";

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

      <Docs />

      <footer className="mt-20 flex items-center justify-between text-[11px] text-ash">
        <span>A store of value with memory. Patience is the edge.</span>
        <span className="font-mono">v0.1</span>
      </footer>
    </main>
  );
}
