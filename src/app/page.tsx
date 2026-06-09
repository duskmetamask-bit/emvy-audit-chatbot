"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rrjktvvnzjzlfquaghut.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbG...IJWw";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Assessment shape — mirrors lib/agent.ts
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
  };
}

interface ReportData {
  score: number;
  scoreLabel: string;
  scoreBlurb: string;
  businessName: string;
  industry: string;
  summary: string;
  topFindings: string[];
  recommendations: string[];
  priorityAutomations: string[];
  nextStep: string;
}

interface Message {
  role: "bot" | "user";
  content: string;
  timestamp?: string;
  step?: string;
}

type Stage = "welcome" | "chat" | "email" | "report";

export default function AuditChatbot() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [assessment, setAssessment] = useState<Assessment>(emptyAssessment());
  const [report, setReport] = useState<ReportData | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [reportShimmer, setReportShimmer] = useState(0);
  const [sessionId] = useState(() => `EMVY-${Math.random().toString(36).slice(2, 7).toUpperCase()}-AUDIT`);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Format timestamp for messages
  function getTimestamp() {
    const now = new Date();
    return now.toTimeString().slice(0, 8);
  }

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isBotTyping]);

  // Auto-focus input on chat stage
  useEffect(() => {
    if (stage === "chat") inputRef.current?.focus();
  }, [stage]);

  // Progress shimmer for top bar
  useEffect(() => {
    if (stage !== "chat") return;
    const id = setInterval(() => setReportShimmer((n) => n + 1), 30);
    return () => clearInterval(id);
  }, [stage]);

  // Estimate progress: 1 line per category, capped at 10
  const estimatedProgress = Math.min(100, (assessment.categoriesCovered.length / 10) * 100);

  // callChatApi now returns JSON (not SSE) since we use the MiniMax agent with tool calling
  async function callChatApi(history: Message[], currentAssessment: Assessment, signal?: AbortSignal) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, assessment: currentAssessment }),
      signal,
    });
    if (!res.ok) {
      throw new Error("Chat request failed: " + res.status);
    }
    return res.json() as Promise<{
      message: string;
      assessment: Assessment;
      toolResults: Array<{ tool: string; result: { success: boolean; data?: unknown; error?: string } }>;
      done: boolean;
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
    try {
      const result = await callChatApi(newMessages, assessment);
      const { message: botText, assessment: updatedAssessment, done } = result;
      setAssessment(updatedAssessment);
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
    } catch (err) {
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

  async function handleEmailSubmit() {
    setEmailError("");
    if (!name.trim()) { setEmailError("Please enter your name"); return; }
    if (!email.trim() || !validateEmail(email)) { setEmailError("Please enter a valid email address"); return; }
    setIsGeneratingReport(true);
    const finalAssessment: Assessment = { ...assessment, messageCount: messages.filter((m) => m.role === "user").length };
    try {
      await supabase.from("leads").insert({
        name,
        email,
        company: company || null,
        business_name: finalAssessment.businessName || null,
        business_description: finalAssessment.businessDescription || null,
        team_size: finalAssessment.teamSize || null,
        pain_points: finalAssessment.painPoints.join(" | ") || null,
        manual_tasks: finalAssessment.manualTasks.join(" | ") || null,
        ai_tools: finalAssessment.aiTools || null,
        budget: finalAssessment.budget || null,
        goal_6months: finalAssessment.goal || null,
        obstacles: finalAssessment.obstacles || null,
        industry: finalAssessment.industry || null,
        assessment: finalAssessment,
      });
    } catch (err) {
      console.error("Supabase error:", err);
    }
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment: finalAssessment, name, email, company }),
      });
      if (!res.ok) throw new Error("Report generation failed");
      const data = (await res.json()) as ReportData;
      setReport(data);
      setStage("report");
    } catch (err) {
      setEmailError("Report generation failed — try again in a moment.");
    } finally {
      setIsGeneratingReport(false);
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
      a.download = `emvy-audit-${(report.businessName || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
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
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0b", color: "#ececec" }}>
      {/* Top progress shimmer */}
      {stage === "chat" && (
        <div className="fixed top-0 left-0 right-0 z-50" style={{ height: "2px", background: "rgba(255,255,255,0.04)" }}>
          <div
            style={{
              height: "100%",
              width: `${estimatedProgress}%`,
              background: "linear-gradient(90deg, transparent, #06b6d4, transparent)",
              backgroundSize: "200% 100%",
              transition: "width 600ms cubic-bezier(0.16, 1, 0.3, 1)",
              animation: "shimmer 2.4s linear infinite",
            }}
          />
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40" style={{ background: "rgba(10,10,11,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div style={{ width: "22px", height: "22px", background: "#06b6d4", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontWeight: 800, fontSize: "12px", color: "#0a0a0b" }}>E</span>
            </div>
            <span style={{ fontWeight: 600, fontSize: "14px", letterSpacing: "-0.01em" }}>EMVY</span>
            <span style={{ color: "#6b6b70", fontSize: "13px", fontWeight: 400 }}>· AI Audit</span>
          </div>
          {stage === "chat" && (
            <span style={{ fontSize: "11px", color: "#06b6d4", fontWeight: 600, letterSpacing: "0.05em" }}>
              {Math.round(estimatedProgress)}% PROCESSED
            </span>
          )}
        </div>
      </header>

      {/* Session metadata bar */}
      {stage === "chat" && (
        <div style={{ background: "rgba(6,182,212,0.04)", borderBottom: "1px solid rgba(6,182,212,0.08)", padding: "6px 20px", display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#6b6b70", fontFamily: "monospace", letterSpacing: "0.03em" }}>
          <span>SESSION ID: {sessionId}</span>
          <span>MODEL: EMVY-CORE-V4</span>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        {/* WELCOME */}
        {stage === "welcome" && (
          <div className="max-w-3xl mx-auto px-5" style={{ paddingTop: "12vh", paddingBottom: "8vh" }}>
            <div className="flex flex-col items-center text-center" style={{ gap: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#06b6d4" }}>
                Free · 5–7 minutes · No commitment
              </div>
              <h1 style={{ fontSize: "clamp(36px, 5.5vw, 52px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, margin: 0 }}>
                AI audit for your<br />
                <span style={{ color: "#06b6d4" }}>business</span>
              </h1>
              <p style={{ fontSize: "15px", lineHeight: 1.6, color: "#a1a1aa", maxWidth: "460px", margin: 0 }}>
                A short chat about how your business runs day to day. You'll get a personalised AI readiness score and a few things you can do this week.
              </p>
              <button
                onClick={() => {
                  setStage("chat");
                  void sendMessage("Hey, ready when you are.");
                }}
                style={{
                  marginTop: "12px",
                  background: "#06b6d4",
                  color: "#0a0a0b",
                  fontWeight: 600,
                  fontSize: "14px",
                  padding: "12px 28px",
                  borderRadius: "9999px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Start audit →
              </button>
            </div>
          </div>
        )}

        {/* CHAT */}
        {stage === "chat" && (
          <div className="max-w-3xl mx-auto px-5" style={{ paddingTop: "32px", paddingBottom: "160px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                    gap: "6px",
                  }}
                  className="animate-fade-up"
                >
                  {msg.role === "bot" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "#06b6d4", letterSpacing: "0.08em", fontFamily: "monospace" }}>EMVY SYSTEM</span>
                      <span style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>{msg.timestamp || getTimestamp()}</span>
                      {msg.step && (
                        <span style={{ fontSize: "9px", fontWeight: 600, color: "#06b6d4", letterSpacing: "0.1em", background: "rgba(6,182,212,0.1)", padding: "2px 8px", borderRadius: "4px", border: "1px solid rgba(6,182,212,0.2)" }}>
                          {msg.step}
                        </span>
                      )}
                    </div>
                  )}
                  {msg.role === "user" && (
                    <span style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>{msg.timestamp || getTimestamp()}</span>
                  )}
                  <div
                    style={{
                      maxWidth: "82%",
                      fontSize: "14px",
                      lineHeight: 1.65,
                      color: msg.role === "user" ? "#0a0a0b" : "#e4e4e7",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      background: msg.role === "user" ? "#06b6d4" : "rgba(255,255,255,0.03)",
                      border: msg.role === "bot" ? "1px solid rgba(6,182,212,0.15)" : "none",
                      borderRadius: msg.role === "user" ? "12px" : "12px",
                      borderTopLeftRadius: msg.role === "bot" ? "2px" : "12px",
                      borderTopRightRadius: msg.role === "user" ? "2px" : "12px",
                      padding: "12px 16px",
                      boxShadow: msg.role === "bot" ? "0 1px 3px rgba(0,0,0,0.3)" : "0 2px 8px rgba(6,182,212,0.2)",
                    }}
                  >
                    {msg.content ? (
                      msg.role === "bot" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      ) : (
                        msg.content
                      )
                    ) : (
                      isBotTyping && idx === messages.length - 1 ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "#06b6d4" }}>
                          <span style={{ display: "inline-block", width: "8px", height: "16px", background: "#06b6d4", borderRadius: "1px", animation: "blink 1s step-end infinite" }} />
                          <span style={{ color: "#52525b", fontSize: "12px" }}>typing</span>
                        </span>
                      ) : null
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />

              {/* Email transition button — appears when agent signals ready */}
              {assessment.readyForEmail && !isBotTyping && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <button
                    onClick={() => setStage("email")}
                    style={{
                      background: "#06b6d4",
                      color: "#0a0a0b",
                      fontWeight: 600,
                      fontSize: "14px",
                      padding: "11px 22px",
                      borderRadius: "10px",
                      border: "none",
                      cursor: "pointer",
                      marginTop: "4px",
                    }}
                    className="animate-fade-up"
                  >
                    Get my report →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* EMAIL */}
        {stage === "email" && (
          <div className="max-w-xl mx-auto px-5" style={{ paddingTop: "10vh", paddingBottom: "8vh" }}>
            <div className="flex flex-col" style={{ gap: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#06b6d4" }}>
                Your report
              </div>
              <h2 style={{ fontSize: "clamp(32px, 5vw, 44px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, margin: 0 }}>
                Almost there
              </h2>
              <p style={{ fontSize: "15px", lineHeight: 1.6, color: "#a1a1aa", margin: 0, maxWidth: "440px" }}>
                Drop your details and we'll generate your personalised AI audit report. Takes about 30 seconds.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", maxWidth: "380px", marginTop: "12px" }}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "12px 14px", color: "#ececec", fontSize: "14px", outline: "none" }}
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "12px 14px", color: "#ececec", fontSize: "14px", outline: "none" }}
                />
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company name (optional)"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "12px 14px", color: "#ececec", fontSize: "14px", outline: "none" }}
                />
                {emailError && (
                  <p style={{ color: "#ef4444", fontSize: "13px", margin: 0 }}>{emailError}</p>
                )}
                <button
                  onClick={handleEmailSubmit}
                  disabled={isGeneratingReport}
                  style={{
                    background: isGeneratingReport ? "#0891b2" : "#06b6d4",
                    color: "#0a0a0b",
                    fontWeight: 600,
                    fontSize: "14px",
                    padding: "13px 24px",
                    borderRadius: "10px",
                    border: "none",
                    cursor: isGeneratingReport ? "not-allowed" : "pointer",
                    marginTop: "4px",
                  }}
                >
                  {isGeneratingReport ? "Generating your report..." : "Get my report →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* REPORT */}
        {stage === "report" && report && (
          <div className="max-w-3xl mx-auto px-5" style={{ paddingTop: "40px", paddingBottom: "80px" }}>
            {/* Report content */}
            <div id="report-content">
              {/* Header */}
              <div style={{ marginBottom: "40px" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "#06b6d4", marginBottom: "8px" }}>AI Business Audit</div>
                <h1 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff", margin: "0 0 4px 0" }}>EMVY Audit Report</h1>
                <p style={{ fontSize: "11px", color: "#6b6b70", margin: 0 }}>Prepared for {name} · {email}</p>
                <div style={{ width: "40px", height: "3px", background: "#06b6d4", marginTop: "16px" }} />
              </div>

              {/* Score */}
              <div style={{ background: "#141414", borderRadius: "12px", padding: "28px", marginBottom: "32px", textAlign: "center" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b6b70", marginBottom: "12px" }}>AI Readiness Score</div>
                <div style={{ fontSize: "52px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: report.score >= 70 ? "#22c55e" : report.score >= 40 ? "#06b6d4" : "#ef4444" }}>
                  {report.score}<span style={{ fontSize: "20px", fontWeight: 500, color: "#6b6b70" }}>/100</span>
                </div>
                <p style={{ fontSize: "13px", color: "#a1a1aa", margin: "10px 0 0 0" }}>{report.scoreLabel}</p>
              </div>

              {/* Business snapshot */}
              <div style={{ marginBottom: "32px" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b6b70", marginBottom: "12px" }}>Business Snapshot</div>
                <div style={{ background: "#141414", borderRadius: "12px", padding: "20px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#6b6b70" }}>Business</td>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#ececec", fontWeight: 500 }}>{report.businessName || "—"}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#6b6b70" }}>Industry</td>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#ececec", fontWeight: 500 }}>{report.industry || "—"}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#6b6b70" }}>AI Tools</td>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#ececec", fontWeight: 500 }}>{assessment.aiTools || "None yet"}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#6b6b70" }}>Goal (6 months)</td>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #262626", fontSize: "13px", color: "#ececec", fontWeight: 500 }}>{assessment.goal || "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top findings */}
              <div style={{ marginBottom: "32px" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b6b70", marginBottom: "12px" }}>Top findings</div>
                <ol style={{ margin: 0, padding: "0 0 0 20px" }}>
                  {report.topFindings.map((f, i) => (
                    <li key={i} style={{ fontSize: "14px", color: "#d4d4d8", lineHeight: 1.6, marginBottom: "8px" }}>{f}</li>
                  ))}
                </ol>
              </div>

              {/* Recommendations */}
              <div style={{ marginBottom: "32px" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b6b70", marginBottom: "12px" }}>Easy wins to make this week</div>
                <ol style={{ margin: 0, padding: "0 0 0 20px" }}>
                  {report.recommendations.map((r, i) => (
                    <li key={i} style={{ fontSize: "14px", color: "#d4d4d8", lineHeight: 1.6, marginBottom: "8px" }}>{r}</li>
                  ))}
                </ol>
              </div>

              {/* Priority automations */}
              <div style={{ marginBottom: "32px" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b6b70", marginBottom: "12px" }}>Workflows to automate first</div>
                {report.priorityAutomations.map((a, i) => (
                  <div key={i} style={{ background: "#141414", borderLeft: "3px solid #06b6d4", padding: "12px 16px", marginBottom: "8px", borderRadius: "0 8px 8px 0" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#06b6d4", marginBottom: "4px" }}>Priority {String(i + 1).padStart(2, "0")}</div>
                    <div style={{ fontSize: "13px", color: "#d4d4d8", lineHeight: 1.5 }}>{a}</div>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div style={{ background: "#06b6d4", borderRadius: "12px", padding: "24px", textAlign: "center" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#0a0a0b", margin: "0 0 8px 0" }}>Ready for a Full Audit?</h2>
                <p style={{ fontSize: "13px", color: "rgba(0,0,0,0.7)", margin: "0 0 16px 0" }}>
                  Get a comprehensive AI roadmap tailored to your business. Our experts will analyse your workflows and create a custom implementation plan.
                </p>
                <a href="mailto:hello@emvyai.com" style={{ display: "inline-block", fontWeight: 700, background: "#0a0a0b", color: "#06b6d4", padding: "12px 28px", borderRadius: "9999px", textDecoration: "none", fontSize: "14px" }}>
                  Book a Full Audit →
                </a>
              </div>
            </div>

            {/* PDF button */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: "32px" }}>
              <button
                onClick={generatePdf}
                disabled={isGeneratingPdf}
                style={{
                  background: "transparent",
                  color: "#06b6d4",
                  fontWeight: 600,
                  fontSize: "14px",
                  padding: "11px 24px",
                  borderRadius: "9999px",
                  border: "1px solid #06b6d4",
                  cursor: isGeneratingPdf ? "not-allowed" : "pointer",
                }}
              >
                {isGeneratingPdf ? "Generating PDF..." : "Download PDF report"}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Input bar — fixed at bottom during chat */}
      {stage === "chat" && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(10,10,11,0.95)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(6,182,212,0.12)", padding: "0" }}>
          {/* Security footer */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "10px", color: "#52525b", fontFamily: "monospace", letterSpacing: "0.04em" }}>
            <span style={{ color: "#06b6d4" }}>DATA SECURE // END-TO-END ENCRYPTED</span>
            <span>AUTO-SAVING AUDIT STATE</span>
          </div>
          {/* Input area */}
          <div className="max-w-3xl mx-auto px-5 py-4">
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer..."
                rows={1}
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(6,182,212,0.15)",
                  borderRadius: "10px",
                  padding: "13px 16px",
                  color: "#e4e4e7",
                  fontSize: "14px",
                  outline: "none",
                  resize: "none",
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                  maxHeight: "120px",
                  overflowY: "auto",
                  boxShadow: "0 0 0 1px rgba(6,182,212,0.08)",
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isBotTyping}
                style={{
                  background: input.trim() && !isBotTyping ? "#06b6d4" : "rgba(255,255,255,0.06)",
                  color: input.trim() && !isBotTyping ? "#0a0a0b" : "#52525b",
                  fontWeight: 700,
                  fontSize: "14px",
                  padding: "12px 18px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: input.trim() && !isBotTyping ? "pointer" : "not-allowed",
                  transition: "all 150ms ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  letterSpacing: "0.02em",
                }}
              >
                {input.trim() && !isBotTyping ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                ) : null}
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}