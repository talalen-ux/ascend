"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

// Wagmi's default public Sepolia endpoint (`rpc.sepolia.org`) returns
// 404 — explicitly point at a working RPC. Override per-deploy via
// NEXT_PUBLIC_SEPOLIA_RPC_URL (e.g. a private Alchemy/Infura URL),
// otherwise fall back to drpc's free public endpoint.
//
// Note: anything in NEXT_PUBLIC_* is bundled into the client and
// visible in the browser. Don't put a paid/rate-limited API key here
// in production — proxy through a backend instead.
const SEPOLIA_RPC_URL = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://sepolia.drpc.org";

const wagmi = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "ascend" }),
  ],
  transports: {
    [mainnet.id]: http(),
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
