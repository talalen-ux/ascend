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
  title: "sato — code that runs without an operator",
  description:
    "sato is a fair-launch erc-20 issued from a single bonding-curve contract on ethereum. price is deterministic, supply asymptotes at 21,000,000, no admin, no upgrade, no migration.",
};

export const viewport: Viewport = {
  themeColor: "#070708",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="canvas-bg min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
