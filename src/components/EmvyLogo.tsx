/* Uses the paste-ready brand assets from emvy-website-v2/public/brand/.
 * Source PNGs are mirrored here so the chatbot ships without depending on
 * the website repo. If the website re-exports the lockup, copy the new
 * logo-icon.png / logo-wordmark.png over. */

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
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ display: "block" }}
    />
  );
}

export function EmvyWordmark({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <img
      src="/brand/logo-wordmark.png"
      height={height}
      alt="EMVY · AI Consultancy"
      className={className}
      style={{ display: "block", height, width: "auto" }}
    />
  );
}

export default EmvyLogo;
