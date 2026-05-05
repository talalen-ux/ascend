import { Hero } from "@/components/Hero";
import { State } from "@/components/State";
import { Projection } from "@/components/Projection";
import { Trade } from "@/components/Trade";
import { HowItWorks } from "@/components/HowItWorks";
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

      <HowItWorks />

      <footer className="mt-20 flex items-center justify-between text-[11px] text-ash">
        <span>fair launch · 1% in · 3% out · no admin · uniswap v4</span>
        <span className="font-mono">ascend — v1.0</span>
      </footer>
    </main>
  );
}
