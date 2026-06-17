/* EMVY brand mark — image-based, sourced from /public/brand/logo-icon.png.
 * The previous inline SVG was the MV monogram with a V-cutout. At small
 * render sizes (14–24px) it rendered as a notched box rather than a
 * recognisable mark, which read as a placeholder. The PNG is the
 * rendered icon, so it stays crisp at any size. Colour is baked into
 * the asset (matches the EMVY rebrand 2026-06-09).
 *
 * `size` controls the rendered square edge length in px. `className`
 * and `title` pass through for accessibility. The component still
 * defaults to `role="img"` with `aria-label` set from `title`.
 *
 * The canonical asset is mirrored from emvy-website-v2/public/brand/
 * — keep the two in sync if the brand mark is ever re-exported. */

import * as React from "react";

type EmvyLogoProps = {
  size?: number;
  className?: string;
  title?: string;
};

export function EmvyLogo({
  size = 24,
  className,
  title = "EMVY",
}: EmvyLogoProps) {
  return (
    <img
      src="/brand/logo-icon.png"
      alt={title}
      width={size}
      height={size}
      className={className}
      style={{ display: "block", width: size, height: size }}
    />
  );
}

// Horizontal lockup: mark on the left, "emvy" wordmark on the right.
// Mirrors the EmvyWordmark on the marketing site so the chatbot and the
// website read as one product.
export function EmvyWordmark({
  height = 28,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/logo-wordmark.png"
      alt="EMVY · AI Consultancy"
      className={className}
      style={{
        display: "block",
        height,
        width: "auto",
      }}
    />
  );
}

export default EmvyLogo;