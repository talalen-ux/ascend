/**
 * The ascend mark. Loads /logo.svg from the public folder so a designer
 * can drop in a final asset without touching the React tree.
 *
 * The SVG keeps a `currentColor`-friendly `fill` only where it makes sense
 * — the lime-green is baked into the asset to preserve the brand color
 * regardless of the surrounding text color.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      alt="ascend"
      width={size}
      height={size}
      className={className}
      style={{ display: "block" }}
    />
  );
}
