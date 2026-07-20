// Pure functions for parsing the audit-chat LLM response. The model is
// instructed to return a single JSON object with `message` (plain text
// for the user) and `assessment` (structured state). In practice the
// response often leaks reasoning blocks, prose prefixes, and code fences
// around that JSON — these helpers normalise the input before the route
// passes anything to the client.
//
// v2 (2026-06-18): assessment no longer carries scores, categoriesCovered,
// currentCategory, budget, or obstacles. Findings no longer carry severity.
// currentQuestion caps at TOTAL_QUESTIONS (10) instead of the old 20.

import type { Assessment, Finding } from "./agent";
import { TOTAL_QUESTIONS } from "./agent";

// Strip the model's reasoning blocks. M2.7 emits `think…/think` (or the
// `?`-tagged variant) inline with the response. We want only the actual
// reply. Order matters: handle the explicit <thinking>/<reasoning> tags
// first, then the bare think block. The `\b` after `think` ensures the
// bare match doesn't reach into `<thinking>` content.
export function stripThinkBlocks(raw: string): string {
  return raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "")
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

// Permissive extraction of the `message` field when the envelope fails
// to parse (typically because the model emitted an unescaped `"` inside
// the message body, e.g. "that's a common pattern"). We match the
// opening `"message"\s*:\s*"` and grab up to the next unescaped `"`.
// Returns null if the field can't be located.
function extractMessageField(raw: string): string | null {
  const key = '"message"';
  const keyIdx = raw.indexOf(key);
  if (keyIdx === -1) return null;
  const colon = raw.indexOf(":", keyIdx + key.length);
  if (colon === -1) return null;
  // Skip past `:` and any whitespace; require the value to start with a quote.
  let i = colon + 1;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== '"') return null;
  i++;
  let out = "";
  let escape = false;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
  }
  // No closing quote — return what we have rather than nothing.
  return out || null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export interface ParsedChatResponse {
  // The plain-text reply the user should see.
  message: string;
  // The updated assessment fields (without the message, without the
  // currentQuestion which the route adds from the prior turn).
  assessmentUpdate: Partial<Assessment>;
  // The current question number (1-indexed) the LLM declared it was
  // asking, if it set one. The route trusts this to drive the question
  // counter in the UI.
  currentQuestion?: number;
}

// Parse the LLM's raw response into a structured form. Tolerant of
// prose prefixes/suffixes, code fences, and think blocks. The MiniMax
// M2.7 model frequently emits a think block followed by plain text
// without a JSON envelope — in that case we fall back to using the
// cleaned prose as the message and let the route advance the counter
// from prior turn state.
export function parseChatResponse(raw: string, current: Assessment): ParsedChatResponse | null {
  const cleaned = stripCodeFences(stripThinkBlocks(raw));
  const json = extractJsonObject(cleaned);

  // Fallback path: the model emitted a think block + plain text, with
  // no JSON envelope. Use the cleaned prose as the message and let the
  // route advance the question counter. Keeps the chat alive even when
  // the model forgets the JSON contract.
  if (!json) {
    const prose = cleaned.trim();
    if (!prose) return null;
    return {
      message: prose,
      assessmentUpdate: {},
      currentQuestion: undefined,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    // Malformed JSON inside the braces — usually because the model
    // emitted an unescaped quote inside the `message` string (M2.7 does
    // this occasionally when the reply contains apostrophes like
    // "that's" or contractions). Try a permissive regex extraction
    // first; only fall back to the raw cleaned prose if the message
    // field can't be located at all.
    const messageField = extractMessageField(cleaned);
    const prose = cleaned.replace(/\s+/g, " ").trim();
    const fallback = messageField ?? prose;
    if (!fallback) return null;
    return {
      message: fallback,
      assessmentUpdate: {},
      currentQuestion: undefined,
    };
  }
  if (!parsed || typeof parsed !== "object") return null;

  // The model sometimes wraps the structured bits under `assessment`,
  // sometimes puts the keys at the top level. Accept either.
  const a = (parsed.assessment && typeof parsed.assessment === "object"
    ? parsed.assessment
    : parsed) as Record<string, unknown>;

  const update: Partial<Assessment> = {};

  // businessName: the wizard is the source of truth (sets it from the
  // company field the user types). The model frequently sets nonsense
  // like "the user" or "your business" — only accept an LLM-set value
  // when the wizard hasn't already populated one.
  const businessName = asString(a.businessName);
  if (businessName && !current.businessName) update.businessName = businessName;
  const businessDescription = asString(a.businessDescription);
  if (businessDescription) update.businessDescription = businessDescription;
  const teamSize = asString(a.teamSize);
  if (teamSize) update.teamSize = teamSize;
  const industry = asString(a.industry);
  if (industry) update.industry = industry;
  const aiTools = asString(a.aiTools);
  if (aiTools) update.aiTools = aiTools;
  const goal = asString(a.goal);
  if (goal) update.goal = goal;
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
          category: asString(o.category) ?? "ops",
          text,
        };
      })
      .filter((f): f is Finding => f !== null);
    if (findings.length) update.findings = findings;
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

  // currentQuestion lives at the top level of the JSON (per the audit
  // system prompt), not inside the assessment object. But tolerate
  // either shape for resilience.
  const top = parsed;
  let currentQuestion: number | undefined;
  const cq = top.currentQuestion ?? a.currentQuestion;
  if (typeof cq === "number" && Number.isFinite(cq)) {
    // Cap at TOTAL_QUESTIONS (1-10). Follow-ups stay on the same
    // currentQuestion; the LLM is told not to advance it.
    currentQuestion = Math.max(1, Math.min(TOTAL_QUESTIONS, Math.round(cq)));
  }

  return {
    message: message.trim(),
    assessmentUpdate: update,
    currentQuestion,
  };
}
