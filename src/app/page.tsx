"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmvyLogo, EmvyWordmark } from "@/components/EmvyLogo";
import { BuildTheater, BuildStage } from "@/components/BuildTheater";
import { RoadmapSection } from "@/components/RoadmapSection";
import { callConvexMutation } from "@/lib/convex";

const BOOKING_URL = "https://emvyai.com/services/discovery-call";

const CATEGORY_LABELS: Record<string, string> = {
  lead_capture: "Lead capture",
  booking: "Booking & scheduling",
  comms: "Customer communication",
  ops: "Job tracking",
  quoting: "Quotes & estimates",
  invoicing: "Invoicing & payment",
  followup: "Follow-up",
  reviews: "Reviews & reputation",
  team: "Team coordination",
  reporting: "Reporting",
  tools: "Tools & AI",
  goal: "90-day goal",
};

function categoryLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? id;
}

interface Assessment {
  businessName?: string;
  businessDescription?: string;
  teamSize?: string;
  scores: Record<string, number>;
  findings: Array<{ category: string; text: string; severity: "high" | "medium" | "low" }>;
  painPoints: string[];
  manualTasks: string[];
  aiTools?: string;
  budget?: string;
  goal?: string;
  obstacles?: string;
  industry?: string;
  messageCount: number;
  categoriesCovered: string[];
  readyForEmail: boolean;
  currentQuestion?: number;
  currentCategory?: string;
}

function emptyAssessment(): Assessment {
  return {
    scores: {},
    findings: [],
    painPoints: [],
    manualTasks: [],
    messageCount: 0,
    categoriesCovered: [],
    readyForEmail: false,
    currentQuestion: 0,
  };
}

interface ReportData {
  score: number;
  scoreLabel: string;
  scoreBlurb: string;
  businessName: string;
  industry: string;
  summary: string;
  week1: string[];
  weeks24: string[];
  months23: string[];
  nextStep: string;
}

interface Message {
  role: "bot" | "user";
  content: string;
  timestamp?: string;
  step?: string;
}

type Stage = "welcome" | "chat" | "email" | "building" | "report";

const STAGE_PLAN: Array<{ key: string; label: string }> = [
  { key: "mapping_week1", label: "Mapping your week 1 priorities" },
  { key: "drafting_weeks24", label: "Drafting your 30-day plan" },
  { key: "drafting_months23", label: "Mapping your 60–90 day horizon" },
  { key: "writing_summary", label: "Writing your executive summary" },
];

export default function AuditChatbot() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [assessment, setAssessment] = useState<Assessment>(emptyAssessment());
  const [sessionId, setSessionId] = useState<string>("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [buildStages, setBuildStages] = useState<BuildStage[]>(() =>
    STAGE_PLAN.map((s) => ({ key: s.key, label: s.label, status: "pending" as const }))
  );
  const [scoreDisplay, setScoreDisplay] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isBotTyping]);

  // Auto-focus input on chat stage
  useEffect(() => {
    if (stage === "chat") inputRef.current?.focus();
  }, [stage]);

  // Initialize sessionId from sessionStorage (or mint a fresh one).
  // Persists across page reloads so the worker's DO instance keeps
  // accumulating history for the same lead session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem("emvy-audit-session-id");
    if (stored) {
      setSessionId(stored);
    } else {
      const fresh = crypto.randomUUID();
      sessionStorage.setItem("emvy-audit-session-id", fresh);
      setSessionId(fresh);
    }
  }, []);

  function getTimestamp() {
    return new Date().toTimeString().slice(0, 8);
  }

  const estimatedProgress = Math.min(
    100,
    ((assessment.currentQuestion ?? assessment.categoriesCovered.length) / 13) * 100
  );

  async function callChatApi(
    message: string,
    currentAssessment: Assessment,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    signal?: AbortSignal
  ) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message, assessment: currentAssessment, messages: history }),
      signal,
    });
    if (!res.ok) throw new Error("Chat request failed: " + res.status);
    return res.json() as Promise<{
      message: string;
      assessment: Assessment;
      toolResults: Array<{ tool: string; result: { success: boolean; data?: unknown; error?: string } }>;
      done: boolean;
      sessionId: string;
    }>;
  }

  async function sendMessage(text: string) {
    const userMsg = text.trim();
    if (!userMsg || isBotTyping) return;
    const newMessages: Message[] = [...messages, { role: "user", content: userMsg, timestamp: getTimestamp() }];
    setMessages(newMessages);
    setInput("");
    setIsBotTyping(true);
    setMessages((prev) => [...prev, { role: "bot", content: "", timestamp: getTimestamp() }]);
    // Send the prior history (without the just-added user message). The
    // /api/chat route appends the new user turn itself.
    const historyForLlm = messages
      .filter((m) => m.role === "user" || m.role === "bot")
      .map((m) => ({ role: m.role === "bot" ? ("assistant" as const) : ("user" as const), content: m.content }));
    try {
      const result = await callChatApi(userMsg, assessment, historyForLlm);
      const { message: botText, assessment: updatedAssessment, sessionId: returnedSessionId } = result;
      setAssessment(updatedAssessment);
      if (returnedSessionId && returnedSessionId !== sessionId) {
        setSessionId(returnedSessionId);
        sessionStorage.setItem("emvy-audit-session-id", returnedSessionId);
      }
      setIsBotTyping(false);
      if (!botText) {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "bot") {
            copy[copy.length - 1] = { ...last, content: "hmm, something broke on my end. try again?" };
          }
          return copy;
        });
        return;
      }
      // Typewriter effect
      let i = 0;
      const chunkSize = 3;
      const interval = setInterval(() => {
        i += chunkSize;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "bot") {
            copy[copy.length - 1] = { ...last, content: botText.slice(0, i) };
          }
          return copy;
        });
        if (i >= botText.length) clearInterval(interval);
      }, 12);
    } catch {
      setIsBotTyping(false);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "bot") {
          copy[copy.length - 1] = { ...last, content: "connection issue — give it another go." };
        }
        return copy;
      });
    }
  }

  function handleSend() {
    void sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function validateEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function activateStage(stageKey: string) {
    setBuildStages((prev) => {
      const idx = prev.findIndex((s) => s.key === stageKey);
      if (idx === -1) return prev;
      return prev.map((s, i) => {
        if (i < idx) return { ...s, status: "done" as const };
        if (i === idx) return { ...s, status: "active" as const };
        return s;
      });
    });
  }

  function markAllDone() {
    setBuildStages((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
  }

  const animateScore = useCallback((target: number) => {
    const duration = 1200;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setScoreDisplay(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  async function handleEmailSubmit() {
    setEmailError("");
    if (!name.trim()) { setEmailError("Please enter your name"); return; }
    if (!email.trim() || !validateEmail(email)) { setEmailError("Please enter a valid email address"); return; }

    setStage("building");
    setBuildStages(STAGE_PLAN.map((s) => ({ key: s.key, label: s.label, status: "pending" as const })));
    setScoreDisplay(0);

    const finalAssessment: Assessment = {
      ...assessment,
      messageCount: messages.filter((m) => m.role === "user").length,
    };

    // Persist lead to Convex in the background. Don't block the build theater.
    // The mutation auto-creates/updates a `leads` row so board.emvyai.com's
    // /pipeline picks it up, and writes an activity_log entry.
    void (async () => {
      try {
        await callConvexMutation({
          functionName: "audit_chatbot_leads:create",
          args: {
            name,
            email,
            company: company || undefined,
            businessName: finalAssessment.businessName || undefined,
            industry: finalAssessment.industry || undefined,
            teamSize: finalAssessment.teamSize || undefined,
            score: 0,
            scoreLabel: "Pending",
            findings: finalAssessment.findings,
            categoriesCovered: finalAssessment.categoriesCovered,
            painPoints: finalAssessment.painPoints,
            manualTasks: finalAssessment.manualTasks,
            scores: finalAssessment.scores,
            aiTools: finalAssessment.aiTools || undefined,
            budget: finalAssessment.budget || undefined,
            goal: finalAssessment.goal || undefined,
            obstacles: finalAssessment.obstacles || undefined,
          },
        });
      } catch (err) {
        console.error("Convex lead write failed:", err);
      }
    })();

    // Open the SSE stream.
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment: finalAssessment, name, email, company }),
      });
      if (!res.ok || !res.body) throw new Error("Report stream failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let lineEnd;
        while ((lineEnd = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 2);
          parseSseChunk(chunk);
        }
      }
    } catch (err) {
      console.error("Report stream error:", err);
      setEmailError("Report generation failed — try again in a moment.");
      setStage("email");
    }
  }

  function parseSseChunk(chunk: string) {
    const lines = chunk.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!data) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === "status") {
      const stage = typeof payload.stage === "string" ? payload.stage : "";
      if (stage === "ready" || stage === "fallback") {
        markAllDone();
      } else if (stage) {
        activateStage(stage);
      }
    } else if (event === "data") {
      if (payload.report) {
        const r = payload.report as ReportData;
        setReport(r);
        animateScore(r.score);
        // Fire-and-forget: email the PDF to the lead via Resend. Doesn't
        // block the on-screen reveal; we surface a soft warning if it fails
        // but the user still has the report on screen and the download button.
        void sendReportEmail(r);
        // Slight pause so the user sees the "Ready" state before the report slides in.
        setTimeout(() => setStage("report"), 600);
      }
    }
  }

  async function sendReportEmail(r: ReportData) {
    try {
      const res = await fetch("/api/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report: r,
          lead: { name, email, company },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[/send-report] failed:", res.status, text);
      }
    } catch (err) {
      console.error("[/send-report] threw:", err);
    }
  }

  async function generatePdf() {
    if (!report) return;
    setIsGeneratingPdf(true);
    try {
      const res = await fetch("/api/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report,
          lead: { name, email, company },
          assessment,
        }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `emvy-roadmap-${(report.businessName || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-40"
        style={{
          background: "rgba(10, 17, 24, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="mx-auto"
          style={{
            maxWidth: 1180,
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: "inherit",
            }}
            aria-label="EMVY AI Mini Audit"
          >
            <EmvyWordmark height={48} />
            <span style={{ color: "var(--text-muted)", fontSize: 22, fontWeight: 400, lineHeight: 1 }}>· AI Mini Audit</span>
          </div>
          {stage === "chat" && (
            <span className="label-meta" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                Question {Math.min(13, Math.max(0, assessment.currentQuestion ?? 0))} of 13
              </span>{" "}
              · {assessment.currentCategory ? categoryLabel(assessment.currentCategory) : "starting"}
            </span>
          )}
        </div>

        {/* Slim progress line during chat */}
        {stage === "chat" && (
          <div className="progress-track" style={{ height: 1 }}>
            <div
              className="progress-fill"
              style={{ width: `${estimatedProgress}%` }}
            />
          </div>
        )}
      </header>

      <main className="flex-1 overflow-auto">
        {stage === "welcome" && <WelcomeScreen onStart={() => { setStage("chat"); void sendMessage("Hey, ready when you are."); }} />}
        {stage === "chat" && (
          <ChatStage
            messages={messages}
            input={input}
            setInput={setInput}
            isBotTyping={isBotTyping}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            inputRef={inputRef}
            assessment={assessment}
            onGoToEmail={() => setStage("email")}
            chatEndRef={chatEndRef}
          />
        )}
        {stage === "email" && (
          <EmailStage
            name={name}
            setName={setName}
            email={email}
            setEmail={setEmail}
            company={company}
            setCompany={setCompany}
            onSubmit={handleEmailSubmit}
            error={emailError}
          />
        )}
        {stage === "building" && (
          <BuildTheater
            stages={buildStages}
            businessName={assessment.businessName}
          />
        )}
        {stage === "report" && report && (
          <ReportStage
            report={report}
            name={name}
            email={email}
            scoreDisplay={scoreDisplay}
            isGeneratingPdf={isGeneratingPdf}
            onDownload={generatePdf}
          />
        )}
      </main>
    </div>
  );
}

/* ─── Welcome / Hero ─────────────────────────────────────────────────────────── */

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: 1180,
        padding: "clamp(48px, 8vh, 96px) 24px 80px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
        gap: "clamp(32px, 5vw, 72px)",
        alignItems: "center",
      }}
    >
      <style>{`
        @media (max-width: 880px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .hero-preview { display: none !important; }
        }
        @media (max-width: 640px) {
          .report-score-row { grid-template-columns: 1fr !important; text-align: left !important; }
          .report-score-row > div:first-child { align-items: flex-start !important; }
        }
      `}</style>

      <div className="hero-grid" style={{ display: "contents" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          className="label-eyebrow-accent animate-fade-down"
          style={{ animationDelay: "60ms", opacity: 0, animationFillMode: "forwards" }}
        >
          Free · 5 minutes · No commitment
        </div>

        <h1
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            fontWeight: 600,
            letterSpacing: "-0.035em",
            lineHeight: 1.02,
            margin: 0,
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 120ms forwards",
          }}
        >
          A 30-day AI
          <br />
          roadmap for your
          <br />
          <span style={{ color: "var(--accent)" }}>business</span>
          <span style={{ color: "var(--text-muted)" }}> — in 5 minutes.</span>
        </h1>

        <p
          style={{
            fontSize: 17,
            lineHeight: 1.55,
            color: "var(--text-secondary)",
            maxWidth: 480,
            margin: 0,
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 220ms forwards",
          }}
        >
          Answer 13 short questions about how your business runs day to day.
          Walk away with a personalised 30/60/90 day plan you can ship this week — built by EMVY, ready to action.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: 8,
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 320ms forwards",
          }}
        >
          <button onClick={onStart} className="btn-primary" style={{ padding: "14px 26px", fontSize: 15 }}>
            Start my audit
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="label-meta">No card · No spam · No follow-up unless you ask</span>
        </div>
      </div>

      <div className="hero-preview" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PreviewCard
          eyebrow="Week 01"
          title="Quick wins"
          items={["Audit recurring copy-paste work", "Pick the 1 to automate first", "Set up a shared roadmap doc"]}
          delayMs={420}
        />
        <PreviewCard
          eyebrow="Weeks 02–04"
          title="First automation"
          items={["Ship the week 1 target end-to-end", "Automate invoice or follow-up", "Brief the team on AI policy"]}
          delayMs={540}
          offset
        />
        <PreviewCard
          eyebrow="Months 02–03"
          title="Compound the wins"
          items={["Layer AI into lead pipeline", "Weekly AI review cadence", "Quarterly roadmap refresh"]}
          delayMs={660}
        />
      </div>
    </div>
  );
}

function PreviewCard({
  eyebrow,
  title,
  items,
  delayMs,
  offset = false,
}: {
  eyebrow: string;
  title: string;
  items: string[];
  delayMs: number;
  offset?: boolean;
}) {
  return (
    <div
      className="card-elevated"
      style={{
        padding: 18,
        transform: `translateX(${offset ? 24 : 0}px)`,
        opacity: 0,
        animation: `fadeUp var(--motion-slow) var(--ease-out) ${delayMs}ms forwards`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(135deg, transparent 0%, rgba(86, 217, 255, 0.04) 100%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span className="label-eyebrow-accent">{eyebrow}</span>
          <span className="label-meta">{items.length} actions</span>
        </div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            marginBottom: 12,
          }}
        >
          {title}
        </div>
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {items.map((it, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                gap: 10,
                fontSize: 13.5,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                alignItems: "flex-start",
              }}
            >
              <span
                className="label-meta"
                style={{ color: "var(--text-muted)", minWidth: 18, paddingTop: 1 }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ filter: i >= 2 ? "blur(3px)" : "none" }}>{it}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ─── Chat Stage ─────────────────────────────────────────────────────────────── */

function ChatStage({
  messages,
  input,
  setInput,
  isBotTyping,
  onSend,
  onKeyDown,
  inputRef,
  assessment,
  onGoToEmail,
  chatEndRef,
}: {
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  isBotTyping: boolean;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  assessment: Assessment;
  onGoToEmail: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const questionNumber = Math.min(13, Math.max(1, assessment.currentQuestion ?? 0));
  const currentCategory = assessment.currentCategory
    ? categoryLabel(assessment.currentCategory)
    : "Getting started";
  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: 760,
        padding: "clamp(24px, 4vw, 48px) 24px 200px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {messages.map((msg, idx) => (
          <ChatBubble
            key={idx}
            msg={msg}
            isBotTyping={isBotTyping}
            isLast={idx === messages.length - 1}
          />
        ))}

        {assessment.readyForEmail && !isBotTyping && (
          <div style={{ display: "flex", justifyContent: "flex-start" }} className="animate-fade-up">
            <button onClick={onGoToEmail} className="btn-primary">
              Get my roadmap
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input bar — fixed at bottom */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(10, 17, 24, 0.92)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid var(--border-subtle)",
          padding: "12px 0 16px",
        }}
      >
        <div
          className="mx-auto"
          style={{
            maxWidth: 760,
            padding: "0 24px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type your answer..."
              rows={1}
              className="input-field"
              style={{
                flex: 1,
                resize: "none",
                lineHeight: 1.5,
                maxHeight: 120,
                overflowY: "auto",
                fontSize: 15,
              }}
            />
            <button
              onClick={onSend}
              disabled={!input.trim() || isBotTyping}
              className="btn-primary"
              style={{
                padding: "12px 18px",
                opacity: !input.trim() || isBotTyping ? 0.4 : 1,
                cursor: !input.trim() || isBotTyping ? "not-allowed" : "pointer",
                transform: "none",
                boxShadow: "none",
              }}
            >
              Send
            </button>
          </div>
          <div
            className="label-meta"
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "0 4px",
              gap: 8,
            }}
          >
            <span>Your answers stay private</span>
            <span style={{ color: "var(--accent)" }}>
              Question {questionNumber} of 13 · {currentCategory}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ msg, isBotTyping, isLast }: { msg: Message; isBotTyping: boolean; isLast: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 6,
      }}
      className="animate-fade-up"
    >
      {!isUser && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <EmvyLogo size={14} />
          <span className="label-eyebrow-accent" style={{ fontSize: 10 }}>EMVY</span>
        </div>
      )}
      <div className={isUser ? "message-user" : "message-bot"}>
        {msg.content ? (
          isUser ? (
            msg.content
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: (p) => <p style={{ margin: 0 }} {...p} />,
                a: (a) => <a style={{ color: "var(--accent)" }} {...a} />,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )
        ) : isBotTyping && isLast ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--accent)" }}>
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 14,
                background: "var(--accent)",
                borderRadius: 1,
                animation: "blink 1s step-end infinite",
              }}
            />
            <span className="label-meta" style={{ color: "var(--text-muted)" }}>thinking</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Email Stage ────────────────────────────────────────────────────────────── */

function EmailStage({
  name,
  setName,
  email,
  setEmail,
  company,
  setCompany,
  onSubmit,
  error,
}: {
  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  company: string;
  setCompany: (v: string) => void;
  onSubmit: () => void;
  error: string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    onSubmit();
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
      <div className="stagger-children">
        <div className="label-eyebrow-accent">Your roadmap</div>
        <h1
          style={{
            fontSize: "clamp(32px, 4.5vw, 44px)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: 0,
            marginTop: 8,
          }}
        >
          Where should we send it?
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 16,
            lineHeight: 1.55,
            margin: "12px 0 0 0",
            maxWidth: 440,
          }}
        >
          Drop your details and we&apos;ll generate your personalised 30/60/90 day AI roadmap. Usually ready in 5–8 seconds.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 24,
            maxWidth: 420,
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="input-field"
            autoComplete="name"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="input-field"
            autoComplete="email"
          />
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company name (optional)"
            className="input-field"
            autoComplete="organization"
          />
          {error && (
            <p style={{ color: "var(--error)", fontSize: 13, margin: 0 }}>{error}</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="btn-primary"
            style={{ marginTop: 8, alignSelf: "flex-start", padding: "13px 24px" }}
          >
            {isSubmitting ? "Generating your roadmap…" : "Get my roadmap"}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Report Stage ───────────────────────────────────────────────────────────── */

function ReportStage({
  report,
  name,
  email,
  scoreDisplay,
  isGeneratingPdf,
  onDownload,
}: {
  report: ReportData;
  name: string;
  email: string;
  scoreDisplay: number;
  isGeneratingPdf: boolean;
  onDownload: () => void;
}) {
  const scoreColor = report.score >= 70 ? "var(--success)" : report.score >= 40 ? "var(--accent)" : "var(--error)";
  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: 820,
        padding: "clamp(40px, 6vw, 72px) 24px 96px",
      }}
    >
      {/* Cover */}
      <header
        className="animate-fade-up"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <EmvyLogo size={20} />
          <span className="label-eyebrow-accent">EMVY · AI Audit</span>
        </div>
        <h1
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: 0,
          }}
        >
          {report.businessName} <span style={{ color: "var(--text-muted)" }}>— 30/60/90 roadmap</span>
        </h1>
        <p className="label-meta">
          Prepared for {name} · {email}
        </p>
        <div className="divider-accent" style={{ marginTop: 8 }} />
      </header>

      {/* Score + summary card */}
      <section
        className="card-elevated report-score-row"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 32,
          alignItems: "center",
          marginBottom: 32,
          opacity: 0,
          animation: "fadeUp var(--motion-slow) var(--ease-out) 60ms forwards",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            minWidth: 140,
          }}
        >
          <div
            className="label-eyebrow-accent"
            style={{ marginBottom: 6 }}
          >
            AI Readiness
          </div>
          <div
            style={{
              fontFamily: "var(--font-display), 'Space Grotesk', system-ui, sans-serif",
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              color: scoreColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {scoreDisplay}
            <span
              style={{
                fontSize: 22,
                color: "var(--text-muted)",
                fontWeight: 500,
                marginLeft: 2,
              }}
            >
              /100
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              marginTop: 6,
              fontWeight: 500,
            }}
          >
            {report.scoreLabel}
          </div>
        </div>
        <div>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              color: "var(--foreground)",
              margin: 0,
              marginBottom: 12,
            }}
          >
            {report.summary}
          </p>
          <p
            className="label-meta"
            style={{ color: "var(--text-muted)" }}
          >
            {report.scoreBlurb}
          </p>
        </div>
      </section>

      {/* Roadmap sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
        {report.week1.length > 0 && (
          <RoadmapSection
            eyebrow="Week 01"
            title="What to do this week"
            actions={report.week1}
            index={1}
          />
        )}
        {report.weeks24.length > 0 && (
          <RoadmapSection
            eyebrow="Weeks 02–04"
            title="Your first 30 days"
            actions={report.weeks24}
            index={2}
          />
        )}
        {report.months23.length > 0 && (
          <RoadmapSection
            eyebrow="Months 02–03"
            title="The compounding horizon"
            actions={report.months23}
            index={3}
          />
        )}
      </div>

      {/* CTA block */}
      <section
        className="card-accent"
        style={{
          padding: "clamp(24px, 4vw, 36px)",
          textAlign: "center",
          opacity: 0,
          animation: "fadeUp var(--motion-slow) var(--ease-out) 500ms forwards",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(22px, 3vw, 30px)",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            margin: 0,
            marginBottom: 10,
          }}
        >
          Ready for the full picture?
        </h2>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 15,
            lineHeight: 1.55,
            margin: "0 auto 20px",
            maxWidth: 480,
          }}
        >
          {report.nextStep}
        </p>
        <a
          href={BOOKING_URL}
          className="btn-primary"
          style={{ textDecoration: "none" }}
        >
          Book a free 15-min discovery call
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <p
          className="label-meta"
          style={{ marginTop: 16, color: "var(--text-muted)" }}
        >
          No pitch deck. No pressure. Just a focused 15 minutes.
        </p>
      </section>

      {/* PDF download */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 32,
          opacity: 0,
          animation: "fadeUp var(--motion-slow) var(--ease-out) 620ms forwards",
        }}
      >
        <button
          onClick={onDownload}
          disabled={isGeneratingPdf}
          className="btn-outline"
        >
          {isGeneratingPdf ? "Generating PDF…" : "Download as PDF"}
        </button>
      </div>
    </div>
  );
}
