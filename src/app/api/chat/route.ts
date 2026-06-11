// /api/chat — direct LLM call using the audit system prompt. The frontend
// tracks the running assessment in client state and sends it (plus the
// conversation history) on every turn. We assemble the prompt, call the
// LLM, and return the parsed response.

import { NextRequest } from "next/server";
import { AUDIT_SYSTEM_PROMPT, emptyAssessment, Assessment, Finding } from "@/lib/agent";
import { chatCompletion, ChatMessage } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  sessionId?: string;
  message: string;
  assessment?: Assessment;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface AgentResponse {
  message: string;
  assessment: Assessment;
  toolResults: Array<{ tool: string; result: { success: boolean; data?: unknown; error?: string } }>;
  done: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Parse the LLM's JSON blob. System prompt says the LLM returns
// camelCase keys — we honour that.
function extractAssessmentUpdate(raw: string, current: Assessment): Partial<Assessment> {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return {};

  // Try the whole substring first; fall back to slicing between braces.
  const candidates = [raw, raw.slice(firstBrace, lastBrace + 1)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") continue;
      const a = parsed.assessment ?? parsed; // tolerate either shape
      if (!a || typeof a !== "object") continue;

      const update: Partial<Assessment> = {};

      const s = (k: string) => (a as Record<string, unknown>)[k];
      if (typeof s("businessName") === "string") update.businessName = s("businessName") as string;
      if (typeof s("businessDescription") === "string") update.businessDescription = s("businessDescription") as string;
      if (typeof s("teamSize") === "string") update.teamSize = s("teamSize") as string;
      if (typeof s("industry") === "string") update.industry = s("industry") as string;
      if (typeof s("aiTools") === "string") update.aiTools = s("aiTools") as string;
      if (typeof s("budget") === "string") update.budget = s("budget") as string;
      if (typeof s("goal") === "string") update.goal = s("goal") as string;
      if (typeof s("obstacles") === "string") update.obstacles = s("obstacles") as string;
      if (typeof s("readyForEmail") === "boolean") update.readyForEmail = s("readyForEmail") as boolean;

      if (Array.isArray(s("painPoints"))) {
        update.painPoints = (s("painPoints") as unknown[]).filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0
        );
      }
      if (Array.isArray(s("manualTasks"))) {
        update.manualTasks = (s("manualTasks") as unknown[]).filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0
        );
      }
      if (Array.isArray(s("findings"))) {
        update.findings = (s("findings") as Array<{ category?: string; text?: unknown; severity?: string }>).map(
          (f) => ({
            category: (f.category || "ops") as Finding["category"],
            text: String(f.text || ""),
            severity: (["high", "medium", "low"] as const).includes(f.severity as "high" | "medium" | "low")
              ? (f.severity as Finding["severity"])
              : "medium",
          })
        );
      }
      if (s("scores") && typeof s("scores") === "object") {
        const merged: Record<string, number> = { ...current.scores };
        for (const [k, v] of Object.entries(s("scores") as Record<string, unknown>)) {
          const n = Number(v);
          if (!Number.isNaN(n) && n >= 1 && n <= 5) merged[k] = Math.round(n);
        }
        update.scores = merged;
      }
      if (Array.isArray(s("categoriesCovered"))) {
        update.categoriesCovered = (s("categoriesCovered") as unknown[]).filter(
          (x): x is string => typeof x === "string"
        ) as Assessment["categoriesCovered"];
      }

      // The LLM may include a `message` field on the outer blob — we ignore it
      // and use the raw text instead (the raw text *is* the message, with the
      // JSON blob embedded).
      if (Object.keys(update).length > 0) return update;
    } catch {
      // try next candidate
    }
  }
  return {};
}

function extractMessageText(raw: string, parsedMessage: unknown): string {
  if (typeof parsedMessage === "string" && parsedMessage.trim().length > 0) {
    return parsedMessage.trim();
  }
  // Strip the JSON blob from the raw text — the conversational reply is
  // usually before or after the JSON, in plain text.
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1) return raw.trim();
  if (firstBrace > 0) return raw.slice(0, firstBrace).trim();
  if (lastBrace !== -1 && lastBrace < raw.length - 1) return raw.slice(lastBrace + 1).trim();
  return raw.trim();
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : crypto.randomUUID();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const assessment: Assessment =
    body.assessment && typeof body.assessment === "object" ? { ...emptyAssessment(), ...body.assessment } : emptyAssessment();
  const history = Array.isArray(body.messages) ? body.messages : [];

  if (!message) {
    return json({ error: "Empty message" }, 400);
  }

  const agentMessages: ChatMessage[] = [
    { role: "system", content: AUDIT_SYSTEM_PROMPT },
    {
      role: "system",
      content:
        "CURRENT_RUNNING_ASSESSMENT (update this in every response):\n" + JSON.stringify(assessment, null, 2),
    },
  ];

  for (const m of history) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content !== "string") continue;
    agentMessages.push({ role: m.role, content: m.content });
  }
  agentMessages.push({ role: "user", content: message });

  try {
    const response = await chatCompletion({
      messages: agentMessages,
      temperature: 0.7,
      maxTokens: 1024,
    });

    const raw = response.choices?.[0]?.message?.content || "";
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");

    let parsedMessage: unknown = undefined;
    let update: Partial<Assessment> = {};
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          parsedMessage = parsed.message;
          const inner = (parsed.assessment && typeof parsed.assessment === "object" ? parsed.assessment : parsed) as Record<string, unknown>;
          const syntheticRaw = JSON.stringify({ assessment: inner });
          update = extractAssessmentUpdate(syntheticRaw, assessment);
        }
      } catch {
        // fall through — treat raw as message
      }
    }

    const replyText = extractMessageText(raw, parsedMessage) || "hmm, can you say that again?";

    const next: Assessment = {
      ...assessment,
      ...update,
      messageCount: history.filter((m) => m.role === "user").length + 1,
    };

    const result: AgentResponse = {
      message: replyText,
      assessment: next,
      toolResults: [],
      done: true,
    };

    return json({ ...result, sessionId }, 200);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/chat] LLM error:", errMsg);
    return json(
      {
        error: "LLM failed: " + errMsg,
        message: "hmm, something broke on my end. try again?",
        assessment,
        sessionId,
      },
      500
    );
  }
}
