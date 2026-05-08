/**
 * The ascend mark. Loads /logo.png from the public folder so a designer
 * can drop in a final asset without touching the React tree.
 *
 * Drop the brand-master file at `public/logo.png` to update the mark
 * everywhere it's used (Hero, TopNav, faded background mark, etc.).
 *
 * `objectFit: "contain"` so the image scales correctly when the
 * declared width/height differs from the source aspect ratio.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="ascend"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
