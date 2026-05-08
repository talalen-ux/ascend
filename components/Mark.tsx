/**
 * The ascend mark. Loads /logo.jpg from the public folder so a designer
 * can drop in a final asset without touching the React tree.
 *
 * Replace the brand-master file at `public/logo.jpg` to update the
 * mark everywhere it's used (Hero, TopNav, faded background, footer).
 *
 * `objectFit: "contain"` so the image scales correctly when the
 * declared width/height differs from the source aspect ratio.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.jpg"
      alt="ascend"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
