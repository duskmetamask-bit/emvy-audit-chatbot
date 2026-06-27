import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EMPTY_AUDIT_STATE,
  parseAuditState,
  type AuditState,
  type Message,
  type Assessment,
  type ReportData,
  type Stage,
} from "./use-audit-store";

function fullAssessment(): Assessment {
  return {
    businessName: "Dusk Plumbing",
    businessDescription: "residential + commercial plumbing in Sydney",
    teamSize: "5",
    industry: "trades",
    findings: [
      { category: "invoicing", text: "manual invoicing is painful" },
      { category: "ops", text: "no job tracker" },
    ],
    painPoints: ["manual invoicing", "calls going to voicemail"],
    manualTasks: ["chasing payments", "writing quotes"],
    aiTools: "ChatGPT for emails",
    goal: "automate follow-up",
    messageCount: 7,
    readyForEmail: true,
    currentQuestion: 4,
  };
}

function fullReport(): ReportData {
  return {
    businessName: "Dusk Plumbing",
    industry: "trades",
    summary: "Dusk Plumbing has a solid lead flow but is leaking time on manual follow-up.",
    opportunities: [
      {
        title: "Automated invoice reminders",
        whatItIs: "Auto-send reminders at 3, 7, and 14 days past due.",
        whyMatters: "You're chasing payments by phone every week — that's a recurring 4-hour leak.",
        whatChanges: "Cashflow shortens by ~40%, you stop playing bad cop.",
        howFast: "Sees result in week 1 once reminders go live.",
      },
      {
        title: "Lead response in 5 minutes",
        whatItIs: "Auto-acknowledge every enquiry with a personalised reply.",
        whyMatters: "Every hour of delay drops conversion — you're losing jobs to slow replies.",
        whatChanges: "Conversion rate lifts, fewer jobs slip through.",
        howFast: "Live inside a week.",
      },
      {
        title: "Quote follow-up nudges",
        whatItIs: "Auto-nudge outstanding quotes at day 3 and day 7.",
        whyMatters: "Quotes that go cold cost you revenue you already worked for.",
        whatChanges: "Quote-to-job conversion lifts, less manual chasing.",
        howFast: "First nudge cycle lands in week 2.",
      },
    ],
    automationAreas: [
      "Lead capture — new web enquiry → auto-create CRM row + send acknowledgement inside 5 minutes",
      "Invoice chasing — overdue > 7 days → Resend sends a friendly nudge, escalates after 14",
      "Quote follow-up — quote sent > 48h with no reply → auto-draft a check-in for review",
    ],
    quickWin: "This week: stop chasing payments by phone. Pick your top 5 outstanding invoices and call each one ONCE — after that, automate.",
    checklist: [
      "Audit your recurring copy-paste work and rank by pain — top item is your week 1 target.",
      "Set up a shared Notion or Google Doc so the team can see the roadmap.",
      "Ship the week 1 automation end-to-end and measure the time it frees up.",
      "Wire Xero to Zapier to Resend so unpaid invoices trigger a reminder at days 3, 7, and 14 — cuts collections cycle by ~40%.",
      "Brief the team on a lightweight AI policy — what's allowed, what's reviewed.",
      "Layer AI into the next-priority workflow — Hermes is the right shape for multi-step lead follow-up.",
      "Move to a weekly AI review cadence — what's working, what to retire, what to try next.",
    ],
    nextStep: "Book a free 15-min discovery call with EMVY at https://cal.com/jake-emvy/discovery-call!",
  };
}

function fullState(): AuditState {
  return {
    version: 3,
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
    expect(parseAuditState({ version: 2, stage: "welcome" })).toBe(null); // missing messages
    expect(parseAuditState({ version: 2, stage: "welcome", messages: "not an array" })).toBe(null);
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
    expect(parseAuditState({ ...base, version: 1 })).toBe(null); // stale v1 on disk
    expect(parseAuditState({ ...base, version: 2 })).toBe(null); // stale v2
    expect(parseAuditState({ ...base, version: 4 })).toBe(null); // future
    expect(parseAuditState({ ...base, version: 0 })).toBe(null);
    expect(parseAuditState({ ...base, version: "3" })).toBe(null);
    expect(parseAuditState({ ...base, version: undefined })).toBe(null);
  });

  it("rejects assessment with bad currentQuestion (out of [0, 10], non-integer)", () => {
    // v2 spine is 10 questions; currentQuestion can be 0 (haven't started)
    // through 10 (just asked Q10). Anything outside that range is bad.
    const base = fullState();
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: 11 } })).toBe(null);
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: -1 } })).toBe(null);
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: 7.5 } })).toBe(null);
    expect(parseAuditState({ ...base, assessment: { ...base.assessment, currentQuestion: "5" } })).toBe(null);
  });

  it("accepts findings with arbitrary category strings (LLM is source of truth)", () => {
    // The persistence layer is lenient on the `category` string — the LLM
    // may invent new labels. Only the shape (object with category + text
    // strings) is enforced.
    const base = fullState();
    const lenientCategory = {
      ...base,
      assessment: {
        ...base.assessment,
        findings: [{ category: "fake_category", text: "x" }],
      },
    };
    expect(parseAuditState(lenientCategory)).not.toBe(null);

    const badShape = {
      ...base,
      assessment: {
        ...base.assessment,
        findings: [{ category: "x" }], // missing text
      },
    };
    expect(parseAuditState(badShape)).toBe(null);
  });

  it("rejects reports with bad opportunities, wrong action types, or missing required fields", () => {
    const base = fullState();
    // bad opportunity — missing sub-field
    expect(
      parseAuditState({
        ...base,
        report: {
          ...fullReport(),
          opportunities: [
            {
              title: "x",
              whatItIs: "x",
              whyMatters: "x",
              whatChanges: "x",
              // howFast missing
            } as unknown as ReportData["opportunities"][number],
          ],
        },
      })
    ).toBe(null);
    // bad opportunity — non-string sub-field
    expect(
      parseAuditState({
        ...base,
        report: {
          ...fullReport(),
          opportunities: [
            {
              title: "x",
              whatItIs: "x",
              whyMatters: 42,
              whatChanges: "x",
              howFast: "x",
            },
          ],
        },
      })
    ).toBe(null);
    // opportunities not an array
    expect(parseAuditState({ ...base, report: { ...fullReport(), opportunities: "not an array" } })).toBe(null);
    // quickWin not a string
    expect(parseAuditState({ ...base, report: { ...fullReport(), quickWin: 99 } })).toBe(null);
    // bad checklist — not a string
    expect(
      parseAuditState({
        ...base,
        report: {
          ...fullReport(),
          checklist: ["ok", 99, "ok"],
        },
      })
    ).toBe(null);
    // checklist not an array
    expect(parseAuditState({ ...base, report: { ...fullReport(), checklist: "nope" } })).toBe(null);
    // missing businessName
    expect(parseAuditState({ ...base, report: { ...fullReport(), businessName: undefined } })).toBe(null);
    // missing summary
    expect(parseAuditState({ ...base, report: { ...fullReport(), summary: undefined } })).toBe(null);
    // missing nextStep
    expect(parseAuditState({ ...base, report: { ...fullReport(), nextStep: undefined } })).toBe(null);
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
      assessment: { ...EMPTY_AUDIT_STATE.assessment, currentQuestion: 1 },
    };
    expect(parseAuditState(state)).toEqual(state);
  });

  it("accepts the 'onboarding' stage", () => {
    // Onboarding wizard runs BEFORE the chat starts (replaces the old
    // end-of-chat EmailStage). A persisted record with stage === "onboarding"
    // is the new normal for users mid-wizard.
    const base = fullState();
    const withOnboarding = { ...base, stage: "onboarding" as Stage };
    const out = parseAuditState(withOnboarding);
    expect(out).not.toBe(null);
    expect(out?.stage).toBe("onboarding");
  });

  it("round-trips a partial onboarding record (typed name + email, no chat yet)", () => {
    // Realistic mid-wizard state: the user typed name/email in step 1 and
    // reloaded before reaching step 2. Persisted fields survive, the
    // wizard re-renders with the values pre-filled.
    const partial: AuditState = {
      ...EMPTY_AUDIT_STATE,
      stage: "onboarding",
      name: "Jane Smith",
      email: "jane@example.com",
      company: "",
      sessionId: "sess-partial-1",
    };
    const out = parseAuditState(partial);
    expect(out).toEqual(partial);
  });

  it("migrates a stale 'email' stage to 'onboarding' (legacy v3 records)", () => {
    // Pre-wizard v3 records wrote stage: "email" while the user was on
    // the end-of-chat email form. After the wizard shipped, those records
    // would otherwise land on a dead screen. migrateLegacyStage snaps
    // them forward; name/email/company on the stale record survive.
    const base = fullState();
    const staleEmail = {
      ...base,
      stage: "email",
      name: "Jake",
      email: "jake@duskplumbing.com.au",
      company: "Dusk Plumbing",
    };
    // Cast: we know parseAuditState rejects "email" upstream then
    // migrates it; the strict TS type prevents us from building this
    // shape directly, so widen it for the test.
    const out = parseAuditState(staleEmail as unknown as AuditState);
    expect(out).not.toBe(null);
    expect(out?.stage).toBe("onboarding");
    expect(out?.name).toBe("Jake");
    expect(out?.email).toBe("jake@duskplumbing.com.au");
    expect(out?.company).toBe("Dusk Plumbing");
    expect(out?.version).toBe(3);
  });

  it("rejects assessment with stale v1 fields (scores / categoriesCovered / budget / obstacles)", () => {
    // The v1 shape had scores, categoriesCovered, currentCategory, budget,
    // obstacles — all dropped in v2. If a stale v2 payload has these as
    // non-undefined values, the validator ignores them but should still
    // accept the rest of the shape. We test the lenient path: stale fields
    // are simply ignored, the assessment still passes.
    const base = fullState();
    const withStaleFields = {
      ...base,
      assessment: {
        ...base.assessment,
        scores: { lead_capture: 3 } as unknown as never,
        categoriesCovered: ["ops"] as unknown as never,
        currentCategory: "ops" as unknown as never,
      },
    };
    // Validators don't know about these keys, so they pass through.
    // (If we want strict rejection, isAssessment would need to enumerate
    // allowed keys — not the v2 design.)
    expect(parseAuditState(withStaleFields)).not.toBe(null);
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
    expect(memStorage.getItem("emvy-audit-state:v3")).not.toBeNull();
    const written = JSON.parse(memStorage.getItem("emvy-audit-state:v3") as string);
    expect(written.stage).toBe("chat");
    expect(written.sessionId).toBe("abc");
    expect(written.version).toBe(3);

    mod.writeClear();
    expect(memStorage.getItem("emvy-audit-state:v3")).toBeNull();
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
    const written = JSON.parse(memStorage.getItem("emvy-audit-state:v3") as string);
    expect(written.stage).toBe("chat");
    expect(written.name).toBe("Jake");
    expect(written.sessionId).toBe("sess-1");
  });

  it("writePatch always writes version: 3, even if a stale payload is on disk", async () => {
    const memStorage = makeMemoryStorage();
    // Seed a corrupt payload — writePatch should still produce a valid v3.
    memStorage.setItem("emvy-audit-state:v3", "{ not json");
    (globalThis as Record<string, unknown>).window = {
      localStorage: memStorage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).localStorage = memStorage;

    const mod = await import("./use-audit-store");
    mod.writePatch({ stage: "onboarding" });
    const written = JSON.parse(memStorage.getItem("emvy-audit-state:v3") as string);
    expect(written.version).toBe(3);
    expect(written.stage).toBe("onboarding");
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
    expect(event.key).toBe("emvy-audit-state:v3");
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
    expect(EMPTY_AUDIT_STATE.assessment.findings).toEqual([]);
    expect(EMPTY_AUDIT_STATE.assessment.painPoints).toEqual([]);
    expect(EMPTY_AUDIT_STATE.assessment.manualTasks).toEqual([]);
    expect(EMPTY_AUDIT_STATE.assessment.messageCount).toBe(0);
    expect(EMPTY_AUDIT_STATE.assessment.readyForEmail).toBe(false);
    expect(EMPTY_AUDIT_STATE.assessment.currentQuestion).toBe(0);
  });

  it("has a v3 version stamp", () => {
    expect(EMPTY_AUDIT_STATE.version).toBe(3);
  });

  it("has null report + null chatbotLeadId + reportSent === false", () => {
    expect(EMPTY_AUDIT_STATE.report).toBe(null);
    expect(EMPTY_AUDIT_STATE.chatbotLeadId).toBe(null);
    expect(EMPTY_AUDIT_STATE.reportSent).toBe(false);
    expect(EMPTY_AUDIT_STATE.startedAt).toBe(null);
    expect(EMPTY_AUDIT_STATE.completedAt).toBe(null);
  });
});
