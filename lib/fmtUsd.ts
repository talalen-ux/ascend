/**
 * Shared ETH → USD formatting used across the dapp. Takes the current
 * rate from `useEthPrice()` so renders stay in sync with CoinGecko.
 */

/// Format an ETH amount as USD with sensible precision across magnitudes.
export function fmtUsd(eth: number, rate: number): string {
  if (!Number.isFinite(eth)) return "—";
  const usd = eth * rate;
  if (usd === 0) return "$0";
  const abs = Math.abs(usd);
  if (abs < 1e-5) return "$" + usd.toExponential(2);
  if (abs < 1e-3) return "$" + usd.toFixed(7);
  if (abs < 0.01) return "$" + usd.toFixed(6);
  if (abs < 1) return "$" + usd.toFixed(4);
  if (abs < 100) return "$" + usd.toFixed(2);
  if (abs < 10_000) return "$" + usd.toFixed(0);
  if (abs < 1e6) return "$" + (usd / 1e3).toFixed(2) + "k";
  return "$" + (usd / 1e6).toFixed(2) + "m";
}

/// Compact ETH formatting for the sub-line under USD primary displays.
export function fmtEthShort(eth: number): string {
  if (!Number.isFinite(eth)) return "—";
  if (eth === 0) return "0 ETH";
  const abs = Math.abs(eth);
  if (abs < 1e-4) return eth.toExponential(2) + " ETH";
  if (abs < 1) return eth.toFixed(6) + " ETH";
  return eth.toLocaleString(undefined, { maximumFractionDigits: 4 }) + " ETH";
}
