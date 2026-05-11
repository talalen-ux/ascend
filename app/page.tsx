import { Hero } from "@/components/Hero";
import { State } from "@/components/State";
import { Curve } from "@/components/Curve";
import { SatoData } from "@/components/SatoData";
import { Issuance } from "@/components/Issuance";
import { Trade } from "@/components/Trade";
import { Mechanism } from "@/components/Mechanism";
import { VenueRow } from "@/components/VenueRow";
import { Holdings } from "@/components/Holdings";
import { Tiles } from "@/components/Tiles";
import { RewardChart } from "@/components/RewardChart";
import { Mark } from "@/components/Mark";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 md:py-14">
      <Hero />

      <State />
      <VenueRow />

      <div className="mt-6">
        <Curve />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Trade />
        <SatoData />
      </div>

      <Issuance />

      <RewardChart />

      <Tiles />

      <Holdings />

      <Mechanism />

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[11px] text-ash sm:mt-20">
        <div className="flex items-center gap-3">
          <Mark size={20} />
          <span>curve-backed floor · tile rewards from volume · uniswap v4</span>
        </div>
        <span className="font-mono">ascend — v3</span>
      </footer>
    </main>
  );
}
