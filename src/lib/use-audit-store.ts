// LocalStorage state-persistence slice for the audit chatbot. Mirrors the
// `useSyncExternalStore` shape from `~/Code/teachwise-v3/src/lib/use-profile.ts`
// (read-once cache, same-tab StorageEvent dispatch, SSR-safe snapshot).
//
// Stores the user's full conversation state — stage, messages, assessment,
// captured lead fields, generated report, and the small flags the restore
// path needs to suppress duplicate side effects on reload (chatbotLeadId,
// reportSent). The store is purely client-side; the server endpoints are
// untouched and the `:create` / SSE / Resend flows only re-fire when the
// persisted state says they should.
//
// v3 (2026-06-19): report shape changed (no more first90Days 3-phase
// bucket; flat `checklist: string[]` of 5-7 verb-first actions instead).
// Replaces the 30/60/90 phasing the user pushed back on. Old v2 keys on
// disk fail the new validators and are treated as EMPTY.
//
// Hand-rolled validators instead of Zod: the audit chatbot's package tree
// does not declare zod as a runtime dependency, and this slice does not
// justify adding one. Each invalid input shape returns `null` from
// `parseAuditState`, which the store maps to `EMPTY_AUDIT_STATE`.

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "emvy-audit-state:v3";
const STORAGE_VERSION = 3 as const;

export type Stage = "welcome" | "chat" | "email" | "building" | "report";

export interface Message {
  role: "bot" | "user";
  content: string;
  timestamp?: string;
  step?: string;
}

export interface Assessment {
  businessName?: string;
  businessDescription?: string;
  teamSize?: string;
  industry?: string;
  findings: Array<{ category: string; text: string }>;
  painPoints: string[];
  manualTasks: string[];
  aiTools?: string;
  goal?: string;
  messageCount: number;
  readyForEmail: boolean;
  currentQuestion?: number;
}

export interface ReportOpportunity {
  title: string;
  whatItIs: string;
  whyMatters: string;
  whatChanges: string;
  howFast: string;
}

export interface ReportData {
  businessName: string;
  industry: string;
  summary: string;
  opportunities: ReportOpportunity[];
  quickWin: string;
  checklist: string[];
  nextStep: string;
}

export interface AuditState {
  version: 3;
  stage: Stage;
  messages: Message[];
  assessment: Assessment;
  sessionId: string;
  name: string;
  email: string;
  company: string;
  report: ReportData | null;
  chatbotLeadId: string | null;
  reportSent: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export const EMPTY_AUDIT_STATE: AuditState = Object.freeze({
  version: STORAGE_VERSION,
  stage: "welcome",
  messages: [],
  assessment: {
    findings: [],
    painPoints: [],
    manualTasks: [],
    messageCount: 0,
    readyForEmail: false,
    currentQuestion: 0,
  },
  sessionId: "",
  name: "",
  email: "",
  company: "",
  report: null,
  chatbotLeadId: null,
  reportSent: false,
  startedAt: null,
  completedAt: null,
}) as AuditState;

/* ── Validators (hand-rolled, no Zod) ────────────────────────────────────── */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isArrayOf<T>(v: unknown, pred: (x: unknown) => x is T): v is T[] {
  return Array.isArray(v) && v.every(pred);
}

const STAGES = ["welcome", "chat", "email", "building", "report"] as const;
function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

const ROLES = ["bot", "user"] as const;
function isRole(v: unknown): v is "bot" | "user" {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

function isMessage(v: unknown): v is Message {
  if (!isObject(v)) return false;
  if (!isRole(v.role)) return false;
  if (!isString(v.content)) return false;
  if (v.timestamp !== undefined && !isString(v.timestamp)) return false;
  if (v.step !== undefined && !isString(v.step)) return false;
  return true;
}

function isFinding(v: unknown): v is Assessment["findings"][number] {
  if (!isObject(v)) return false;
  if (!isString(v.category)) return false;
  if (!isString(v.text)) return false;
  return true;
}

function isAssessment(v: unknown): v is Assessment {
  if (!isObject(v)) return false;
  for (const opt of [
    "businessName",
    "businessDescription",
    "teamSize",
    "industry",
    "aiTools",
    "goal",
  ] as const) {
    if (v[opt] !== undefined && !isString(v[opt])) return false;
  }
  if (!isArrayOf(v.findings, isFinding)) return false;
  if (!isStringArray(v.painPoints)) return false;
  if (!isStringArray(v.manualTasks)) return false;
  if (!isNumber(v.messageCount) || !Number.isInteger(v.messageCount) || v.messageCount < 0) return false;
  if (!isBoolean(v.readyForEmail)) return false;
  if (v.currentQuestion !== undefined) {
    if (
      !isNumber(v.currentQuestion) ||
      !Number.isInteger(v.currentQuestion) ||
      v.currentQuestion < 0 ||
      v.currentQuestion > 10
    ) {
      return false;
    }
  }
  return true;
}

function isOpportunity(v: unknown): v is ReportOpportunity {
  if (!isObject(v)) return false;
  return (
    isString(v.title) &&
    isString(v.whatItIs) &&
    isString(v.whyMatters) &&
    isString(v.whatChanges) &&
    isString(v.howFast)
  );
}

function isReportData(v: unknown): v is ReportData {
  if (!isObject(v)) return false;
  if (!isString(v.businessName)) return false;
  if (!isString(v.industry)) return false;
  if (!isString(v.summary)) return false;
  if (!isArrayOf(v.opportunities, isOpportunity)) return false;
  if (!isString(v.quickWin)) return false;
  if (!isStringArray(v.checklist)) return false;
  if (!isString(v.nextStep)) return false;
  return true;
}

export function parseAuditState(raw: unknown): AuditState | null {
  if (!isObject(raw)) return null;
  if (raw.version !== STORAGE_VERSION) return null;
  if (!isStage(raw.stage)) return null;
  if (!isArrayOf(raw.messages, isMessage)) return null;
  if (!isAssessment(raw.assessment)) return null;
  if (!isString(raw.sessionId)) return null;
  if (!isString(raw.name)) return null;
  if (!isString(raw.email)) return null;
  if (!isString(raw.company)) return null;
  if (raw.report !== null && !isReportData(raw.report)) return null;
  if (raw.chatbotLeadId !== null && !isString(raw.chatbotLeadId)) return null;
  if (!isBoolean(raw.reportSent)) return null;
  if (raw.startedAt !== null && !isString(raw.startedAt)) return null;
  if (raw.completedAt !== null && !isString(raw.completedAt)) return null;
  return {
    version: STORAGE_VERSION,
    stage: raw.stage,
    messages: raw.messages,
    assessment: raw.assessment,
    sessionId: raw.sessionId,
    name: raw.name,
    email: raw.email,
    company: raw.company,
    report: raw.report,
    chatbotLeadId: raw.chatbotLeadId,
    reportSent: raw.reportSent,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
  };
}

/* ── Storage I/O (with lastRaw cache + same-tab dispatch) ───────────────── */

let cachedSnapshot: AuditState = EMPTY_AUDIT_STATE;
let lastRaw: string | null = null;

function readSnapshot(): AuditState {
  if (typeof window === "undefined") return EMPTY_AUDIT_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === lastRaw) return cachedSnapshot;
  lastRaw = raw;
  if (!raw) {
    cachedSnapshot = EMPTY_AUDIT_STATE;
    return cachedSnapshot;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    cachedSnapshot = parseAuditState(parsed) ?? EMPTY_AUDIT_STATE;
  } catch {
    cachedSnapshot = EMPTY_AUDIT_STATE;
  }
  return cachedSnapshot;
}

function subscribe(notify: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function getServerSnapshot(): AuditState {
  return EMPTY_AUDIT_STATE;
}

// Exported for test coverage. Production code should reach the writers
// through `useAuditStore()` so the side effects participate in the same
// React subscription as `readSnapshot`.
export function writePatch(partial: Partial<AuditState>): void {
  if (typeof window === "undefined") return;
  let current: AuditState = EMPTY_AUDIT_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const validated = parseAuditState(parsed);
      if (validated) current = validated;
    } catch {
      // corrupt raw — start from EMPTY
    }
  }
  const next: AuditState = { ...current, ...partial, version: STORAGE_VERSION };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota exceeded or private-mode Safari — silently drop persistence
  }
  // Notify same-tab subscribers. The real `StorageEvent` only fires in
  // OTHER tabs, not the one that wrote.
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

// Exported for test coverage. Production code should reach this through
// `useAuditStore().clear()`.
export function writeClear(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

/* ── Hook ────────────────────────────────────────────────────────────────── */

export interface UseAuditStoreResult {
  state: AuditState;
  patch: (partial: Partial<AuditState>) => void;
  clear: () => void;
}

export function useAuditStore(): UseAuditStoreResult {
  const state = useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
  const patch = useCallback((partial: Partial<AuditState>) => writePatch(partial), []);
  const clear = useCallback(() => writeClear(), []);
  return { state, patch, clear };
}
