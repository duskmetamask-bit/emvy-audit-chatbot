"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmvyWordmark } from "@/components/EmvyLogo";
import { BuildTheater, BuildStage } from "@/components/BuildTheater";
import { ChecklistSection } from "@/components/ChecklistSection";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { callConvexMutation, callConvexQuery } from "@/lib/convex";
import { TOTAL_QUESTIONS } from "@/lib/agent";
import {
  useAuditStore,
  type Message,
  type Assessment,
  type ReportData,
  type Stage,
} from "@/lib/use-audit-store";

const BOOKING_URL = "https://cal.com/jake-emvy/discovery-call";

// v3 build theater: matches STAGE_PLAN in @/lib/agent.ts. Keep these in
// sync — keys are the SSE `stage` values the route emits, labels are the
// user-visible build theater copy. v3 adds a "Mapping your automation
// areas" stage between opportunities and the checklist.
const STAGE_PLAN: Array<{ key: string; label: string }> = [
  { key: "reading_answers", label: "Reading your answers" },
  { key: "spotting_opportunities", label: "Spotting the 3 opportunities" },
  { key: "mapping_automation_areas", label: "Mapping your automation areas" },
  { key: "mapping_quickwin_30", label: "Mapping your quick win + 30-day checklist" },
  { key: "writing_summary", label: "Writing your summary" },
];

export default function AuditChatbot() {
  // Persistent state — survives page reloads. Backed by localStorage via
  // useSyncExternalStore. The transient `isBotTyping` / `input` /
  // `isGeneratingPdf` stay as local useState because persisting them would
  // write to localStorage on every keystroke / RAF tick.
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
  const [buildStages, setBuildStages] = useState<BuildStage[]>(() =>
    STAGE_PLAN.map((s) => ({ key: s.key, label: s.label, status: "pending" as const }))
  );

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
  //   - no chatbotLeadId → :create never landed (wizard submit died),
  //     fall back to onboarding so the user can re-enter details
  //   - row has the real report fields → hydrate + jump (no LLM re-run)
  //   - row is stub OR query failed → re-fire the SSE (re-runs :update + Resend)
  async function recoverFromBuild() {
    console.log("[recoverFromBuild] called, chatbotLeadId=", state.chatbotLeadId);
    if (!state.chatbotLeadId) {
      console.log("[recoverFromBuild] no lead id, patching to onboarding");
      patch({ stage: "onboarding" });
      return;
    }
    try {
      const row = await callConvexQuery({
        functionName: "audit_chatbot_leads:get",
        args: { id: state.chatbotLeadId },
      });
      if (row && isReportReady(row)) {
        const r: ReportData = {
          businessName: typeof row.businessName === "string" ? row.businessName : "",
          industry: typeof row.industry === "string" ? row.industry : "",
          summary: typeof row.summary === "string" ? row.summary : "",
          opportunities: Array.isArray(row.opportunities)
            ? (row.opportunities as ReportData["opportunities"])
            : [],
          automationAreas: Array.isArray(row.automationAreas)
            ? (row.automationAreas as ReportData["automationAreas"])
            : [],
          quickWin: typeof row.quickWin === "string" ? row.quickWin : "",
          checklist: Array.isArray(row.checklist)
            ? (row.checklist as ReportData["checklist"])
            : [],
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
      setStage("chat");
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

  // Question-counter progress. The LLM tracks `currentQuestion` (1-10);
  // a follow-up turn keeps the same number, so the bar reflects the
  // spine position, not message count.
  const estimatedProgress = Math.min(
    100,
    ((assessment.currentQuestion ?? 0) / TOTAL_QUESTIONS) * 100
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

  // Fired by OnboardingWizard when the user finishes step 2. Mints the
  // Convex `audit_chatbot_leads` row (fire-and-forget), pre-fills
  // `assessment.businessName` from the captured company name (so the LLM
  // already has it on the first turn), then transitions to the chat and
  // seeds the bot's opening message.
  async function handleWizardComplete() {
    if (!name.trim() || !email.trim()) return;

    // Pre-fill businessName from the wizard's company field. The agent
    // system prompt already pulls `businessName` from the running
    // assessment, so the bot's first turn can address the business by
    // name when it kicks in.
    if (company.trim() && !assessment.businessName) {
      patch({
        assessment: { ...assessment, businessName: company.trim() },
      });
    }

    // Create the Convex row BEFORE entering chat so chatbotLeadIdRef is
    // guaranteed to be set when the SSE backfill fires later.
    try {
      const result = await callConvexMutation({
        functionName: "audit_chatbot_leads:create",
        args: {
          name,
          email,
          company: company || undefined,
          businessName: assessment.businessName || company || undefined,
          industry: assessment.industry || undefined,
          teamSize: assessment.teamSize || undefined,
          findings: assessment.findings,
          painPoints: assessment.painPoints,
          manualTasks: assessment.manualTasks,
          aiTools: assessment.aiTools || undefined,
          goal: assessment.goal || undefined,
        },
      });
      if (result?.chatbotLeadId) {
        chatbotLeadIdRef.current = result.chatbotLeadId;
        patch({ chatbotLeadId: result.chatbotLeadId });
      }
    } catch (err) {
      console.error("Convex lead write failed:", err);
    }

    setStage("chat");

    // Seed the bot's opening turn. The wizard already greeted the user
    // visually, so the assistant's first reply is the standard opener
    // (or a personalised version if we have a name on file). It must
    // land as a BOT bubble — going through `sendMessage` would render
    // it as a user-typed message, which reads as the user greeting
    // themselves.
    const opener = name.trim()
      ? `Hey ${name.trim().split(/\s+/)[0]}, ready when you are.`
      : "Hey, ready when you are.";
    patch({
      startedAt: state.startedAt ?? new Date().toISOString(),
      messages: [
        ...messages,
        { role: "bot", content: opener, timestamp: getTimestamp() },
      ],
    });
  }

  // Fired by the "Get my report" button on the chat's last turn. The
  // lead row already exists (the wizard minted it), so we skip :create
  // and just open the SSE stream. The stream handler still runs :update
  // keyed on chatbotLeadId so the report backfills the same row.
  async function handleWrapUp() {
    setStage("building");
    setBuildStages(STAGE_PLAN.map((s) => ({ key: s.key, label: s.label, status: "pending" as const })));

    const finalAssessment: Assessment = {
      ...assessment,
      messageCount: messages.filter((m) => m.role === "user").length,
    };

    try {
      await sendReportSse(finalAssessment);
    } catch (err) {
      console.error("Report stream error:", err);
      setStage("chat");
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

        // Backfill the full report + assessment to Convex so the board
        // pipeline shows the real data. Fire-and-forget — we don't block
        // the on-screen reveal on this succeeding.
        const tryBackfill = (leadId: string | null) => {
          if (!leadId) {
            // chatbotLeadId not available yet. Schedule a retry in case
            // the :create response is still in-flight (shouldn't happen
            // now that handleWizardComplete awaits :create, but keep the
            // safety net).
            setTimeout(() => tryBackfill(chatbotLeadIdRef.current), 500);
            return;
          }
          const latest = assessmentRef.current;
          void callConvexMutation({
            functionName: "audit_chatbot_leads:update",
            args: {
              id: leadId,
              summary: r.summary,
              opportunities: r.opportunities,
              automationAreas: r.automationAreas,
              quickWin: r.quickWin,
              nextStep: r.nextStep,
              findings: latest.findings.length > 0 ? latest.findings : undefined,
              painPoints: latest.painPoints.length > 0 ? latest.painPoints : undefined,
              manualTasks: latest.manualTasks.length > 0 ? latest.manualTasks : undefined,
              industry: latest.industry || undefined,
              teamSize: latest.teamSize || undefined,
              aiTools: latest.aiTools || undefined,
              goal: latest.goal || undefined,
            },
          }).catch((err: unknown) => console.error("Convex report backfill failed:", err));
        };
        tryBackfill(chatbotLeadIdRef.current);
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
      a.download = `emvy-strategy-${(report.businessName || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
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
            aria-label="EMVY"
          >
            <EmvyWordmark className="brand-wordmark-responsive" />
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
        <div
          key={stage}
          className="animate-fade-up"
          style={{
            minHeight: "calc(100dvh - 72px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
        {stage === "welcome" && <WelcomeScreen onStart={() => {
          // Start my strategy → wizard. Lead info is captured upfront
          // (name/email/company) instead of in an end-of-chat form.
          // We never set `startedAt` here any more — that stamp lands
          // when the wizard finishes and the chat actually begins.
          setStage("onboarding");
        }} />}
        {stage === "onboarding" && (
          <OnboardingWizard
            name={name}
            email={email}
            company={company}
            setName={setName}
            setEmail={setEmail}
            setCompany={setCompany}
            onComplete={handleWizardComplete}
          />
        )}
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
            onWrap={handleWrapUp}
            chatEndRef={chatEndRef}
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
            isGeneratingPdf={isGeneratingPdf}
            onDownload={generatePdf}
          />
        )}
        </div>
      </main>
    </div>
  );
}

// Distinguishes a real report row (post-:update) from the stub
// row that :create writes at email-submit time. The stub has
// `opportunities: []`; the real row has 3.
function isReportReady(row: Record<string, unknown>): boolean {
  return Array.isArray(row.opportunities) && row.opportunities.length > 0;
}

/* ─── Welcome / Hero ─────────────────────────────────────────────────────────── */

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: 1180,
        padding: "clamp(20px, 4vh, 48px) 24px 56px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
        gap: "clamp(32px, 5vw, 72px)",
        alignItems: "center",
        position: "relative",
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

      {/* Decorative ambient glow behind the hero — calm, no motion */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -120,
          left: -120,
          width: 480,
          height: 480,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(0,229,255,0.10) 0%, rgba(0,229,255,0.00) 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 80,
          right: -160,
          width: 360,
          height: 360,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(0,229,255,0.06) 0%, rgba(0,229,255,0.00) 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 40ms forwards",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 24,
              height: 2,
              background: "var(--accent)",
              borderRadius: 2,
            }}
          />
          <span className="label-eyebrow-accent" style={{ fontSize: 13 }}>
            Mini AI Strategy
          </span>
        </div>

        <h1
          style={{
            fontSize: "clamp(36px, 5.2vw, 56px)",
            fontWeight: 500,
            letterSpacing: "-0.04em",
            lineHeight: 1.04,
            margin: 0,
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 120ms forwards",
          }}
        >
          A Free <span style={{ color: "var(--accent)" }}>AI Strategy Assessment</span> for your business
        </h1>

        <ul
          style={{
            fontSize: 15.5,
            lineHeight: 1.55,
            color: "var(--text-secondary)",
            maxWidth: 480,
            margin: 0,
            paddingLeft: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 220ms forwards",
          }}
        >
          <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span aria-hidden="true" style={{ marginTop: 9, width: 5, height: 5, borderRadius: 3, background: "var(--accent)", flexShrink: 0 }} />
            <span>Answer a few short questions about how your business runs day to day</span>
          </li>
          <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span aria-hidden="true" style={{ marginTop: 9, width: 5, height: 5, borderRadius: 3, background: "var(--accent)", flexShrink: 0 }} />
            <span>Around 5 minutes, give or take</span>
          </li>
          <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span aria-hidden="true" style={{ marginTop: 9, width: 5, height: 5, borderRadius: 3, background: "var(--accent)", flexShrink: 0 }} />
            <span>Walk away with a personalised 30-day checklist you can ship this week</span>
          </li>
        </ul>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 28,
            marginTop: 8,
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 320ms forwards",
          }}
        >
          <button onClick={onStart} className="btn-primary" style={{ padding: "14px 26px", fontSize: 15 }}>
            Start my strategy
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              paddingTop: 16,
              borderTop: "1px solid var(--border-subtle)",
              width: "100%",
              maxWidth: 480,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              <span className="label-eyebrow" style={{ color: "var(--text-muted)" }}>
                Want the full strategy?
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                A 30-minute mapping call with Jake — we walk through your business together.
              </span>
            </div>
            <a
              href="https://cal.com/jake-emvy/ai-strategy"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}
            >
              AI Strategy Call
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      <div className="hero-preview" style={{ display: "flex", flexDirection: "column", gap: 14, position: "relative", zIndex: 1 }}>
        <PreviewCard
          eyebrow="YOUR STRATEGY"
          title="A 2-3 sentence read on your business"
          items={["Direction, not diagnosis", "Names the highest-leverage move", "Specific to your answers"]}
          delayMs={420}
        />
        <PreviewCard
          eyebrow="WHERE AI HELPS"
          title="3 opportunities, ranked by impact"
          items={["Each with what it is and why it matters", "What changes when it works", "How fast you see a result"]}
          delayMs={540}
          offset
        />
        <PreviewCard
          eyebrow="QUICK WIN"
          title="One thing to do this week"
          items={["No tools, just one move", "Based on what you said is broken", "Ship it Monday"]}
          delayMs={660}
        />
        <PreviewCard
          eyebrow="30-DAY CHECKLIST"
          title="The actions to ship in the next month"
          items={["Each action names a specific tool", "Cites what you said is broken", "Quantifies the outcome"]}
          delayMs={780}
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
        transition: "transform var(--motion-base) var(--ease-out)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(135deg, transparent 0%, rgba(0, 229, 255, 0.04) 100%)",
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
                style={{
                  color: i >= 2 ? "var(--text-muted)" : "var(--accent)",
                  minWidth: 18,
                  paddingTop: 1,
                  fontWeight: i >= 2 ? 400 : 500,
                  transition: "color var(--motion-base) var(--ease-out)",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                style={{
                  filter: i >= 2 ? "blur(2.5px)" : "none",
                  opacity: i >= 2 ? 0.55 : 1,
                  transition: "filter var(--motion-base) var(--ease-out), opacity var(--motion-base) var(--ease-out)",
                  userSelect: i >= 2 ? "none" : "auto",
                }}
              >
                {it}
              </span>
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
  onWrap,
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
  onWrap: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: 720,
        padding: "clamp(24px, 4vw, 48px) 24px 200px",
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100dvh - 80px)",
        position: "relative",
      }}
    >
      {/* Ambient cyan glow behind the conversation — mirrors the welcome's
       * atmosphere so the chat doesn't float in a void. Centered above the
       * first bot bubble so it reads as "the room is lit", not "blob in the
       * corner". */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 40,
          left: "50%",
          transform: "translateX(-50%)",
          width: 640,
          height: 640,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(0,229,255,0.07) 0%, rgba(0,229,255,0.00) 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: "auto" }}>
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
            <button onClick={onWrap} className="btn-primary">
              Get my report
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
            maxWidth: 720,
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
              justifyContent: "center",
              padding: "0 4px",
              gap: 8,
            }}
          >
            <span>Your answers stay private</span>
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
        <span
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginLeft: 14,
            marginBottom: -2,
            opacity: 0.85,
          }}
        >
          EMVY
        </span>
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
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 0",
            }}
            aria-label="Assistant is thinking"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: "var(--accent)",
                  animation: "pulseDot 1.4s ease-in-out infinite",
                  animationDelay: `${i * 160}ms`,
                }}
              />
            ))}
            <span
              className="label-meta"
              style={{ color: "var(--text-muted)", marginLeft: 8 }}
            >
              thinking
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Report Stage ───────────────────────────────────────────────────────────── */

function ReportStage({
  report,
  name,
  email,
  isGeneratingPdf,
  onDownload,
}: {
  report: ReportData;
  name: string;
  email: string;
  isGeneratingPdf: boolean;
  onDownload: () => void;
}) {
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
          gap: 20,
          marginBottom: 48,
          position: "relative",
        }}
      >
        {/* Subtle cyan dot-grid accent — decorative only, hidden from a11y */}
        <svg
          aria-hidden="true"
          width="220"
          height="80"
          viewBox="0 0 220 80"
          style={{
            position: "absolute",
            top: -16,
            right: -8,
            opacity: 0.45,
            pointerEvents: "none",
          }}
        >
          {Array.from({ length: 5 }).map((_, row) =>
            Array.from({ length: 12 }).map((_, col) => (
              <circle
                key={`${row}-${col}`}
                cx={10 + col * 18}
                cy={10 + row * 14}
                r={1.2}
                fill="var(--accent)"
              />
            ))
          )}
        </svg>

        {/* Wordmark removed 2026-06-27 — flex-stretch artifact on the cover.
            The parent flex column's align-items: stretch overrode width: auto
            and stretched the img horizontally across the full report width.
            The dot-grid SVG above + the report headline below carry the
            EMVY identity. Header wordmark (line ~618) is unaffected — it
            uses .brand-wordmark-responsive which constrains the height. */}
        <h1
          style={{
            fontSize: "clamp(32px, 4.4vw, 46px)",
            fontWeight: 600,
            letterSpacing: "-0.032em",
            lineHeight: 1.04,
            margin: 0,
            color: "var(--foreground)",
          }}
        >
          {report.businessName}{" "}
          <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
            — 30-day checklist
          </span>
        </h1>
        <p className="label-meta">
          Prepared for {name} · {email}
        </p>
        {email && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 16px",
              borderRadius: 999,
              background:
                "linear-gradient(180deg, var(--accent-dim) 0%, rgba(0,229,255,0.04) 100%)",
              border: "1px solid var(--border-accent)",
              color: "var(--accent)",
              fontSize: 13,
              fontWeight: 500,
              marginTop: 6,
              alignSelf: "flex-start",
              boxShadow: "0 4px 16px rgba(0, 229, 255, 0.10)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 7l3.5 3.5L12 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            We&apos;ve emailed this report to {email}
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            width: 56,
            height: 2,
            background:
              "linear-gradient(90deg, var(--accent) 0%, rgba(0,229,255,0.0) 100%)",
            borderRadius: 2,
          }}
        />
      </header>

      {/* Summary card */}
      <section
        className="card-elevated"
        style={{
          padding: "clamp(20px, 3vw, 28px)",
          marginBottom: 24,
          opacity: 0,
          animation: "fadeUp var(--motion-slow) var(--ease-out) 60ms forwards",
        }}
      >
        <div
          className="label-eyebrow-accent"
          style={{ marginBottom: 10 }}
        >
          Executive summary
        </div>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: "var(--foreground)",
            margin: 0,
          }}
        >
          {report.summary}
        </p>
      </section>

      {/* 3 Opportunities — Where AI Can Help Your Business */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        <div className="label-eyebrow-accent" style={{ marginBottom: 4 }}>
          Where AI can help your business
        </div>
        {report.opportunities.map((o, i) => (
          <OpportunityCard key={`o${i}`} opportunity={o} index={i} />
        ))}
      </div>

      {/* Quick Win */}
      {report.automationAreas.length > 0 && (
        <AutomationAreasSection items={report.automationAreas} />
      )}

      {/* Quick Win */}
      {report.quickWin && <QuickWinCallout quickWin={report.quickWin} />}

      {/* 30-Day Checklist — flat list of verb-first actions */}
      <ChecklistSection items={report.checklist} />

      {/* Closer — What to do next (LLM's nextStep) */}
      {report.nextStep && (
        <section
          style={{
            position: "relative",
            padding: "clamp(28px, 4vw, 40px)",
            textAlign: "center",
            background:
              "linear-gradient(180deg, rgba(0,229,255,0.06) 0%, rgba(0,229,255,0.02) 100%)",
            border: "1px solid var(--border-accent)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0, 229, 255, 0.10)",
            opacity: 0,
            animation: "fadeUp var(--motion-slow) var(--ease-out) 500ms forwards",
          }}
        >
          <div className="label-eyebrow-accent" style={{ marginBottom: 12 }}>
            What to do next
          </div>
          <p
            style={{
              color: "var(--foreground)",
              fontSize: 18,
              lineHeight: 1.55,
              margin: "0 auto 24px",
              maxWidth: 540,
              fontWeight: 500,
              letterSpacing: "-0.005em",
            }}
          >
            {report.nextStep}
          </p>
          <a
            href={BOOKING_URL}
            className="btn-primary"
            style={{ textDecoration: "none", padding: "14px 26px", fontSize: 15 }}
          >
            Book a free 15-min discovery call
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <p
            className="label-meta"
            style={{ marginTop: 18, color: "var(--text-muted)" }}
          >
            No pitch deck. No pressure. Just a focused 15 minutes.
          </p>
        </section>
      )}

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

/* ─── Report sub-components ────────────────────────────────────────────────── */

// One card per opportunity. Title + 4 labeled rows (What it is / Why it
// matters / What changes / How fast). Stacked full-width on screen.
function OpportunityCard({
  opportunity,
  index,
}: {
  opportunity: ReportData["opportunities"][number];
  index: number;
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "What it is", value: opportunity.whatItIs },
    { label: "Why it matters", value: opportunity.whyMatters },
    { label: "What changes", value: opportunity.whatChanges },
    { label: "How fast", value: opportunity.howFast },
  ];
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "clamp(22px, 3vw, 30px)",
        position: "relative",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm), var(--shadow-inset)",
        opacity: 0,
        animation: `fadeUp var(--motion-slow) var(--ease-out) ${120 + index * 80}ms forwards`,
      }}
    >
      {/* Decorative left accent strip — only the corner pip is visible */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background:
            "linear-gradient(180deg, var(--accent) 0%, rgba(0,229,255,0.0) 70%)",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: 3,
            background: "var(--accent)",
            boxShadow: "0 0 0 4px var(--accent-dim)",
          }}
        />
        <span className="label-eyebrow-accent">Opportunity 0{index + 1}</span>
      </div>
      <h3
        style={{
          fontSize: "clamp(20px, 2.6vw, 25px)",
          fontWeight: 600,
          letterSpacing: "-0.022em",
          margin: 0,
          marginBottom: 16,
          lineHeight: 1.18,
        }}
      >
        {opportunity.title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 14,
              alignItems: "baseline",
              paddingTop: 12,
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className="label-eyebrow"
              style={{ color: "var(--text-muted)" }}
            >
              {r.label}
            </div>
            <div
              style={{
                fontSize: 14.5,
                lineHeight: 1.6,
                color: "var(--foreground)",
              }}
            >
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Automation Areas — workflow map. Each item is a single string in the
// shape "Area name — one-line description". We split on the first
// em-dash so the area name renders as a bold lead and the description
// flows after. Falls back to plain rendering if no dash is found.
function AutomationAreasSection({ items }: { items: string[] }) {
  return (
    <section
      style={{
        position: "relative",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "clamp(22px, 3vw, 30px)",
        marginBottom: 32,
        overflow: "hidden",
        boxShadow: "var(--shadow-sm), var(--shadow-inset)",
        opacity: 0,
        animation: "fadeUp var(--motion-slow) var(--ease-out) 280ms forwards",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: 3,
            background: "var(--accent)",
            boxShadow: "0 0 0 4px var(--accent-dim)",
          }}
        />
        <span className="label-eyebrow-accent">Areas to automate</span>
      </div>
      <h3
        style={{
          fontSize: "clamp(20px, 2.6vw, 25px)",
          fontWeight: 600,
          letterSpacing: "-0.022em",
          margin: 0,
          marginBottom: 18,
          lineHeight: 1.18,
        }}
      >
        AI automation workflow map
      </h3>
      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {items.map((raw, i) => {
          // Split on the first em-dash so the area name is the lead and
          // the description follows. Some items may use a hyphen instead;
          // try em-dash, then " - " (space-hyphen-space), then leave as-is.
          const emIdx = raw.indexOf("—");
          const hyIdx = raw.indexOf(" - ");
          const splitIdx =
            emIdx >= 0 ? emIdx : hyIdx >= 0 ? hyIdx : -1;
          const lead =
            splitIdx >= 0 ? raw.slice(0, splitIdx).trim() : "";
          const rest =
            splitIdx >= 0 ? raw.slice(splitIdx + (emIdx >= 0 ? 1 : 3)).trim() : raw;
          return (
            <li
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr",
                gap: 12,
                alignItems: "baseline",
                padding: "14px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
              }}
            >
              <span
                className="label-eyebrow-accent"
                style={{ fontSize: 11, letterSpacing: "0.06em" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.6,
                  color: "var(--foreground)",
                }}
              >
                {lead && (
                  <span style={{ fontWeight: 600, color: "var(--foreground)" }}>
                    {lead}
                  </span>
                )}
                {lead && rest && (
                  <span style={{ color: "var(--text-muted)", margin: "0 6px" }}>—</span>
                )}
                <span style={{ color: lead ? "var(--text-secondary)" : "var(--foreground)" }}>
                  {rest}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Highlighted callout for the one thing to ship this week. Sits between
// the opportunities and the 90-day plan.
function QuickWinCallout({ quickWin }: { quickWin: string }) {
  return (
    <section
      style={{
        position: "relative",
        padding: "clamp(22px, 3vw, 30px)",
        background:
          "linear-gradient(135deg, var(--accent-dim) 0%, rgba(0,229,255,0.02) 100%)",
        border: "1px solid var(--border-accent)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--radius-lg)",
        marginBottom: 32,
        boxShadow: "0 6px 24px rgba(0, 229, 255, 0.10)",
        opacity: 0,
        animation: "fadeUp var(--motion-slow) var(--ease-out) 360ms forwards",
        overflow: "hidden",
      }}
    >
      <div className="label-eyebrow-accent" style={{ marginBottom: 12 }}>
        Your quick win — this week
      </div>
      <p
        style={{
          fontSize: 17.5,
          lineHeight: 1.55,
          color: "var(--foreground)",
          margin: 0,
          fontWeight: 500,
          letterSpacing: "-0.005em",
        }}
      >
        {quickWin}
      </p>
    </section>
  );
}
