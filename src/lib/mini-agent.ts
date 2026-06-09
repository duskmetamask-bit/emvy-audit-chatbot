// MiniMax M2.7 Audit Agent — full tool-calling agent loop.
// Perceive → Think → Action → Feedback → until task is done.

import { ChatMessage, chatCompletionStream, chatCompletion } from "./llm";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const AGENT_TOOLS: Tool[] = [
  {
    name: "store_lead",
    description: "Store a lead's contact details and audit assessment in the database. Call this when the user provides their name and email. Arguments: name (string, required), email (string, required), company (string, optional), assessment_summary (object, optional). Returns the created lead record.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name of the lead" },
        email: { type: "string", description: "Email address" },
        company: { type: "string", description: "Company name (optional)" },
        assessment_summary: {
          type: "object",
          description: "Summary of the audit assessment captured so far",
          properties: {
            business_name: { type: "string" },
            team_size: { type: "string" },
            industry: { type: "string" },
            pain_points: { type: "array", items: { type: "string" } },
            manual_tasks: { type: "array", items: { type: "string" } },
            ai_tools: { type: "string" },
            categories_covered: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["name", "email"],
    },
  },
  {
    name: "search_knowledge_base",
    description: "Search EMVY's audit knowledge base for relevant findings, recommendations, or automation plays based on the conversation so far. Call this when you need inspiration for findings or recommendations. Arguments: query (string, required). Returns a list of relevant knowledge entries.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for — e.g. 'invoicing automation', 'lead capture best practices', 'team communication tools'" },
      },
      required: ["query"],
    },
  },
  {
    name: "generate_audit_report",
    description: "Generate the final AI audit report for the user. Call this when you have enough information (6+ categories covered, business name known, specific findings identified) and the user has provided their email. Arguments: email (string, required), name (string, required), assessment_summary (object, required). Returns the structured report data (score, findings, recommendations, priority automations).",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "User's email address" },
        name: { type: "string", description: "User's full name" },
        assessment_summary: {
          type: "object",
          properties: {
            business_name: { type: "string" },
            business_description: { type: "string" },
            team_size: { type: "string" },
            work_location: { type: "string" },
            industry: { type: "string" },
            pain_points: { type: "array", items: { type: "string" } },
            manual_tasks: { type: "array", items: { type: "string" } },
            ai_tools: { type: "string" },
            budget: { type: "string" },
            goal: { type: "string" },
            obstacles: { type: "string" },
            categories_covered: { type: "array", items: { type: "string" } },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  text: { type: "string" },
                  severity: { type: "string" },
                },
              },
            },
          },
          required: ["business_name"],
        },
      },
      required: ["email", "name", "assessment_summary"],
    },
  },
];

// ─── Tool Execution ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  arguments_: Record<string, unknown>,
  assessmentState: AssessmentState
): Promise<ToolResult> {
  switch (name) {
    case "store_lead": {
      const { name: leadName, email, company, assessment_summary } = arguments_ as {
        name: string;
        email: string;
        company?: string;
        assessment_summary?: AssessmentState;
      };
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rrjktvvnzjzlfquaghut.supabase.co";
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await supabase.from("leads").insert({
          name: leadName,
          email,
          company: company || null,
          business_name: assessment_summary?.business_name || null,
          team_size: assessment_summary?.team_size || null,
          industry: assessment_summary?.industry || null,
          pain_points: (assessment_summary?.pain_points || []).join(" | ") || null,
          manual_tasks: (assessment_summary?.manual_tasks || []).join(" | ") || null,
          ai_tools: assessment_summary?.ai_tools || null,
          assessment: assessment_summary || null,
        }).select().single();
        if (error) throw error;
        return { success: true, data };
      } catch (err: any) {
        return { success: false, error: err?.message || "Failed to store lead" };
      }
    }

    case "search_knowledge_base": {
      const { query } = arguments_ as { query: string };
      // Built-in audit knowledge — no external KB needed for V1
      const knowledge = getAuditKnowledge(query);
      return { success: true, data: knowledge };
    }

    case "generate_audit_report": {
      const { email, name, assessment_summary } = arguments_ as {
        email: string;
        name: string;
        assessment_summary: AssessmentState;
      };
      try {
        const report = await buildReportFromAssessment(assessment_summary, { name, email });
        return { success: true, data: report };
      } catch (err: any) {
        return { success: false, error: err?.message || "Failed to generate report" };
      }
    }

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ─── Knowledge Base ────────────────────────────────────────────────────────────

function getAuditKnowledge(query: string): Array<{ finding: string; category: string; severity: "high" | "medium" | "low" }> {
  const q = query.toLowerCase();
  const entries: Array<{ finding: string; category: string; severity: "high" | "medium" | "low"; keywords: string[] }> = [
    // Invoicing
    { finding: "Manual invoicing is one of the highest-time-cost tasks in small businesses. Automating invoice generation and payment reminders typically saves 3-5 hours per week.", category: "invoicing", severity: "high", keywords: ["invoicing", "billing", "payments", "get paid", "invoice"] },
    { finding: "Businesses without automated payment reminders lose on average 15-20% of receivables to late payment. Setting up 3-7-14 day reminders recovers most of this.", category: "invoicing", severity: "high", keywords: ["late payment", "chasing", "reminders", "collections"] },
    // Lead capture
    { finding: "Businesses still using manual enquiry capture (phone calls, voice notes, DMs) lose 30-40% of leads to follow-up gaps. Automated enquiry capture + immediate response triples conversion.", category: "lead_capture", severity: "high", keywords: ["leads", "enquiries", "new customers", "first contact"] },
    { finding: "A dedicated enquiry form on website or a lead magnet audit (like this one) can increase qualified lead volume by 2-3x without additional marketing spend.", category: "lead_capture", severity: "medium", keywords: ["website", "form", "lead magnet", "enquiry form"] },
    // Follow-up
    { finding: "No automated follow-up after a job or quote is one of the most common and expensive gaps. A simple sequence (3-day check-in, 7-day offer) can recover 20% more revenue from existing pipeline.", category: "followup", severity: "high", keywords: ["follow up", "after the job", "quote follow", "chasing quotes"] },
    { finding: "Businesses that touch a customer within 48 hours of any interaction (inquiry, quote, job done) have 3x higher conversion rates than those that don't.", category: "followup", severity: "medium", keywords: ["response time", "speed", "contact", "nurture"] },
    // Operations
    { finding: "Manual job tracking (spreadsheets, notes, whiteboard) creates visibility gaps that cost jobs and customers. Even a simple job tracker cuts coordination overhead by 40%.", category: "ops", severity: "high", keywords: ["job tracking", "operations", "scheduling", "jobs", "work in progress"] },
    { finding: "No centralised view of job status means the owner is always the bottleneck. Giving the team a shared view reduces 'what's the status?' messages by 80%.", category: "ops", severity: "medium", keywords: ["team visibility", "status", "coordination"] },
    // Communication
    { finding: "Using personal SMS or WhatsApp for business communication means critical info is on personal phones. Business communication tools give the team (and owner) a shared record.", category: "comms", severity: "medium", keywords: ["sms", "whatsapp", "communication", "team messaging"] },
    // Reviews
    { finding: "Google reviews are the single most impactful local marketing asset for small businesses. Businesses with 20+ reviews at 4.5+ stars get 3x more enquiries. Automation can get you there in 3-6 months.", category: "reviews", severity: "high", keywords: ["reviews", "google", "testimonials", "reputation"] },
    { finding: "Most businesses ask for reviews once and forget about it. Setting up automated review requests after job completion can increase review rate from <5% to 20-30%.", category: "reviews", severity: "medium", keywords: ["review request", "ask for reviews", "google review"] },
    // Team
    { finding: "Teams without a shared task tool waste 1-2 hours per week on 'have you done that?' checks. Even a shared to-do list cuts this to near zero.", category: "team", severity: "medium", keywords: ["team tasks", "task management", "to-do", "assigning work"] },
    // Reporting
    { finding: "Business owners who check their numbers weekly make better decisions and grow 20% faster on average. Automated weekly reporting removes the 'I don't have time to look at that' barrier.", category: "reporting", severity: "medium", keywords: ["reporting", "numbers", "visibility", "weekly report", "dashboards"] },
    // Quoting
    { finding: "Manual quote preparation (word doc, email, wait, revise) is a major conversion killer. Structured quote generation with templates can cut quote time from 2 hours to 20 minutes.", category: "quoting", severity: "high", keywords: ["quotes", "estimates", "pricing", "proposals", "quoting"] },
  ];
  const matched = entries.filter(e => e.keywords.some(k => q.includes(k)));
  return matched.length > 0 ? matched : entries.slice(0, 3);
}

// ─── Report Generation ─────────────────────────────────────────────────────────

async function buildReportFromAssessment(
  assessment: AssessmentState,
  lead: { name: string; email: string }
): Promise<ReportData> {
  const { REPORT_SYSTEM_PROMPT } = await import("./agent");
  const scores = Object.values(assessment.scores || {});
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 3;
  const score = Math.round(avg * 20);
  const scoreLabel = score >= 70 ? "High readiness" : score >= 40 ? "Moderate readiness" : "Early stage";

  const messages: ChatMessage[] = [
    { role: "system", content: REPORT_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Generate the audit report.\n\nLead: ${lead.name} (${lead.email})\nBusiness: ${assessment.business_name || "unknown"}\nIndustry: ${assessment.industry || "unknown"}\nTeam: ${assessment.team_size || "unknown"}\nCategories covered: ${(assessment.categories_covered || []).join(", ")}\n\nPain points: ${(assessment.pain_points || []).join(" | ")}\nManual tasks: ${(assessment.manual_tasks || []).join(" | ")}\nAI tools: ${assessment.ai_tools || "none"}\nBudget: ${assessment.budget || "unknown"}\nGoal: ${assessment.goal || "unknown"}\n\nFindings: ${(assessment.findings || []).map(f => `[${f.category}/${f.severity}] ${f.text}`).join(" | ")}\n\nReturn ONLY the JSON object described in your instructions.`,
    },
  ];

  try {
    const res = await chatCompletion({ messages, temperature: 0.6, maxTokens: 1800 });
    const raw = res.choices?.[0]?.message?.content || "";
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      const parsed = JSON.parse(raw.slice(first, last + 1));
      if (parsed && typeof parsed === "object" && "score" in parsed) {
        return parsed as ReportData;
      }
    }
  } catch {
    // fall through to fallback
  }

  // Fallback
  return {
    score,
    scoreLabel,
    scoreBlurb: score >= 70 ? "Well positioned for AI adoption across the operations we covered." : score >= 40 ? "Real opportunity to cut manual work and tighten the operations." : "Significant transformation potential — early stage with clear wins ahead.",
    businessName: assessment.business_name || lead.name,
    industry: assessment.industry || "your sector",
    summary: "Based on the audit, there are concrete places to remove manual work and tighten how the business runs day to day.",
    topFindings: (assessment.findings || []).slice(0, 5).map(f => f.text),
    recommendations: [
      "Pick the most painful manual task and automate it end-to-end first — quick win, clear ROI.",
      "Set up a single source of truth for customer communication and job status.",
      "Schedule weekly auto-generated reporting so the team sees numbers without manual pulls.",
    ],
    priorityAutomations: [
      "Highest-pain manual workflow — biggest time leak in your day-to-day.",
      "Customer follow-up sequence — drives repeat business from existing customers.",
      "Reporting dashboard — gives visibility in one view without manual pulls.",
    ],
    nextStep: "Book a 30-minute discovery call and we'll map out a custom implementation plan for your business.",
  };
}

// ─── Assessment State ─────────────────────────────────────────────────────────

export interface AssessmentState {
  business_name?: string;
  business_description?: string;
  team_size?: string;
  work_location?: string;
  industry?: string;
  pain_points: string[];
  manual_tasks: string[];
  ai_tools?: string;
  budget?: string;
  goal?: string;
  obstacles?: string;
  scores: Record<string, number>;
  findings: Array<{ category: string; text: string; severity: "high" | "medium" | "low" }>;
  categories_covered: string[];
  messageCount: number;
  readyForEmail: boolean;
}

export function emptyAssessmentState(): AssessmentState {
  return {
    pain_points: [],
    manual_tasks: [],
    scores: {},
    findings: [],
    categories_covered: [],
    messageCount: 0,
    readyForEmail: false,
  };
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

interface AgentResponse {
  message: string;
  assessment: AssessmentState;
  toolResults: Array<{ tool: string; result: ToolResult }>;
  done: boolean;
}

const MAX_STEPS = 20;

export async function runAuditAgent(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  assessment: AssessmentState,
  systemPrompt: string
): Promise<AgentResponse> {
  const agentMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "system",
      content:
        "CURRENT_RUNNING_ASSESSMENT (update this in every response):\n" +
        JSON.stringify(assessment, null, 2),
    },
  ];

  // Append conversation history
  for (const msg of messages) {
    agentMessages.push({ role: msg.role, content: msg.content });
  }

  let step = 0;
  let currentAssessment = { ...assessment };
  let lastAssistantMessage = "";
  const toolResults: Array<{ tool: string; result: ToolResult }> = [];

  while (step < MAX_STEPS) {
    step++;

    // Call the model
    const response = await chatCompletion({
      messages: agentMessages,
      temperature: 0.7,
      maxTokens: 1024,
    });

    const assistantMsg = response.choices[0].message;
    const rawContent = assistantMsg.content || "";

    // Append assistant message to history (preserve full message with tool_calls for next round)
    agentMessages.push({ role: "assistant" as const, content: rawContent });

    const toolCalls = assistantMsg.tool_calls || [];

    if (toolCalls.length === 0) {
      // No tool calls — agent returned a text response
      const updatedAssessment = extractAssessmentUpdate(rawContent, currentAssessment);
      return {
        message: rawContent,
        assessment: { ...currentAssessment, ...updatedAssessment, messageCount: messages.filter(m => m.role === "user").length },
        toolResults,
        done: true,
      };
    }

    // Execute each tool call
    for (const tc of toolCalls) {
      const toolName = tc.function?.name || "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        // ignore malformed args
      }

      const result = await executeTool(toolName, args, currentAssessment);
      toolResults.push({ tool: toolName, result });

      // Append tool result to messages
      agentMessages.push({
        role: "user",
        content: JSON.stringify({ tool: toolName, result }),
      });

      // If tool was store_lead, update assessment
      if (toolName === "store_lead" && result.success) {
        currentAssessment = { ...currentAssessment, readyForEmail: true };
      }

      // If tool was generate_audit_report, we're done
      if (toolName === "generate_audit_report" && result.success) {
        return {
          message: rawContent,
          assessment: { ...currentAssessment, messageCount: messages.filter(m => m.role === "user").length },
          toolResults,
          done: true,
        };
      }
    }
  }

  // Max steps reached — return last message
  return {
    message: lastAssistantMessage || "That's all I need for now — thanks!",
    assessment: { ...currentAssessment, messageCount: messages.filter(m => m.role === "user").length },
    toolResults,
    done: true,
  };
}

// ─── Assessment Extraction ────────────────────────────────────────────────────

function extractAssessmentUpdate(message: string, current: AssessmentState): Partial<AssessmentState> {
  // Try to parse a JSON block from the message
  const firstBrace = message.indexOf("{");
  const lastBrace = message.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return {};

  try {
    const parsed = JSON.parse(message.slice(firstBrace, lastBrace + 1));
    const update: Partial<AssessmentState> = {};

    if (parsed.business_name) update.business_name = parsed.business_name;
    if (parsed.business_description) update.business_description = parsed.business_description;
    if (parsed.team_size) update.team_size = parsed.team_size;
    if (parsed.industry) update.industry = parsed.industry;
    if (parsed.ai_tools) update.ai_tools = parsed.ai_tools;
    if (parsed.budget) update.budget = parsed.budget;
    if (parsed.goal) update.goal = parsed.goal;
    if (parsed.obstacles) update.obstacles = parsed.obstacles;
    if (parsed.readyForEmail) update.readyForEmail = parsed.readyForEmail;

    if (Array.isArray(parsed.pain_points)) update.pain_points = parsed.pain_points;
    if (Array.isArray(parsed.manual_tasks)) update.manual_tasks = parsed.manual_tasks;
    if (Array.isArray(parsed.findings)) update.findings = (parsed.findings as Array<{category?: string; text?: unknown; severity?: string}>).map(f => ({
          category: (f.category || "ops") as typeof current.findings[number]["category"],
          text: String(f.text || ""),
          severity: (["high", "medium", "low"] as const).includes(f.severity as "high" | "medium" | "low") ? f.severity as "high" | "medium" | "low" : "medium" as const,
        }));
        if (parsed.scores && typeof parsed.scores === "object") {
          update.scores = { ...current.scores };
          for (const [k, v] of Object.entries(parsed.scores)) {
            const n = Number(v);
            if (!isNaN(n) && n >= 1 && n <= 5) (update.scores as Record<string, number>)[k] = Math.round(n);
          }
        }
        if (Array.isArray(parsed.categories_covered)) update.categories_covered = parsed.categories_covered as AssessmentState["categories_covered"];

    return update;
  } catch {
    return {};
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportData {
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