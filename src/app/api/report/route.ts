// /api/report — generates the personalised 30/60/90 day AI roadmap as a
// Server-Sent Events stream. The frontend listens for `status` events
// (build theater) and a final `data` event with the parsed ReportData JSON.
//
// Why SSE: the audit report is the climax of the flow. Streaming lets us
// show "Building your roadmap..." stages in real-time, then fade the
// final report in as the data lands. Beats a static spinner.

import { NextRequest } from "next/server";
import { REPORT_SYSTEM_PROMPT, STAGE_PLAN, Assessment, emptyAssessment } from "@/lib/agent";
import { chatCompletionStream, ChatMessage } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReportRequestBody {
  assessment: Assessment;
  name: string;
  email: string;
  company?: string;
}

interface RoadmapData {
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

function stripCodeFences(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return out;
}

function deriveFallbackRoadmap(assessment: Assessment, lead: ReportRequestBody): RoadmapData {
  const scores = Object.values(assessment.scores || {});
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 3;
  const score = Math.round(avg * 20);
  const scoreLabel = score >= 70 ? "High readiness" : score >= 40 ? "Moderate readiness" : "Early stage";
  return {
    score,
    scoreLabel,
    scoreBlurb:
      score >= 70
        ? "Well positioned for AI adoption across the operations we covered."
        : score >= 40
        ? "Real opportunity to cut manual work and tighten the operations."
        : "Significant transformation potential — early stage with clear wins ahead.",
    businessName: assessment.businessName || lead.company || lead.name || "Your business",
    industry: assessment.industry || "your sector",
    summary:
      "Based on the audit, the next 90 days can be shaped around three moves: remove the most painful manual work, ship one meaningful automation, and build a habit of AI-assisted decisions.",
    week1: [
      "List every recurring task that takes more than 30 minutes a week and rank them by pain.",
      "Pick the single most painful one — that's your week 1 target.",
      "Set up a shared Notion or Google Doc so the team can see the roadmap.",
    ],
    weeks24: [
      "Ship the week 1 automation end-to-end. Measure the time it frees up.",
      "Set up automated invoice or follow-up reminders if cashflow or lead response is leaking.",
      "Brief the team on a lightweight AI policy — what's allowed, what's reviewed.",
    ],
    months23: [
      "Layer AI into the next-priority workflow (lead qualification, reporting, or scheduling).",
      "Move to a weekly AI review cadence — what's working, what to retire, what to try next.",
      "Plan a quarterly audit checkpoint to keep the roadmap honest as the business shifts.",
    ],
    nextStep: "Book a 30-minute discovery call and we'll map a custom 30/60/90 plan for your business.",
  };
}

function parseRoadmap(raw: string): RoadmapData | null {
  const cleaned = stripCodeFences(raw);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    if (!parsed || typeof parsed !== "object" || parsed.score === undefined) return null;
    const asArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    return {
      score: Number(parsed.score) || 0,
      scoreLabel: typeof parsed.scoreLabel === "string" ? parsed.scoreLabel : "Moderate readiness",
      scoreBlurb: typeof parsed.scoreBlurb === "string" ? parsed.scoreBlurb : "",
      businessName: typeof parsed.businessName === "string" ? parsed.businessName : "",
      industry: typeof parsed.industry === "string" ? parsed.industry : "your sector",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      week1: asArray(parsed.week1),
      weeks24: asArray(parsed.weeks24),
      months23: asArray(parsed.months23),
      nextStep: typeof parsed.nextStep === "string" ? parsed.nextStep : "",
    };
  } catch {
    return null;
  }
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: ReportRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const assessment: Assessment = {
    ...emptyAssessment(),
    ...(body.assessment || {}),
  };

  if (!body?.email) {
    return new Response(JSON.stringify({ error: "Missing lead email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages: ChatMessage[] = [
    { role: "system" as const, content: REPORT_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content:
        "Generate the roadmap for this lead. Lead details: " +
        JSON.stringify({ name: body.name, email: body.email, company: body.company || null }) +
        "\n\nAssessment (from the chat): " +
        JSON.stringify(assessment, null, 2) +
        "\n\nReturn ONLY the JSON object described in your instructions.",
    },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // controller closed by client — ignore
        }
      };

      // Schedule the build-theater status events. They fire on a timer
      // so the user sees the stages progress in real-time while the LLM
      // streams content. The last stage waits for the actual data.
      const stageTimers: ReturnType<typeof setTimeout>[] = [];
      for (let i = 0; i < STAGE_PLAN.length; i++) {
        const stage = STAGE_PLAN[i];
        const id = setTimeout(() => {
          send("status", { stage: stage.key, label: stage.label });
        }, stage.delayMs);
        stageTimers.push(id);
      }

      let fullText = "";
      let parsed: RoadmapData | null = null;
      let llmError: string | null = null;

      try {
        for await (const delta of chatCompletionStream({
          messages,
          temperature: 0.6,
          maxTokens: 2400,
        })) {
          fullText += delta;
          // Send raw deltas too — the frontend can ignore them, but
          // it's available if we want a typewriter effect later.
          send("token", { delta });
        }
        parsed = parseRoadmap(fullText);
      } catch (err: unknown) {
        llmError = err instanceof Error ? err.message : "LLM stream failed";
      }

      // Cancel any pending stage timers — we're about to land.
      for (const t of stageTimers) clearTimeout(t);

      if (!parsed) {
        // Either the LLM failed or the output wasn't valid JSON.
        // Use the deterministic fallback. The user still gets a roadmap.
        const fallback = deriveFallbackRoadmap(assessment, body);
        send("status", { stage: "fallback", label: "Finalising your roadmap" });
        send("data", { report: fallback, fallback: true, error: llmError });
      } else {
        send("status", { stage: "ready", label: "Ready" });
        send("data", { report: parsed, fallback: false });
      }

      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
