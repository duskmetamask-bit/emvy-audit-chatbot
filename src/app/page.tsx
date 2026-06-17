"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmvyLogo, EmvyWordmark } from "@/components/EmvyLogo";
import { BuildTheater, BuildStage } from "@/components/BuildTheater";
import { RoadmapSection } from "@/components/RoadmapSection";
import { callConvexMutation, callConvexQuery } from "@/lib/convex";
import { TOTAL_QUESTIONS } from "@/lib/agent";
import {
  useAuditStore,
  type Message,
  type Assessment,
  type ReportData,
  type Stage,
} from "@/lib/use-audit-store";

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

const STAGE_PLAN: Array<{ key: string; label: string }> = [
  { key: "mapping_week1", label: "Mapping your week 1 priorities" },
  { key: "drafting_weeks24", label: "Drafting your 30-day plan" },
  { key: "drafting_months23", label: "Mapping your 60–90 day horizon" },
  { key: "writing_summary", label: "Writing your executive summary" },
];

export default function AuditChatbot() {
  // Persistent state — survives page reloads. Backed by localStorage via
  // useSyncExternalStore. The transient `isBotTyping` / `scoreDisplay` /
  // `buildStages` / `input` / `emailError` / `isGeneratingPdf` stay as
  // local useState because persisting them would write to localStorage on
  // every keystroke / RAF tick.
  const { state, patch, clear } = useAuditStore();
  const stage = state.stage;
  const messages = state.messages;
  const assessment = state.assessment;
  const sessionId = state.sessionId;
  const report = state.report;
  const name = state.name;
  const email = state.email;
  const company = state.company;

  const [input, setInput] = useState("");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [buildStages, setBuildStages] = useState<BuildStage[]>(() =>
    STAGE_PLAN.map((s) => ({ key: s.key, label: s.label, status: "pending" as const }))
  );
  const [scoreDisplay, setScoreDisplay] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Mirrors state.chatbotLeadId for synchronous reads inside the
  // SSE `data` handler. On a restore, the ref is primed from the store
  // so the backfill path can target the same :create row.
  const chatbotLeadIdRef = useRef<string | null>(state.chatbotLeadId);
  // Guard: recoverFromBuild must run at most once per page-load, and only
  // on the first hydration where stage is "building". The `[]`-deps
  // useEffect below can't see the client-snapshot stage (useSyncExternalStore
  // commits the server-snapshot first, then re-renders with the localStorage
  // state — a `[]`-deps effect captures the server-snapshot value), so we
  // depend on `state.stage` and use this ref to make the run idempotent.
  const hasRecoveredRef = useRef(false);

  // Refs that always point at the latest committed value. The updater
  // forms below read from these instead of from a `useCallback` closure,
  // which would capture the messages/assessment from the render in which
  // the callback was created — so two `setMessages` calls in the same
  // event handler would both see the same stale `prev`, and the second
  // would clobber the first. (That bug dropped user turns and made the
  // bot bubble appear "blank, no reply.")
  const messagesRef = useRef(messages);
  const assessmentRef = useRef(assessment);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { assessmentRef.current = assessment; }, [assessment]);

  const setMessages = useCallback(
    (next: Message[] | ((prev: Message[]) => Message[])) => {
      patch({ messages: typeof next === "function" ? next(messagesRef.current) : next });
    },
    [patch]
  );
  const setAssessment = useCallback(
    (next: Assessment | ((prev: Assessment) => Assessment)) => {
      patch({ assessment: typeof next === "function" ? next(assessmentRef.current) : next });
    },
    [patch]
  );
  const setStage = useCallback((next: Stage) => patch({ stage: next }), [patch]);
  const setSessionId = useCallback((next: string) => patch({ sessionId: next }), [patch]);
  const setReport = useCallback(
    (next: ReportData | null) => patch({ report: next, completedAt: next ? new Date().toISOString() : null }),
    [patch]
  );
  const setName = useCallback((next: string) => patch({ name: next }), [patch]);
  const setEmail = useCallback((next: string) => patch({ email: next }), [patch]);
  const setCompany = useCallback((next: string) => patch({ company: next }), [patch]);

  // Streams the report SSE. Used by both the email-submit path
  // (handleEmailSubmit, which passes the fresh-messageCount assessment)
  // and the v1.1 reload-recovery path (recoverFromBuild, when the
  // Convex row is still a stub — uses the LLM-set assessment directly).
  // The stream handler (parseSseChunk) is the same in both — it patches
  // `report`, fires :update keyed on chatbotLeadId, and (gated on
  // `!state.reportSent`) sends the Resend email. Throws on transport
  // failure; caller decides the fallback.
  async function sendReportSse(assessmentOverride?: Assessment) {
    const assessmentForSse = assessmentOverride ?? assessment;
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessment: assessmentForSse, name, email, company }),
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
  }

  // v1.1 build-interrupted recovery. Runs once on mount if the
  // persisted stage is `building`. Three branches:
  //   - no chatbotLeadId → :create never landed, fall back to email stage
  //   - row has the real report fields → hydrate + jump (no LLM re-run)
  //   - row is stub OR query failed → re-fire the SSE (re-runs :update + Resend)
  async function recoverFromBuild() {
    console.log("[recoverFromBuild] called, chatbotLeadId=", state.chatbotLeadId);
    if (!state.chatbotLeadId) {
      console.log("[recoverFromBuild] no lead id, patching to email");
      patch({ stage: "email" });
      return;
    }
    try {
      const row = await callConvexQuery<Record<string, unknown>>({
        functionName: "audit_chatbot_leads:get",
        args: { id: state.chatbotLeadId },
      });
      if (row && isReportReady(row)) {
        const r: ReportData = {
          score: typeof row.score === "number" ? row.score : 0,
          scoreLabel: typeof row.scoreLabel === "string" ? row.scoreLabel : "",
          scoreBlurb: typeof row.scoreBlurb === "string" ? row.scoreBlurb : "",
          businessName: typeof row.businessName === "string" ? row.businessName : "",
          industry: typeof row.industry === "string" ? row.industry : "",
          summary: typeof row.summary === "string" ? row.summary : "",
          week1: Array.isArray(row.week1) ? (row.week1 as string[]) : [],
          weeks24: Array.isArray(row.weeks24) ? (row.weeks24 as string[]) : [],
          months23: Array.isArray(row.months23) ? (row.months23 as string[]) : [],
          nextStep: typeof row.nextStep === "string" ? row.nextStep : "",
        };
        patch({ report: r, completedAt: new Date().toISOString() });
        // If the original SSE completed but the email was never attempted
        // (the user reloaded in the narrow window between the SSE `data`
        // event and the Resend fetch), the persisted `reportSent` is
        // false. Patch it BEFORE firing the email so any subsequent
        // reload that hits this branch sees the gate closed and the
        // `reportSent: true` state is the source of truth.
        if (!state.reportSent) {
          patch({ reportSent: true });
          void sendReportEmail(r);
        }
        setStage("report");
        return;
      }
    } catch (err) {
      console.error("Recovery check failed:", err);
    }
    // Stub row or query failed — re-fire. The SSE handler's
    // :update is keyed on chatbotLeadId so it's idempotent against the
    // original :update that may have already run.
    try {
      await sendReportSse();
    } catch (err) {
      console.error("Re-fired report stream error:", err);
      setStage("email");
    }
  }

  // v1.1 build-interrupted recovery. Runs once on the first hydration
  // tick where stage is "building". If the user reloaded mid-build, the
  // BuildTheater is already rendering (the stage === "building" gate in
  // the JSX). recoverFromBuild runs once:
  //   1. if no chatbotLeadId, fall back to email stage (the :create IIFE
  //      from handleEmailSubmit was killed before the response landed)
  //   2. if the Convex row has the real report fields, hydrate state and
  //      jump to the report stage (no LLM re-run, no Resend duplicate)
  //   3. otherwise (stub row or query failed), re-fire the SSE — the SSE
  //      handler re-runs :update + (gated) Resend, same as a fresh submit
  //
  // We depend on `state.stage` (not `[]`) because `useSyncExternalStore`
  // commits the SSR snapshot first (stage: "welcome") and re-renders with
  // the localStorage state on the next tick; a `[]`-deps effect captures
  // the SSR value and never sees the persisted "building". The
  // hasRecoveredRef guard keeps the run once-per-page-load: subsequent
  // in-session transitions into "building" (e.g., the user finishing the
  // email form in this tab) are ignored.
  useEffect(() => {
    console.log("[recovery-effect] fired, stage=", state.stage, "hasRecovered=", hasRecoveredRef.current);
    if (hasRecoveredRef.current) return;
    hasRecoveredRef.current = true;
    if (state.stage === "building") {
      console.log("[recovery-effect] invoking recoverFromBuild");
      void recoverFromBuild();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage]);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isBotTyping]);

  // Auto-focus input on chat stage
  useEffect(() => {
    if (stage === "chat") inputRef.current?.focus();
  }, [stage]);

  // Mint a sessionId on first run if the store doesn't have one yet. The
  // store owns it now (was sessionStorage-only); surviving a reload means
  // the conversation history we send to /api/chat stays coherent.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (state.sessionId) return;
    patch({ sessionId: crypto.randomUUID() });
  }, [patch, state.sessionId]);

  function getTimestamp() {
    return new Date().toTimeString().slice(0, 8);
  }

  const estimatedProgress = Math.min(
    100,
    ((assessment.currentQuestion ?? assessment.categoriesCovered.length) / TOTAL_QUESTIONS) * 100
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
    // Append the user bubble + empty bot placeholder in one write so the
    // store sees them together. (Two separate setMessages calls used to
    // race on the same closure of `messages` and silently drop the user
    // turn — the bug behind "blank, no reply.")
    const userBubble: Message = { role: "user", content: userMsg, timestamp: getTimestamp() };
    const botBubble: Message = { role: "bot", content: "", timestamp: getTimestamp() };
    const baseAfterUser: Message[] = [...messages, userBubble];
    const baseAfterBot: Message[] = [...baseAfterUser, botBubble];
    // Pin the bot bubble's index so the typewriter targets THIS bubble
    // even if the user sends another turn before the animation finishes.
    const botIndex = baseAfterBot.length - 1;
    setMessages(baseAfterBot);
    setInput("");
    setIsBotTyping(true);
    // Send the prior history (without the just-added user message). The
    // /api/chat route appends the new user turn itself.
    const historyForLlm = messages
      .filter((m) => m.role === "user" || m.role === "bot")
      .map((m) => ({ role: m.role === "bot" ? ("assistant" as const) : ("user" as const), content: m.content }));

    // Helper: replace the pinned bot bubble in the freshest message list
    // (read via the updater form, which now reads from messagesRef).
    const updateBotBubble = (content: string) =>
      setMessages((prev) => {
        if (botIndex >= prev.length) return prev;
        const target = prev[botIndex];
        if (!target || target.role !== "bot") return prev;
        const copy = [...prev];
        copy[botIndex] = { ...target, content };
        return copy;
      });

    try {
      const result = await callChatApi(userMsg, assessment, historyForLlm);
      const { message: botText, assessment: updatedAssessment, sessionId: returnedSessionId } = result;
      setAssessment(updatedAssessment);
      if (returnedSessionId && returnedSessionId !== sessionId) {
        setSessionId(returnedSessionId);
        // sessionId now lives in the store (localStorage-backed), so a
        // page reload keeps the same correlation id for the next LLM turn.
      }
      setIsBotTyping(false);
      if (!botText) {
        updateBotBubble("hmm, something broke on my end. try again?");
        return;
      }
      // Typewriter effect
      let i = 0;
      const chunkSize = 3;
      const interval = setInterval(() => {
        i += chunkSize;
        updateBotBubble(botText.slice(0, Math.min(i, botText.length)));
        if (i >= botText.length) clearInterval(interval);
      }, 12);
    } catch {
      setIsBotTyping(false);
      updateBotBubble("connection issue — give it another go.");
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

  // Re-run the score tween whenever a report becomes visible — both on
  // first paint after a restore and after a fresh SSE arrival in the
  // same session. The transient scoreDisplay is 0 on reload, so the
  // restored reveal animates from 0 → score just like a fresh run.
  useEffect(() => {
    if (stage === "report" && report) {
      animateScore(report.score);
    }
  }, [stage, report, animateScore]);

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
    // /pipeline picks it up, writes an activity_log entry, and returns the
    // chatbotLeadId we stash in a ref + the store so :update can target the
    // same row after the report lands.
    //
    // Idempotency: if the user reloaded mid-build (the building→email mount
    // fallback returned them here) and a `:create` already ran on the
    // previous attempt, the persisted `chatbotLeadId` is non-null and we
    // skip the new `:create` — the `:update` backfill after the report
    // lands will patch the existing row.
    const existingLeadId = chatbotLeadIdRef.current ?? state.chatbotLeadId;
    if (!existingLeadId) {
      void (async () => {
        try {
          const result = (await callConvexMutation({
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
          })) as { chatbotLeadId?: string } | null;
          if (result?.chatbotLeadId) {
            chatbotLeadIdRef.current = result.chatbotLeadId;
            patch({ chatbotLeadId: result.chatbotLeadId });
          }
        } catch (err) {
          console.error("Convex lead write failed:", err);
        }
      })();
    }

    // Open the SSE stream. sendReportSse is the shared helper — same one
    // the v1.1 recovery path uses when it has to re-fire because the
    // Convex row is still a stub. The stream handler is unchanged.
    // Pass finalAssessment so the fresh messageCount reaches the LLM.
    try {
      await sendReportSse(finalAssessment);
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
        // The score-tween useEffect ([stage, report]) re-runs animateScore
        // automatically — the manual call here would double-fire.
        // Backfill the full report to Convex so the board pipeline shows the
        // real score + summary + 30/60/90 instead of the "Pending / 0" stub
        // that :create wrote at email-submit time. Fire-and-forget.
        const chatbotLeadId = chatbotLeadIdRef.current ?? state.chatbotLeadId;
        if (chatbotLeadId) {
          void callConvexMutation({
            functionName: "audit_chatbot_leads:update",
            args: {
              id: chatbotLeadId,
              score: r.score,
              scoreLabel: r.scoreLabel,
              scoreBlurb: r.scoreBlurb,
              summary: r.summary,
              week1: r.week1,
              weeks24: r.weeks24,
              months23: r.months23,
              nextStep: r.nextStep,
            },
          }).catch((err) => console.error("Convex report backfill failed:", err));
        } else {
          console.warn("chatbotLeadId not set — :create may have failed; report not backfilled");
        }
        // Fire-and-forget: email the PDF to the lead via Resend. Doesn't
        // block the on-screen reveal; we surface a soft warning if it fails
        // but the user still has the report on screen and the download button.
        //
        // Gated on `reportSent` so a page reload after the report landed
        // doesn't re-email the lead. The flag is set in the same patch
        // call as `setReport` above, so a state where `report !== null &&
        // reportSent === false` is impossible on disk.
        if (!state.reportSent) {
          patch({ reportSent: true });
          void sendReportEmail(r);
        }
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
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {stage !== "welcome" && state.messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clear();
                  window.location.reload();
                }}
                className="label-meta"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
              >
                Start over
              </button>
            )}
            {stage === "chat" && (
              <span className="label-meta" style={{ color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                  Question {Math.min(TOTAL_QUESTIONS, Math.max(0, assessment.currentQuestion ?? 0))} of {TOTAL_QUESTIONS}
                </span>{" "}
                · {assessment.currentCategory ? categoryLabel(assessment.currentCategory) : "starting"}
              </span>
            )}
          </div>
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
        {stage === "welcome" && <WelcomeScreen onStart={() => {
          // Restore gate: if the user reloaded mid-conversation, the
          // persisted state is already at `chat` with messages restored
          // and the header chip already shows progress. We never get
          // here on that path (the `<WelcomeScreen />` only renders
          // when `stage === "welcome"`), but the `state.messages.length`
          // check is a belt-and-braces guard in case the stage value
          // desyncs from the message list (e.g., a future feature
          // that returns to welcome mid-conversation).
          if (state.messages.length > 0) {
            setStage("chat");
            return;
          }
          setStage("chat");
          patch({ startedAt: state.startedAt ?? new Date().toISOString() });
          void sendMessage("Hey, ready when you are.");
        }} />}
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

// Distinguishes a real report row (post-:update) from the stub
// row that :create writes at email-submit time. The stub has
// `scoreLabel: "Pending"` and `week1: []`; the real row has
// either a non-Pending label OR a non-empty week1. The check is
// belt-and-braces: if the SSE completed and :update ran, both
// fields are in their ready form; if the SSE was killed mid-flight,
// both are in their stub form.
function isReportReady(row: Record<string, unknown>): boolean {
  return (
    row.scoreLabel !== "Pending" &&
    Array.isArray(row.week1) &&
    row.week1.length > 0
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
          Answer {TOTAL_QUESTIONS} short questions about how your business runs day to day.
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
  const questionNumber = Math.min(TOTAL_QUESTIONS, Math.max(1, assessment.currentQuestion ?? 0));
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

        {(assessment.readyForEmail || (assessment.currentQuestion ?? 0) >= TOTAL_QUESTIONS) && !isBotTyping && (
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
              Question {questionNumber} of {TOTAL_QUESTIONS} · {currentCategory}
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
