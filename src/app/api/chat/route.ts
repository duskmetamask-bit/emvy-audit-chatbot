// /api/chat — direct LLM call using the audit system prompt. The frontend
// tracks the running assessment in client state and sends it (plus the
// conversation history) on every turn. We assemble the prompt, call the
// LLM, and parse the response with the testable chat-parse module.

import { NextRequest } from "next/server";
import { AUDIT_SYSTEM_PROMPT, emptyAssessment, Assessment } from "@/lib/agent";
import { chatCompletion, ChatMessage } from "@/lib/llm";
import { parseChatResponse } from "@/lib/chat-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  sessionId?: string;
  message: string;
  assessment?: Assessment;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
        "CURRENT_RUNNING_ASSESSMENT (update this in every response, set currentQuestion to the number of the question you just asked):\n" +
        JSON.stringify(assessment, null, 2),
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
    if (process.env.DEBUG_CHAT === "1") {
      console.log("[/api/chat] raw LLM response:", raw);
    }
    const parsed = parseChatResponse(raw, assessment);

    const userTurns = history.filter((m) => m.role === "user").length + 1;

    if (!parsed) {
      // Fallback: the LLM returned nothing parseable. Surface a clean
      // apologetic reply and keep the running assessment intact.
      return json(
        {
          message: "hmm, can you rephrase that?",
          assessment: { ...assessment, messageCount: userTurns },
          toolResults: [],
          done: true,
          sessionId,
        },
        200
      );
    }

    const next: Assessment = {
      ...assessment,
      ...parsed.assessmentUpdate,
      // If the parser couldn't extract a currentQuestion (because the LLM
      // emitted a think block + plain text without a JSON envelope), bump
      // the question counter when the message looks like a question.
      currentQuestion:
        parsed.currentQuestion ??
        (parsed.message.trim().endsWith("?")
          ? Math.min(13, (assessment.currentQuestion ?? 0) + 1)
          : assessment.currentQuestion),
      currentCategory: parsed.currentCategory ?? assessment.currentCategory,
      messageCount: userTurns,
    };

    return json(
      {
        message: parsed.message || "hmm, can you rephrase that?",
        assessment: next,
        toolResults: [],
        done: true,
        sessionId,
      },
      200
    );
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
