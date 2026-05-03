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
  title: "ASCENT — Trading Against Memory",
  description:
    "A Uniswap v4 hook-powered asset where price is distorted by the cumulative memory of buying pressure.",
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
