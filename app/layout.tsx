import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ascend — a self-compounding asset",
  description:
    "ascend is a new ethereum-native asset class — mined into existence by ETH, backed by an on-chain vault, with a floor that is monotone non-decreasing by construction. one hook on uniswap v4 is the only venue.",
};

export const viewport: Viewport = {
  themeColor: "#070708",
};

import { TopNav } from "@/components/TopNav";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="canvas-bg min-h-screen font-sans">
        <Providers>
          <TopNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
