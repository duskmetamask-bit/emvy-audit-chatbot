// /api/chat — MiniMax M2.7 agent loop with tool calling.
// Uses the full perceive → think → action → feedback loop.

import { NextRequest } from "next/server";
import { AUDIT_SYSTEM_PROMPT, emptyAssessment, Assessment } from "@/lib/agent";
import { runAuditAgent, emptyAssessmentState, AssessmentState } from "@/lib/mini-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  assessment: Assessment;
}

function assessmentToState(assessment: Assessment): AssessmentState {
  return {
    business_name: assessment.businessName,
    business_description: assessment.businessDescription,
    team_size: assessment.teamSize,
    industry: assessment.industry,
    ai_tools: assessment.aiTools,
    budget: assessment.budget,
    goal: assessment.goal,
    obstacles: assessment.obstacles,
    pain_points: assessment.painPoints || [],
    manual_tasks: assessment.manualTasks || [],
    scores: assessment.scores || {},
    findings: assessment.findings || [],
    categories_covered: assessment.categoriesCovered || [],
    messageCount: assessment.messageCount || 0,
    readyForEmail: assessment.readyForEmail || false,
  };
}

function stateToAssessment(state: AssessmentState): Assessment {
  return {
    businessName: state.business_name,
    businessDescription: state.business_description,
    teamSize: state.team_size,
    industry: state.industry,
    aiTools: state.ai_tools,
    budget: state.budget,
    goal: state.goal,
    obstacles: state.obstacles,
    painPoints: state.pain_points,
    manualTasks: state.manual_tasks,
    scores: state.scores,
    findings: (state.findings || []).map(f => ({
      category: (f.category || "ops") as any,
      text: f.text,
      severity: f.severity,
    })),
    categoriesCovered: state.categories_covered as any[],
    messageCount: state.messageCount,
    readyForEmail: state.readyForEmail,
  };
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history = Array.isArray(body?.history) ? body.history : [];
  const assessment = body?.assessment && typeof body.assessment === "object" ? body.assessment : emptyAssessment();
  const state = assessmentToState(assessment);

  try {
    const result = await runAuditAgent(history, state, AUDIT_SYSTEM_PROMPT);

    return new Response(
      JSON.stringify({
        message: result.message,
        assessment: stateToAssessment(result.assessment) as Assessment,
        toolResults: result.toolResults,
        done: result.done,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[/api/chat] Agent error:", err?.message || err);
    return new Response(
      JSON.stringify({
        error: "Agent failed: " + (err?.message || "Unknown error"),
        message: "hmm, something broke on my end. try again?",
        assessment: body?.assessment || emptyAssessment(),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}