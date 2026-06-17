/* Inline SVG brand mark + wordmark for the audit chatbot. The old
 * PNG exports (logo-icon.png / logo-wordmark.png) were generated from
 * an earlier brand iteration and had two problems at small render
 * sizes: the mark had extra padding baked into the PNG so the visual
 * content sat at the bottom of its bounding box, and the wordmark
 * subtitle became illegible below ~64px. Inline SVG fixes both:
 * the mark fills a 24x24 viewBox, the wordmark uses the canonical
 * horizontal lockup with the mark + "emvy" text in one balanced
 * composition, and the colour is driven by `currentColor` so callers
 * can theme it via CSS without an extra asset round-trip.
 *
 * The canonical SVGs live at emvy-website-v2/public/brand/. We mirror
 * the geometry here so the chatbot ships standalone (no cross-origin
 * asset dep). If the website re-exports the lockup, just update the
 * paths below. */

import * as React from "react";

type EmvyLogoProps = {
  size?: number;
  className?: string;
  title?: string;
};

// The MV monogram. 24x24 viewBox; the mark itself fills most of the
// canvas (2px margin) so it's centred at any render size. The path
// uses evenodd fill so the inner triangle punches a V-shaped notch
// through the outer rectangle — that's the brand's signature.
export function EmvyLogo({
  size = 24,
  className,
  title = "EMVY",
  color,
}: EmvyLogoProps & { color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color ?? "var(--accent, #56d9ff)"}
      fillRule="evenodd"
      role="img"
      aria-label={title}
      className={className}
      style={{ display: "block" }}
    >
      <title>{title}</title>
      <path d="M2 4 H22 V20 H2 Z M7 4 L17 4 L12 17 Z" />
    </svg>
  );
}

// Horizontal lockup: mark on the left, "emvy" wordmark on the right.
// Aspect 560:100 (5.6:1). The mark uses the same MV path as above
// (mapped to its 8..92 / 15..85 box inside the lockup viewBox); the
// wordmark text uses Space Grotesk 600 with tight tracking to match
// the website's display font.
export function EmvyWordmark({
  height = 28,
  className,
  markColor,
  textColor,
}: {
  height?: number;
  className?: string;
  markColor?: string;
  textColor?: string;
}) {
  // Width follows the aspect ratio so the lockup stays balanced at
  // any height. height=28 → width=156.8, height=48 → width=268.8.
  const width = height * 5.6;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 560 100"
      fill="none"
      role="img"
      aria-label="EMVY · AI Consultancy"
      className={className}
      style={{ display: "block" }}
    >
      {/* MV mark — left side */}
      <path
        d="M 8 15 H 92 V 85 H 8 Z M 26 15 L 74 15 L 50 75 Z"
        fill={markColor ?? "var(--accent, #56d9ff)"}
        fillRule="evenodd"
      />
      {/* Wordmark — "emvy" */}
      <text
        x="120"
        y="68"
        fontFamily="'Space Grotesk', 'Manrope', system-ui, sans-serif"
        fontSize="64"
        fontWeight="600"
        letterSpacing="-2.5"
        fill={textColor ?? "currentColor"}
      >
        emvy
      </text>
    </svg>
  );
}

export default EmvyLogo;