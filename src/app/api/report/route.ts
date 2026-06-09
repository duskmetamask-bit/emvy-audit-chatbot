// /api/report — generates the report content (JSON for the frontend)
// using M2.7 and the lead's running assessment.

import { NextRequest } from "next/server";
import { REPORT_SYSTEM_PROMPT, Assessment, emptyAssessment } from "@/lib/agent";
import { chatCompletion } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReportRequestBody {
  assessment: Assessment;
  name: string;
  email: string;
  company?: string;
}

function stripCodeFences(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return out;
}

function deriveFallbackReport(assessment: Assessment, lead: ReportRequestBody) {
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
      "Based on the audit, there are concrete places to remove manual work and tighten how the business runs day to day. The findings below are specific to what was discussed in the chat.",
    topFindings: assessment.findings.length
      ? assessment.findings.slice(0, 5).map((f) => f.text)
      : [
          "Manual workflows are taking time that could be redirected to growth.",
          "Customer follow-up is inconsistent across the team.",
          "Reporting and visibility into the business is limited.",
        ],
    recommendations: [
      "Pick the most painful manual task and automate it end-to-end first — quick win, clear ROI.",
      "Set up a single source of truth for customer communication and job status.",
      "Schedule weekly auto-generated reporting so the team sees numbers without manual pulls.",
    ],
    priorityAutomations: [
      "Highest-pain manual workflow (often invoicing or lead response) — biggest time leak.",
      "Customer follow-up sequence after a job is done — drives repeat business.",
      "Reporting dashboard pulling from existing tools — gives visibility in one view.",
    ],
    nextStep:
      "Book a 30-minute discovery call and we'll map out a custom implementation plan for your business.",
  };
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

  const messages = [
    { role: "system" as const, content: REPORT_SYSTEM_PROMPT },
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

  try {
    const res = await chatCompletion({ messages, temperature: 0.6, maxTokens: 1800 });
    const raw = res.choices?.[0]?.message?.content || "";
    const cleaned = stripCodeFences(raw);
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      try {
        const parsed = JSON.parse(cleaned.slice(first, last + 1));
        if (parsed && typeof parsed === "object" && parsed.score !== undefined) {
          return Response.json(parsed);
        }
      } catch {
        // fall through
      }
    }
    return Response.json(deriveFallbackReport(assessment, body));
  } catch (err: any) {
    console.error("[/api/report] LLM failed:", err?.message || err);
    return Response.json(deriveFallbackReport(assessment, body));
  }
}