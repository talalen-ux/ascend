import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ASCENT — Trading Against Memory",
  description:
    "A Uniswap v4 hook-powered asset where price is distorted by the cumulative memory of buying pressure.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="grid-bg min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
