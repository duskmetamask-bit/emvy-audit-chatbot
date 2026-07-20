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
  // Preserve the icon's native 2:1 aspect ratio. The PNG is 426×204 — a
  // horizontal mark — so a square box stretches it horizontally. When
  // `className` is passed we let CSS take over (height-based sizing keeps
  // the aspect intact too).
  return (
    <img
      src="/brand/logo-icon.png"
      alt={title}
      width={size * 2}
      height={size}
      className={className}
      style={
        className
          ? { display: "block" }
          : { display: "block", width: size * 2, height: size }
      }
    />
  );
}

// Horizontal lockup: mark on the left, "emvy" wordmark on the right.
// Mirrors the EmvyWordmark on the marketing site so the chatbot and the
// website read as one product. `height` is a default applied only when no
// `className` is passed; CSS className wins so callers can drive
// responsive sizing via media queries (e.g. `brand-wordmark-responsive`).
export function EmvyWordmark({
  height = 28,
  className,
}: {
  height?: number;
  className?: string;
}) {
  const isResponsive = Boolean(className);
  return (
    <img
      src="/brand/logo-wordmark.png"
      alt="EMVY · AI Consultancy"
      className={className}
      style={
        isResponsive
          ? { display: "block", width: "auto" }
          : { display: "block", height, width: "auto" }
      }
    />
  );
}

export default EmvyLogo;