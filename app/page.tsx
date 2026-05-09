import { Hero } from "@/components/Hero";
import { State } from "@/components/State";
import { Projection } from "@/components/Projection";
import { Trade } from "@/components/Trade";
import { Mechanism } from "@/components/Mechanism";
import { VenueRow } from "@/components/VenueRow";
import { Holdings } from "@/components/Holdings";
import { Tiles } from "@/components/Tiles";
import { Mark } from "@/components/Mark";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 md:py-14">
      <Hero />

      <State />
      <VenueRow />

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Projection />
        <Trade />
      </div>

      <Tiles />

      <Holdings />

      <Mechanism />

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[11px] text-ash sm:mt-20">
        <div className="flex items-center gap-3">
          <Mark size={20} />
          <span>LP-backed floor · tile rewards from volume · uniswap v4</span>
        </div>
        <span className="font-mono">ascend — v2</span>
      </footer>
    </main>
  );
}
