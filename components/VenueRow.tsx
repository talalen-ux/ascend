"use client";

import { dexscreenerUrl, uniswapSwapUrl, isConfigured } from "@/lib/config";

export function VenueRow() {
  if (!isConfigured) return null;
  const dex = dexscreenerUrl();
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-ash">
      <span className="uppercase tracking-widest2">also accessible via</span>
      <span className="opacity-30">|</span>
      <a
        href={uniswapSwapUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className="text-bone/80 hover:text-accent"
      >
        uniswap →
      </a>
      {dex && (
        <>
          <span className="opacity-30">|</span>
          <a
            href={dex}
            target="_blank"
            rel="noopener noreferrer"
            className="text-bone/80 hover:text-accent"
          >
            dexscreener →
          </a>
        </>
      )}
      <span className="opacity-30">|</span>
      <span className="font-mono text-ash/80">one hook · one floor · one price</span>
    </div>
  );
}
