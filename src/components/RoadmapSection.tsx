"use client";

import * as React from "react";

type RoadmapSectionProps = {
  eyebrow: string;
  title: string;
  actions: string[];
  index: number;
};

export function RoadmapSection({ eyebrow, title, actions, index }: RoadmapSectionProps) {
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "clamp(20px, 3vw, 28px)",
        boxShadow: "var(--shadow-sm), var(--shadow-inset)",
        opacity: 0,
        animation: `fadeUp var(--motion-slow) var(--ease-out) ${index * 120}ms forwards`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 4,
        }}
      >
        <span className="label-eyebrow-accent">{eyebrow}</span>
        <span
          className="label-meta"
          style={{ color: "var(--text-muted)" }}
        >
          {String(index + 1).padStart(2, "0")} · {actions.length} actions
        </span>
      </div>
      <h2
        style={{
          fontSize: "clamp(20px, 2.6vw, 26px)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
          marginBottom: 18,
        }}
      >
        {title}
      </h2>
      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {actions.map((action, i) => (
          <RoadmapAction key={i} action={action} index={i} />
        ))}
      </ol>
    </section>
  );
}

function RoadmapAction({ action, index }: { action: string; index: number }) {
  return (
    <li
      style={{
        display: "flex",
        gap: 16,
        padding: "14px 0",
        borderTop: index === 0 ? "none" : "1px solid var(--border-subtle)",
        alignItems: "flex-start",
      }}
    >
      <span
        className="label-meta"
        style={{
          color: "var(--accent)",
          minWidth: 28,
          paddingTop: 2,
          fontWeight: 500,
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span
        style={{
          fontSize: 15,
          lineHeight: 1.6,
          color: "var(--foreground)",
          letterSpacing: "-0.005em",
        }}
      >
        {action}
      </span>
    </li>
  );
}
