"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

// Viem's default public mainnet endpoint (`cloudflare-eth.com`) is
// aggressively rate-limited and intermittently returns empty state on
// new contract reads, so the dapp would render genesis values for a
// live contract. Point explicitly at a working RPC. Override per
// deploy via NEXT_PUBLIC_MAINNET_RPC_URL / NEXT_PUBLIC_SEPOLIA_RPC_URL.
//
// Note: anything in NEXT_PUBLIC_* is bundled into the client and
// visible in the browser. Don't put a paid/rate-limited API key here
// in production — proxy through a backend instead.
const MAINNET_RPC_URL = process.env.NEXT_PUBLIC_MAINNET_RPC_URL || "https://eth.drpc.org";
const SEPOLIA_RPC_URL = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://sepolia.drpc.org";

const wagmi = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "ascend" }),
  ],
  transports: {
    [mainnet.id]: http(MAINNET_RPC_URL),
    [sepolia.id]: http(SEPOLIA_RPC_URL),
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmi}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
