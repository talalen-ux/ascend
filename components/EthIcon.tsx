import { TokenETH } from "@web3icons/react";

/**
 * ETH currency mark using @web3icons/react. Replaces the previous "Ξ"
 * text glyph everywhere in the UI. Inline-aligned with text by default
 * via verticalAlign + relative top-pixel nudge for visual centering on
 * the baseline.
 *
 * Pass `size` to control width/height in px (default 12 — pairs well
 * with 11–13px font sizes used in our metric strips).
 */
export function EthIcon({
  size = 12,
  className,
  variant = "mono",
}: {
  size?: number;
  className?: string;
  /// "mono" mints the icon in our text colour via CSS currentColor;
  /// "branded" uses the official Ethereum brand colour.
  variant?: "mono" | "branded";
}) {
  return (
    <TokenETH
      size={size}
      variant={variant === "mono" ? "mono" : "branded"}
      className={className}
      style={{
        display: "inline-block",
        verticalAlign: "-0.125em",
      }}
    />
  );
}
