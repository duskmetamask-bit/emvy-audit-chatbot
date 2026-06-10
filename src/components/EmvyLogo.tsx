/* MIRROR OF emvy-website-v2 — keep in sync with @/components/EmvyLogo there.
 * The MV monogram is the canonical EMVY mark. If the website cuts a new
 * version, copy it here. */

import * as React from "react";

type EmvyLogoProps = {
  size?: number;
  className?: string;
  color?: string;
  title?: string;
};

export function EmvyLogo({
  size = 24,
  className,
  color = "currentColor",
  title = "EMVY",
}: EmvyLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
      fill={color}
      fillRule="evenodd"
    >
      <title>{title}</title>
      {/* M with V cutout — outer M outline + inner V triangle removed via even-odd */}
      <path d="M3 4 H11 L20 21 L29 4 H37 V36 H29 V17 L22 28 L18 28 L11 17 V36 H3 Z M16.5 8 L20 14 L23.5 8 Z" />
    </svg>
  );
}

export default EmvyLogo;
