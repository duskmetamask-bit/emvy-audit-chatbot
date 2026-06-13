import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EMPTY_AUDIT_STATE,
  parseAuditState,
  type AuditState,
  type Message,
  type Assessment,
  type ReportData,
} from "./use-audit-store";

function fullAssessment(): Assessment {
  return {
    businessName: "Dusk Plumbing",
    businessDescription: "residential + commercial plumbing in Sydney",
    teamSize: "5",
    industry: "trades",
    scores: { lead_capture: 2, booking: 3, comms: 4 },
    findings: [
      { category: "invoicing", text: "manual invoicing is painful", severity: "high" },
      { category: "ops", text: "no job tracker", severity: "medium" },
    ],
    painPoints: ["manual invoicing", "calls going to voicemail"],
    manualTasks: ["chasing payments", "writing quotes"],
    aiTools: "ChatGPT for emails",
    budget: "under 500/mo",
    goal: "automate follow-up",
    obstacles: "no time",
    messageCount: 7,
    categoriesCovered: ["lead_capture", "booking", "invoicing", "ops"],
    readyForEmail: true,
    currentQuestion: 4,
    currentCategory: "ops",
  };
}

function fullReport(): ReportData {
  return {
    score: 62,
    scoreLabel: "Moderate readiness",
    scoreBlurb: "Some good bones, a few obvious wins.",
    businessName: "Dusk Plumbing",
    industry: "trades",
    summary: "Dusk Plumbing has a solid lead flow but is leaking time on manual follow-up.",
    week1: ["Audit recurring copy-paste work", "Set up a shared roadmap doc", "Pick 1 to automate first"],
    weeks24: ["Ship the week 1 target end-to-end", "Automate invoice reminders"],
    months23: ["Layer AI into lead pipeline", "Quarterly roadmap refresh"],
    nextStep: "Book a free 15-min discovery call with EMVY at https://emvyai.com/services/discovery-call!",
  };
}

function fullState(): AuditState {
  return {
    version: 1,
    stage: "report",
    messages: [
      { role: "bot", content: "hey, ready when you are", timestamp: "09:00:00" },
      { role: "user", content: "Dusk Plumbing, residential plumbing, 5 of us", timestamp: "09:00:12" },
    ] as Message[],
    assessment: fullAssessment(),
    sessionId: "sess-abc-123",
    name: "Jake",
    email: "jake@duskplumbing.com.au",
    company: "Dusk Plumbing",
    report: fullReport(),
    chatbotLeadId: "lead-xyz-789",
    reportSent: true,
    startedAt: "2026-06-14T09:00:00.000Z",
    completedAt: "2026-06-14T09:08:32.000Z",
  };
}

describe("parseAuditState", () => {
  it("round-trips EMPTY_AUDIT_STATE", () => {
    const out = parseAuditState(EMPTY_AUDIT_STATE);
    expect(out).toEqual(EMPTY_AUDIT_STATE);
  });

  it("round-trips a fully-populated AuditState", () => {
    const original = fullState();
    const out = parseAuditState(original);
    expect(out).toEqual(original);
  });

  it("returns null for null / undefined / primitives", () => {
    expect(parseAuditState(null)).toBe(null);
    expect(parseAuditState(undefined)).toBe(null);
    expect(parseAuditState(42)).toBe(null);
    expect(parseAuditState("just a string")).toBe(null);
    expect(parseAuditState([])).toBe(null);
  });

  it("returns null for non-object values", () => {
    expect(parseAuditState("just a string")).toBe(null);
    expect(parseAuditState(42)).toBe(null);
    expect(parseAuditState(true)).toBe(null);
  });

  it("returns null for corrupt JSON inside the parsed object", () => {
    // The raw layer would have already called JSON.parse; this tests the
    // function with an already-parsed object that is structurally broken.
    expect(parseAuditState({ version: 1, stage: "welcome" })).toBe(null); // missing messages
    expect(parseAuditState({ version: 1, stage: "welcome", messages: "not an array" })).toBe(null);
  });

  it("rejects wrong field types", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, messages: "not an array" })).toBe(null);
    expect(parseAuditState({ ...base, reportSent: "yes" })).toBe(null);
    expect(parseAuditState({ ...base, stage: 123 })).toBe(null);
    expect(parseAuditState({ ...base, name: 42 })).toBe(null);
    expect(parseAuditState({ ...base, chatbotLeadId: 99 })).toBe(null);
    expect(parseAuditState({ ...base, startedAt: 1234567890 })).toBe(null);
  });

  it("rejects unknown stage values", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, stage: "launched" })).toBe(null);
    expect(parseAuditState({ ...base, stage: "" })).toBe(null);
    expect(parseAuditState({ ...base, stage: null })).toBe(null);
  });

  it("rejects messages with invalid role", () => {
    const base = fullState();
    const bad = { ...base, messages: [{ role: "system", content: "x" }] };
    expect(parseAuditState(bad)).toBe(null);
  });

  it("rejects messages with non-string content or bad optional fields", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, messages: [{ role: "user", content: 42 }] })).toBe(null);
    expect(parseAuditState({ ...base, messages: [{ role: "user", content: "x", timestamp: 9 }] })).toBe(null);
    expect(parseAuditState({ ...base, messages: [{ role: "user", content: "x", step: false }] })).toBe(null);
  });

  it("rejects version mismatches (forward-compat safety)", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, version: 2 })).toBe(null);
    expect(parseAuditState({ ...base, version: 0 })).toBe(null);
    expect(parseAuditState({ ...base, version: "1" })).toBe(null);
    expect(parseAuditState({ ...base, version: undefined })).toBe(null);
  });

  it("rejects assessment with bad enum values (severity is the load-bearing one for UI)", () => {
    const base = fullState();
    // The persistence layer is lenient on the `category` string — the LLM is
    // the source of truth and may invent new category labels. Severity is
    // strict because it drives the report's UI grouping.
    const lenientCategory = {
      ...base,
      assessment: {
        ...base.assessment,
        findings: [{ category: "fake_category", text: "x", severity: "high" }],
      },
    };
    expect(parseAuditState(lenientCategory)).not.toBe(null);

    const badSeverity = {
      ...base,
      assessment: {
        ...base.assessment,
        findings: [{ category: "invoicing", text: "x", severity: "extreme" }],
      },
    };
    expect(parseAuditState(badSeverity)).toBe(null);
  });

  it("rejects assessment with bad score values (non-integer, out of range, non-number)", () => {
    const base = fullState();
    const tooHigh = { ...base, assessment: { ...base.assessment, scores: { lead_capture: 6 } } };
    expect(parseAuditState(tooHigh)).toBe(null);
    const tooLow = { ...base, assessment: { ...base.assessment, scores: { lead_capture: -1 } } };
    expect(parseAuditState(tooLow)).toBe(null);
    const decimal = { ...base, assessment: { ...base.assessment, scores: { lead_capture: 3.5 } } };
    expect(parseAuditState(decimal)).toBe(null);
    const nan = { ...base, assessment: { ...base.assessment, scores: { lead_capture: "two" } } };
    expect(parseAuditState(nan)).toBe(null);
  });

  it("rejects assessment with bad currentQuestion (out of [0, 13], non-integer)", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: 14 } })).toBe(null);
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: -1 } })).toBe(null);
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: 7.5 } })).toBe(null);
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: "5" } })).toBe(null);
  });

  it("rejects reports with bad score bounds or missing fields", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, report: { ...fullReport(), score: 150 } })).toBe(null);
    expect(parseAuditState({ ...base, report: { ...fullReport(), score: -10 } })).toBe(null);
    expect(parseAuditState({ ...base, report: { ...fullReport(), score: 62.5 } })).toBe(null);
    expect(parseAuditState({ ...base, report: { ...fullReport(), week1: "not an array" } })).toBe(null);
    expect(parseAuditState({ ...base, report: { ...fullReport(), businessName: undefined } })).toBe(null);
  });

  it("accepts report === null", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, report: null })).not.toBe(null);
  });

  it("accepts chatbotLeadId === null", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, chatbotLeadId: null })).not.toBe(null);
  });

  it("accepts startedAt / completedAt === null", () => {
    const base = fullState();
    expect(parseAuditState({ ...base, startedAt: null, completedAt: null })).not.toBe(null);
  });

  it("accepts a fresh 'chat' stage with one message and minimal assessment", () => {
    const state: AuditState = {
      ...EMPTY_AUDIT_STATE,
      stage: "chat",
      messages: [{ role: "bot", content: "hey, ready when you are" }],
      assessment: { ...EMPTY_AUDIT_STATE.assessment, currentQuestion: 1, currentCategory: "lead_capture" },
    };
    expect(parseAuditState(state)).toEqual(state);
  });
});

/* ── Storage I/O (lastRaw cache + same-tab dispatch) ─────────────────────── */

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(i: number) {
      return Array.from(data.keys())[i] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("storage I/O", () => {
  let originalWindow: unknown;
  let originalGlobalStorage: unknown;
  let originalStorageEvent: unknown;

  beforeEach(() => {
    vi.resetModules();
    originalWindow = (globalThis as Record<string, unknown>).window;
    originalGlobalStorage = (globalThis as Record<string, unknown>).localStorage;
    originalStorageEvent = (globalThis as Record<string, unknown>).StorageEvent;
    // Stub StorageEvent as a no-op constructor — the node test env doesn't
    // have DOM globals, and writePatch() does `new StorageEvent("storage", ...)`
    // for same-tab subscriber notification.
    class StorageEventShim {
      type: string;
      key: string | null;
      constructor(type: string, init: { key?: string | null } = {}) {
        this.type = type;
        this.key = init.key ?? null;
      }
    }
    (globalThis as Record<string, unknown>).StorageEvent = StorageEventShim;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = originalWindow;
    }
    if (originalGlobalStorage === undefined) {
      delete (globalThis as Record<string, unknown>).localStorage;
    } else {
      (globalThis as Record<string, unknown>).localStorage = originalGlobalStorage;
    }
    if (originalStorageEvent === undefined) {
      delete (globalThis as Record<string, unknown>).StorageEvent;
    } else {
      (globalThis as Record<string, unknown>).StorageEvent = originalStorageEvent;
    }
  });

  it("does not crash with window === undefined (SSR safety)", async () => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
    // Re-import with the stubbed globals.
    const mod = await import("./use-audit-store");
    expect(() => mod.EMPTY_AUDIT_STATE).not.toThrow();
    // The hook would call getServerSnapshot during SSR; we just verify
    // the I/O functions are guarded by importing the module fresh.
    expect(mod.EMPTY_AUDIT_STATE.stage).toBe("welcome");
  });

  it("writePatch + writeClear: the second call removes the key and dispatches storage event", async () => {
    const memStorage = makeMemoryStorage();
    (globalThis as Record<string, unknown>).window = {
      localStorage: memStorage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).localStorage = memStorage;

    const mod = await import("./use-audit-store");
    mod.writePatch({ stage: "chat", sessionId: "abc" });
    expect(memStorage.getItem("emvy-audit-state:v1")).not.toBeNull();
    const written = JSON.parse(memStorage.getItem("emvy-audit-state:v1") as string);
    expect(written.stage).toBe("chat");
    expect(written.sessionId).toBe("abc");
    expect(written.version).toBe(1);

    mod.writeClear();
    expect(memStorage.getItem("emvy-audit-state:v1")).toBeNull();
  });

  it("writePatch merges with the existing state instead of overwriting", async () => {
    const memStorage = makeMemoryStorage();
    (globalThis as Record<string, unknown>).window = {
      localStorage: memStorage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).localStorage = memStorage;

    const mod = await import("./use-audit-store");
    mod.writePatch({ stage: "chat", name: "Jake" });
    mod.writePatch({ sessionId: "sess-1" });
    const written = JSON.parse(memStorage.getItem("emvy-audit-state:v1") as string);
    expect(written.stage).toBe("chat");
    expect(written.name).toBe("Jake");
    expect(written.sessionId).toBe("sess-1");
  });

  it("writePatch always writes version: 1, even if a stale payload is on disk", async () => {
    const memStorage = makeMemoryStorage();
    // Seed a corrupt payload — writePatch should still produce a valid v1.
    memStorage.setItem("emvy-audit-state:v1", "{ not json");
    (globalThis as Record<string, unknown>).window = {
      localStorage: memStorage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).localStorage = memStorage;

    const mod = await import("./use-audit-store");
    mod.writePatch({ stage: "email" });
    const written = JSON.parse(memStorage.getItem("emvy-audit-state:v1") as string);
    expect(written.version).toBe(1);
    expect(written.stage).toBe("email");
  });

  it("writePatch dispatches a synthetic StorageEvent for same-tab subscribers", async () => {
    const memStorage = makeMemoryStorage();
    const dispatchEvent = vi.fn();
    (globalThis as Record<string, unknown>).window = {
      localStorage: memStorage,
      dispatchEvent,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).localStorage = memStorage;

    const mod = await import("./use-audit-store");
    mod.writePatch({ stage: "chat" });
    expect(dispatchEvent).toHaveBeenCalled();
    const event = dispatchEvent.mock.calls[0]?.[0] as StorageEvent;
    expect(event.type).toBe("storage");
    expect(event.key).toBe("emvy-audit-state:v1");
  });

  it("writePatch swallows quota-exceeded / private-mode setItem errors silently", async () => {
    const throwingStorage: Storage = {
      ...makeMemoryStorage(),
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError");
      }),
    };
    const dispatchEvent = vi.fn();
    (globalThis as Record<string, unknown>).window = {
      localStorage: throwingStorage,
      dispatchEvent,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).localStorage = throwingStorage;

    const mod = await import("./use-audit-store");
    expect(() => mod.writePatch({ stage: "chat" })).not.toThrow();
    // The event still fires so same-tab subscribers re-read (and get EMPTY).
    expect(dispatchEvent).toHaveBeenCalled();
  });
});

describe("EMPTY_AUDIT_STATE", () => {
  it("has the welcome stage and zero progress", () => {
    expect(EMPTY_AUDIT_STATE.stage).toBe("welcome");
    expect(EMPTY_AUDIT_STATE.messages).toEqual([]);
    expect(EMPTY_AUDIT_STATE.assessment.scores).toEqual({});
    expect(EMPTY_AUDIT_STATE.assessment.messageCount).toBe(0);
    expect(EMPTY_AUDIT_STATE.assessment.readyForEmail).toBe(false);
  });

  it("has a v1 version stamp", () => {
    expect(EMPTY_AUDIT_STATE.version).toBe(1);
  });

  it("has null report + null chatbotLeadId + reportSent === false", () => {
    expect(EMPTY_AUDIT_STATE.report).toBe(null);
    expect(EMPTY_AUDIT_STATE.chatbotLeadId).toBe(null);
    expect(EMPTY_AUDIT_STATE.reportSent).toBe(false);
    expect(EMPTY_AUDIT_STATE.startedAt).toBe(null);
    expect(EMPTY_AUDIT_STATE.completedAt).toBe(null);
  });
});
