// /api/report — generates the personalised AI strategy report as a
// Server-Sent Events stream. The frontend listens for `status` events
// (build theater) and a final `data` event with the parsed ReportData JSON.
//
// Why SSE: the report is the climax of the flow. Streaming lets us
// show "Building your roadmap..." stages in real-time, then fade the
// final report in as the data lands. Beats a static spinner.
//
// v2 (2026-06-18): report shape changed. Now 5 sections — Strategy
// Summary, 3 Opportunities (each with title + 4 sub-fields), Quick Win,
// First 90 Days (3 phases with title + actions[]), What to Do Next. No
// scores, no findings/severity block.

import { NextRequest } from "next/server";
import { REPORT_SYSTEM_PROMPT, STAGE_PLAN, Assessment, emptyAssessment } from "@/lib/agent";
import { chatCompletionStream, ChatMessage } from "@/lib/llm";
import { extractJsonObject, stripThinkBlocks } from "@/lib/chat-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReportRequestBody {
  assessment: Assessment;
  name: string;
  email: string;
  company?: string;
}

interface RoadmapOpportunity {
  title: string;
  whatItIs: string;
  whyMatters: string;
  whatChanges: string;
  howFast: string;
}

interface RoadmapPhase {
  title: string;
  actions: string[];
}

interface RoadmapData {
  businessName: string;
  industry: string;
  summary: string;
  opportunities: RoadmapOpportunity[];
  quickWin: string;
  first90Days: RoadmapPhase[];
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
  const businessName = assessment.businessName || lead.company || lead.name || "Your business";
  const industry = assessment.industry || "your sector";
  const goal = assessment.goal || "more revenue with less manual grind";

  // Seed opportunities from the chat-side findings (the LLM collected
  // them as it went). Fall back to a generic pair if the chat didn't
  // surface anything concrete.
  const seedTexts = (assessment.findings || []).map((f) => f.text).filter(Boolean);
  const opportunities: RoadmapOpportunity[] = [];
  if (seedTexts.length > 0) {
    opportunities.push({
      title: "Automate the top leak",
      whatItIs: `Tackle the first manual loop from your answers: ${seedTexts[0]}.`,
      whyMatters: `You said this is taking time every week — that's the highest-leverage place to start.`,
      whatChanges: `Once it's automated, the time you spent here goes back into ${goal}.`,
      howFast: "Live within 1-2 weeks once the automation is wired up.",
    });
  }
  if (seedTexts.length > 1) {
    opportunities.push({
      title: "Streamline follow-up",
      whatItIs: `Address the next bottleneck: ${seedTexts[1]}.`,
      whyMatters: "Same shape of win as the first — fewer manual seams between you and the customer.",
      whatChanges: "Shorter response times, fewer dropped balls, more revenue closed.",
      howFast: "Visible in week 2-3 once the new flow is in place.",
    });
  }
  opportunities.push({
    title: "Layer AI into ops",
    whatItIs: "Use AI to draft quotes, summarise jobs, and brief the team automatically.",
    whyMatters: "The compounding move — every workflow that runs through this gets cheaper over time.",
    whatChanges: "Less time on admin, more time on the work that actually grows the business.",
    howFast: "Pays back over months 2-3.",
  });
  while (opportunities.length < 3) {
    opportunities.push({
      title: "Quick win to lock in",
      whatItIs: "Pick the next manual task and ship a small automation.",
      whyMatters: "Compounding — every one of these chips away at the manual overhead.",
      whatChanges: "Less grind, more headspace.",
      howFast: "Live within a week.",
    });
  }

  return {
    businessName,
    industry,
    summary: `${businessName} has a clear next move: ${opportunities[0].title.toLowerCase()}. Ship the quick win this week, then sequence the next two opportunities over the following 90 days.`,
    opportunities,
    quickWin: "Pick one recurring task that takes 30+ minutes a week and automate it — even a rough version is a win this week.",
    first90Days: [
      {
        title: "First 30 days",
        actions: [
          "List every recurring task that takes more than 30 minutes a week and rank them by pain.",
          `Pick the single most painful one — that's your week 1 target: ${opportunities[0].whatItIs}`,
          "Set up a shared Notion or Google Doc so the team can see the roadmap.",
        ],
      },
      {
        title: "Next 30 days",
        actions: [
          "Ship the week 1 automation end-to-end. Measure the time it frees up.",
          "Set up automated invoice or follow-up reminders if cashflow or lead response is leaking.",
          "Brief the team on a lightweight AI policy — what's allowed, what's reviewed.",
        ],
      },
      {
        title: "Days 60-90",
        actions: [
          "Layer AI into the next-priority workflow (lead qualification, reporting, or scheduling).",
          "Move to a weekly AI review cadence — what's working, what to retire, what to try next.",
          "Plan a quarterly review checkpoint to keep the roadmap honest as the business shifts.",
        ],
      },
    ],
    nextStep: `Book a free 15-min discovery call with EMVY and we'll map the exact automations to ${businessName}, sequence them by ROI, and ship the first one inside two weeks. https://emvyai.com/services/discovery-call`,
  };
}

// M2.7 sometimes emits the same key twice in a row, e.g.
//   {"actions": [...], "actions": [...], "actions": [...]}
// instead of a single {"actions": [..., ..., ...]}. This is non-strict
// JSON (duplicate keys) and JSON.parse rejects it. Walk the raw text
// and merge any duplicate "actions" arrays within the same parent object
// before handing to JSON.parse.
function mergeDuplicateActionsKeys(raw: string): string {
  // Match patterns like: "actions": [...],?  repeated, with no other
  // key between them. Captures the inner arrays. We rebuild the
  // surrounding object by splitting on these clusters.
  // Conservative: only act on consecutive "actions" keys inside what
  // looks like an object body (between { and }, surrounded by , or {).
  return raw.replace(
    /("actions"\s*:\s*\[[^\]]*\])(?:\s*,\s*"actions"\s*:\s*\[[^\]]*\])+/g,
    (match) => {
      // Collect every [...] that follows "actions":
      const arrs: string[] = [];
      const re = /"actions"\s*:\s*(\[[^\]]*\])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(match)) !== null) arrs.push(m[1]);
      return `"actions": ${arrs.join(", ")}`;
    }
  );
}

function parseRoadmap(raw: string): RoadmapData | null {
  // 1. Strip think blocks (M2.7 emits <think>…</think> inline) so the
  //    JSON extractor doesn't see a `{` inside the reasoning.
  // 2. Strip code fences.
  // 3. Walk balanced braces to find the actual JSON object (avoids
  //    `indexOf("{")` pointing at a brace in a think-block string the
  //    parser missed, or `lastIndexOf("}")` pointing at a brace in
  //    narrative text after the JSON).
  // 4. Repair the duplicate-"actions" LLM slip above. After this
  //    JSON.parse can usually succeed.
  const cleaned = mergeDuplicateActionsKeys(stripCodeFences(stripThinkBlocks(raw)));
  const json = extractJsonObject(cleaned);
  if (!json) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const asOpportunities = (v: unknown): RoadmapOpportunity[] => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
      .map((x): RoadmapOpportunity | null => {
        if (
          typeof x.title !== "string" ||
          typeof x.whatItIs !== "string" ||
          typeof x.whyMatters !== "string" ||
          typeof x.whatChanges !== "string" ||
          typeof x.howFast !== "string"
        ) {
          return null;
        }
        return {
          title: x.title.trim(),
          whatItIs: x.whatItIs.trim(),
          whyMatters: x.whyMatters.trim(),
          whatChanges: x.whatChanges.trim(),
          howFast: x.howFast.trim(),
        };
      })
      .filter((o): o is RoadmapOpportunity => o !== null && o.title.length > 0);
  };

  const asPhases = (v: unknown): RoadmapPhase[] => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
      .map((x): RoadmapPhase | null => {
        if (typeof x.title !== "string" || !Array.isArray(x.actions)) return null;
        const actions = x.actions.filter(
          (a): a is string => typeof a === "string" && a.trim().length > 0
        );
        if (actions.length === 0) return null;
        return { title: x.title.trim(), actions };
      })
      .filter((p): p is RoadmapPhase => p !== null);
  };

  return {
    businessName: typeof parsed.businessName === "string" ? parsed.businessName : "",
    industry: typeof parsed.industry === "string" ? parsed.industry : "your sector",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    opportunities: asOpportunities(parsed.opportunities),
    quickWin: typeof parsed.quickWin === "string" ? parsed.quickWin : "",
    first90Days: asPhases(parsed.first90Days),
    nextStep: typeof parsed.nextStep === "string" ? parsed.nextStep : "",
  };
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

  // JSON-only reminder: M2.7 sometimes emits invalid JSON (e.g.
  // duplicate `"actions"` keys) or wraps the JSON in a think block.
  // The reminder primes the contract before the model sees the user
  // request. Pair with the more tolerant parseRoadmap below so even a
  // slip lands the report.
  const messages: ChatMessage[] = [
    { role: "system" as const, content: REPORT_SYSTEM_PROMPT },
    {
      role: "system",
      content:
        "REMINDER: respond ONLY with a single JSON object. First char `{`, last char `}`. " +
        "No prose outside the braces. No `think` blocks. No reasoning. No code fences. " +
        "CRITICAL SCHEMA NOTES: each `actions` field is a SINGLE array with 3 string elements, " +
        "not 3 separate `actions` keys. Each `opportunities` entry is a SINGLE object with 5 " +
        "string fields (title, whatItIs, whyMatters, whatChanges, howFast). No duplicate keys.",
    },
    {
      role: "user" as const,
      content:
        "Generate the report for this lead. Lead details: " +
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
          // Bumped from 2400 → 4096. M2.7 emits a long think block
          // (~1500-2000 tokens) before the JSON, then needs ~2000
          // tokens for the actual 5-section report. 2400 was cutting
          // the JSON off mid-stream and the parser was rejecting the
          // truncated output, so users were getting the generic
          // boilerplate fallback. 4096 fits the think block + a full
          // report with breathing room.
          maxTokens: 4096,
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

      if (!parsed || parsed.opportunities.length === 0) {
        // Either the LLM failed or the output wasn't valid JSON. Use the
        // deterministic fallback. The user still gets a real report.
        const fallback = deriveFallbackRoadmap(assessment, body);
        send("status", { stage: "fallback", label: "Finalising your report" });
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
