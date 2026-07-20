"use client";

// OnboardingWizard — 2-step intake for the audit chatbot. Captures
// name/email (required) and company (optional) BEFORE the chat starts,
// then mints the Convex `audit_chatbot_leads` row. Replaces the old
// end-of-chat email form.
//
// Visual + voice: matches the existing dark/cyan token system
// (--accent, --bg-card, --text-muted). Calm, plain, lowercase where
// natural, no buzzwords. Single chevron CTA per the existing arrow
// pattern. 200ms cross-fade between steps.

import { useEffect, useRef, useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHEVRON_PATH = "M2 7H12M8 3L12 7L8 11";

export interface OnboardingWizardProps {
  name: string;
  email: string;
  company: string;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  setCompany: (v: string) => void;
  // Called when both steps are done. Parent fires the `:create` mutation,
  // pre-fills `assessment.businessName = company`, then transitions to chat.
  onComplete: () => void;
}

export function OnboardingWizard({
  name,
  email,
  company,
  setName,
  setEmail,
  setCompany,
  onComplete,
}: OnboardingWizardProps) {
  // Step 1 = name+email, Step 2 = company+start.
  const [step, setStep] = useState<1 | 2>(1);
  const [emailError, setEmailError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);

  // Auto-focus the first empty field on step mount. Step 1 focuses name
  // (since name + email are both blank on first visit); if a user
  // backtracks to step 1 with one filled, focus the empty one. Step 2
  // focuses company — but only if there's no existing value, so a
  // returning user with a saved company can just hit Enter.
  //
  // The ref guard is load-bearing: deps include name/email/company, so
  // the effect fires on every keystroke. Without the guard, typing
  // "J" into name flips `name` truthy mid-flight and the next render
  // yanks focus to the email field — the user literally cannot type
  // more than one character. The guard makes this a once-per-step
  // focus, regardless of how many field edits happen.
  const lastFocusedStepRef = useRef<1 | 2 | null>(null);
  useEffect(() => {
    if (lastFocusedStepRef.current === step) return;
    lastFocusedStepRef.current = step;
    if (step === 1) {
      if (!name) nameRef.current?.focus();
      else if (!email) emailRef.current?.focus();
    } else if (!company) {
      companyRef.current?.focus();
    }
  }, [step, name, email, company]);

  function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      setEmailError("Please enter a valid email address");
      emailRef.current?.focus();
      return;
    }
    setEmailError("");
    setStep(2);
  }

  function handleStep2Submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    onComplete();
  }

  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: 520,
        padding: "clamp(48px, 10vh, 96px) 24px 80px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Live region for screen-reader step announcements */}
      <div
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        Step {step} of 2
      </div>

      <div
        className="stagger-children"
        style={{
          opacity: step === 1 ? 1 : 0,
          transform: step === 1 ? "translateY(0)" : "translateY(-8px)",
          transition: "opacity var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out)",
          pointerEvents: step === 1 ? "auto" : "none",
          position: step === 1 ? "relative" : "absolute",
        }}
      >
        <div className="label-eyebrow-accent">Your strategy</div>
        <h1
          style={{
            fontSize: "var(--text-3xl)",
            lineHeight: 1.15,
            margin: "12px 0 8px",
            letterSpacing: "-0.01em",
          }}
        >
          where should we send it?
        </h1>
        <p
          className="label-meta"
          style={{
            margin: "0 0 28px",
            color: "var(--text-secondary)",
          }}
        >
          takes about 5 minutes. we&apos;ll email your personalised 30-day
          checklist when you&apos;re done.
        </p>

        <form
          onSubmit={handleStep1Submit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
          noValidate
        >
          <div>
            <label
              htmlFor="wiz-name"
              className="label-meta"
              style={{ display: "block", marginBottom: 6 }}
            >
              your name
            </label>
            <input
              ref={nameRef}
              id="wiz-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className="input-field"
              style={{ width: "100%", fontSize: 15 }}
            />
          </div>

          <div>
            <label
              htmlFor="wiz-email"
              className="label-meta"
              style={{ display: "block", marginBottom: 6 }}
            >
              email
            </label>
            <input
              ref={emailRef}
              id="wiz-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              placeholder="jane@business.com"
              className="input-field"
              style={{
                width: "100%",
                fontSize: 15,
                borderColor: emailError ? "var(--error)" : undefined,
              }}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "wiz-email-err" : undefined}
            />
            {emailError && (
              <div
                id="wiz-email-err"
                role="alert"
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  color: "var(--error)",
                }}
              >
                {emailError}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{
                padding: "12px 20px",
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              Continue
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d={CHEVRON_PATH}
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <StepDots step={step} />
          </div>
        </form>
      </div>

      <div
        className="stagger-children"
        style={{
          opacity: step === 2 ? 1 : 0,
          transform: step === 2 ? "translateY(0)" : "translateY(8px)",
          transition: "opacity var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out)",
          pointerEvents: step === 2 ? "auto" : "none",
          position: step === 2 ? "relative" : "absolute",
        }}
      >
        <div className="label-eyebrow-accent">Your strategy</div>
        <h1
          style={{
            fontSize: "var(--text-3xl)",
            lineHeight: 1.15,
            margin: "12px 0 8px",
            letterSpacing: "-0.01em",
          }}
        >
          what do you call your business?
        </h1>
        <p
          className="label-meta"
          style={{
            margin: "0 0 28px",
            color: "var(--text-secondary)",
          }}
        >
          optional. helps us frame the report. around 10 questions next,
          give or take — your answers stay private.
        </p>

        <form
          onSubmit={handleStep2Submit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
          noValidate
        >
          <div>
            <label
              htmlFor="wiz-company"
              className="label-meta"
              style={{ display: "block", marginBottom: 6 }}
            >
              business name <span style={{ color: "var(--text-muted)" }}>(optional)</span>
            </label>
            <input
              ref={companyRef}
              id="wiz-company"
              type="text"
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Smith Plumbing"
              className="input-field"
              style={{ width: "100%", fontSize: 15 }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{
                padding: "12px 20px",
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              {isSubmitting ? "Setting up…" : "Start my assessment"}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d={CHEVRON_PATH}
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 13,
                cursor: "pointer",
                padding: "8px 4px",
              }}
            >
              Back
            </button>
            <StepDots step={step} />
          </div>
        </form>
      </div>
    </div>
  );
}

function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginLeft: "auto",
      }}
    >
      {[1, 2].map((n) => (
        <span
          key={n}
          style={{
            display: "inline-block",
            width: n === step ? 18 : 6,
            height: 6,
            borderRadius: 3,
            background:
              n === step
                ? "var(--accent)"
                : n < step
                ? "var(--accent-dim)"
                : "rgba(255,255,255,0.12)",
            transition: "width var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out)",
          }}
        />
      ))}
    </div>
  );
}
