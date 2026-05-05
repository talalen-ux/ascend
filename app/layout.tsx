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
  title: "rise — the floor only goes up",
  description:
    "rise is a fair-launch erc-20 backed by ETH. the price floor is reserve / supply, and by construction it can only go up. 1% buy fee, 3% sell fee, no admin, no withdraw.",
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
