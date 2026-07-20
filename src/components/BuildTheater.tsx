"use client";

import * as React from "react";

export type BuildStage = {
  key: string;
  label: string;
  status: "pending" | "active" | "done";
};

type BuildTheaterProps = {
  stages: BuildStage[];
  businessName?: string;
};

export function BuildTheater({ stages, businessName }: BuildTheaterProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "80px 24px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 32,
      }}
      className="animate-fade-up"
    >
      <div className="label-eyebrow-accent">EMVY · Building your report</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          Building your 30-day report
        </h1>
        {businessName && (
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: 15,
              lineHeight: 1.5,
              margin: 0,
              maxWidth: 440,
            }}
          >
            Personalised for {businessName}. This usually takes around 5–8 seconds.
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginTop: 8,
        }}
      >
        {stages.map((s, i) => (
          <StageRow key={s.key} stage={s} index={i} />
        ))}
      </div>

    </div>
  );
}

function StageRow({ stage, index }: { stage: BuildStage; index: number }) {
  const isActive = stage.status === "active";
  const isDone = stage.status === "done";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        borderRadius: 10,
        background: isActive
          ? "linear-gradient(90deg, var(--accent-dim) 0%, rgba(0,229,255,0.02) 100%)"
          : "transparent",
        border: isActive ? "1px solid var(--border-accent)" : "1px solid transparent",
        boxShadow: isActive ? "0 4px 16px rgba(0, 229, 255, 0.10)" : "none",
        transition:
          "background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out), box-shadow var(--motion-base) var(--ease-out)",
        animationDelay: `${index * 60}ms`,
        overflow: "hidden",
      }}
    >
      {isActive && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            borderRadius: 2,
            background: "var(--accent)",
          }}
        />
      )}
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          background: isDone
            ? "var(--accent)"
            : isActive
            ? "transparent"
            : "var(--border)",
          border: isActive ? "2px solid var(--accent)" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {isActive && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: "var(--accent)",
              animation: "pulseDot 1.2s ease-in-out infinite",
            }}
          />
        )}
        {isDone && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5.5L4 7.5L8 2.5"
              stroke="var(--accent-ink)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: isActive ? 500 : 400,
          color: isDone
            ? "var(--text-secondary)"
            : isActive
            ? "var(--foreground)"
            : "var(--text-muted)",
          letterSpacing: "-0.005em",
        }}
      >
        {stage.label}
      </span>
    </div>
  );
}
