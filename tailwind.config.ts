import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A cool, restrained palette. The accent is a single warm amber.
        ink: "#070708",
        canvas: "#0a0a0c",
        panel: "#101013",
        panel2: "#16161a",
        edge: "#1f1f25",
        edge2: "#2a2a32",
        ash: "#71717a",
        bone: "#ededf0",
        glass: "rgba(255,255,255,0.03)",
        accent: "#f4a261",       // amber
        accent2: "#e76f51",      // amber-orange
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
      },
      letterSpacing: {
        widest2: "0.32em",
      },
      boxShadow: {
        soft: "0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -28px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(244,162,97,0.18), 0 12px 40px -8px rgba(244,162,97,0.18)",
      },
      animation: {
        "pulse-soft": "pulse-soft 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        breathe: "breathe 9s ease-in-out infinite",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.55" },
          "50%": { transform: "scale(1.04)", opacity: "0.85" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
