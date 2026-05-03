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
  title: "ASCENT — A store of value with memory",
  description:
    "Ascent is a store of value that rewards patience. Buyers pay a premium during hype; sellers receive a bonus when hype cools. One token, one Uniswap v4 pool, math-enforced.",
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
