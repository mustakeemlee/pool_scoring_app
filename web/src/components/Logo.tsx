// web/src/components/Logo.tsx — "PoolIQ" mark (web/public/logo.png, cropped
// from the source art in "App Logo/PoolIQ.png" -- outer white margin trimmed,
// nothing inside the logo's own border altered). Raster image, not inline SVG
// -- height is controlled via the `size` prop, width scales to match the
// source image's aspect ratio.
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="PoolIQ logo"
      className={className}
      style={{ height: size, width: 'auto' }}
    />
  );
}
