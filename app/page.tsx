import { Hero } from "@/components/Hero";
import { State } from "@/components/State";
import { Projection } from "@/components/Projection";
import { Trade } from "@/components/Trade";
import { Mechanism } from "@/components/Mechanism";
import { VenueRow } from "@/components/VenueRow";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10 md:py-14">
      <Hero />

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <State />
          <VenueRow />
          <Projection />
        </div>
        <Trade />
      </div>

      <Mechanism />

      <footer className="mt-20 flex items-center justify-between text-[11px] text-ash">
        <span>vault-backed · monotone floor · own counterparty · uniswap v4</span>
        <span className="font-mono">ascend — v1.0</span>
      </footer>
    </main>
  );
}
