import { Hero } from "@/components/Hero";
import { State } from "@/components/State";
import { Curve } from "@/components/Curve";
import { Trade } from "@/components/Trade";
import { Manifesto } from "@/components/Manifesto";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-14 md:py-20">
      <Hero />

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <State />
          <Curve />
        </div>
        <Trade />
      </div>

      <Manifesto />

      <footer className="mt-20 flex items-center justify-between text-[11px] text-ash">
        <span>fair launch · no admin · code only.</span>
        <span className="font-mono">sato — v0.1</span>
      </footer>
    </main>
  );
}
