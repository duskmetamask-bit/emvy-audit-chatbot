// Pure functions for parsing the audit-chat LLM response. The model is
// instructed to return a single JSON object with `message` (plain text
// for the user) and `assessment` (structured state). In practice the
// response often leaks reasoning blocks, prose prefixes, and code fences
// around that JSON — these helpers normalise the input before the route
// passes anything to the client.

import type { Assessment, Finding } from "./agent";

// Strip the model's reasoning blocks. M2.7 emits `<think>…</think>`
// blocks inline with the response. We want only the actual reply.
export function stripThinkBlocks(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
}

// Try to extract a JSON object from the raw text. Returns the slice
// between the first `{` and its matching `}`, walking the string to
// skip over nested objects. Returns null if no balanced object is found.
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  // Fall back to a permissive slice if the braces don't balance.
  const last = raw.lastIndexOf("}");
  if (last > start) return raw.slice(start, last + 1);
  return null;
}

// Strip code fences (```json … ``` or ``` … ```) and any `json` language tag.
function stripCodeFences(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return out;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

const SEVERITIES = ["high", "medium", "low"] as const;
type Severity = (typeof SEVERITIES)[number];
function asSeverity(v: unknown): Severity {
  return SEVERITIES.includes(v as Severity) ? (v as Severity) : "medium";
}

export interface ParsedChatResponse {
  // The plain-text reply the user should see.
  message: string;
  // The updated assessment fields (without the message, without the
  // currentQuestion which the route adds from the prior turn).
  assessmentUpdate: Partial<Assessment>;
  // The current question number (1-indexed) and category the LLM
  // declared it was asking, if it set them. The route trusts these to
  // drive the question counter in the UI.
  currentQuestion?: number;
  currentCategory?: string;
}

// Parse the LLM's raw response into a structured form. Tolerant of
// prose prefixes/suffixes, code fences, and think blocks. The MiniMax
// M2.7 model frequently emits a <think>…</think> block followed by
// plain text without a JSON envelope — in that case we fall back to
// using the cleaned prose as the message, and bump currentQuestion
// from the prior turn so the UI still advances.
export function parseChatResponse(raw: string, current: Assessment): ParsedChatResponse | null {
  const cleaned = stripCodeFences(stripThinkBlocks(raw));
  const json = extractJsonObject(cleaned);

  // Fallback path: the model emitted a think block + plain text, with
  // no JSON envelope. Use the cleaned prose as the message and let the
  // route advance the question counter. This keeps the chat alive
  // even when the model forgets the JSON contract.
  if (!json) {
    const prose = cleaned.trim();
    if (!prose) return null;
    return {
      message: prose,
      assessmentUpdate: {},
      currentQuestion: undefined,
      currentCategory: undefined,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    // Malformed JSON inside the braces — fall back to prose.
    const prose = cleaned.replace(/[{}]/g, " ").replace(/\s+/g, " ").trim();
    if (!prose) return null;
    return {
      message: prose,
      assessmentUpdate: {},
      currentQuestion: undefined,
      currentCategory: undefined,
    };
  }
  if (!parsed || typeof parsed !== "object") return null;

  // The model sometimes wraps the structured bits under `assessment`,
  // sometimes puts the keys at the top level. Accept either.
  const a = (parsed.assessment && typeof parsed.assessment === "object"
    ? parsed.assessment
    : parsed) as Record<string, unknown>;

  const update: Partial<Assessment> = {};

  const businessName = asString(a.businessName);
  if (businessName) update.businessName = businessName;
  const businessDescription = asString(a.businessDescription);
  if (businessDescription) update.businessDescription = businessDescription;
  const teamSize = asString(a.teamSize);
  if (teamSize) update.teamSize = teamSize;
  const industry = asString(a.industry);
  if (industry) update.industry = industry;
  const aiTools = asString(a.aiTools);
  if (aiTools) update.aiTools = aiTools;
  const budget = asString(a.budget);
  if (budget) update.budget = budget;
  const goal = asString(a.goal);
  if (goal) update.goal = goal;
  const obstacles = asString(a.obstacles);
  if (obstacles) update.obstacles = obstacles;
  if (typeof a.readyForEmail === "boolean") update.readyForEmail = a.readyForEmail;

  const painPoints = asStringArray(a.painPoints);
  if (painPoints.length) update.painPoints = painPoints;
  const manualTasks = asStringArray(a.manualTasks);
  if (manualTasks.length) update.manualTasks = manualTasks;

  if (Array.isArray(a.findings)) {
    const findings = a.findings
      .map((f): Finding | null => {
        if (!f || typeof f !== "object") return null;
        const o = f as Record<string, unknown>;
        const text = asString(o.text);
        if (!text) return null;
        return {
          category: (asString(o.category) || "ops") as Finding["category"],
          text,
          severity: asSeverity(o.severity),
        };
      })
      .filter((f): f is Finding => f !== null);
    if (findings.length) update.findings = findings;
  }

  if (a.scores && typeof a.scores === "object") {
    const merged: Record<string, number> = { ...current.scores };
    for (const [k, v] of Object.entries(a.scores as Record<string, unknown>)) {
      const n = Number(v);
      if (!Number.isNaN(n) && n >= 1 && n <= 5) merged[k] = Math.round(n);
    }
    update.scores = merged;
  }

  const categoriesCovered = asStringArray(a.categoriesCovered);
  if (categoriesCovered.length) {
    update.categoriesCovered = categoriesCovered as Assessment["categoriesCovered"];
  }

  // The conversational reply. Prefer the explicit `message` field on
  // the JSON; fall back to text before/after the JSON if the model
  // didn't set it.
  const messageField = asString(parsed.message) ?? asString(a.message);
  let message = messageField ?? "";
  if (!message) {
    const before = cleaned.slice(0, cleaned.indexOf(json)).trim();
    const after = cleaned.slice(cleaned.indexOf(json) + json.length).trim();
    message = before || after || "";
  }

  // currentQuestion / currentCategory live at the top level of the JSON
  // (per the audit system prompt), not inside the assessment object. But
  // tolerate either shape for resilience.
  const top = parsed;
  let currentQuestion: number | undefined;
  const cq = top.currentQuestion ?? a.currentQuestion;
  if (typeof cq === "number" && Number.isFinite(cq)) {
    currentQuestion = Math.max(1, Math.min(13, Math.round(cq)));
  }
  const currentCategory = asString(top.currentCategory) ?? asString(a.currentCategory);

  return {
    message: message.trim(),
    assessmentUpdate: update,
    currentQuestion,
    currentCategory,
  };
}
