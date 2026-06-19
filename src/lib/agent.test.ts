import { describe, it, expect } from "vitest";
import { AUDIT_SYSTEM_PROMPT, QUESTIONS, REPORT_SYSTEM_PROMPT, TOTAL_QUESTIONS, emptyAssessment } from "./agent";

describe("AUDIT_SYSTEM_PROMPT", () => {
  it("numbers the 10-question spine", () => {
    // The v2 prompt keeps Q1–Q10 as the default order. Adaptive skipping
    // + follow-ups let the LLM take more turns, but the spine is 10.
    for (let i = 1; i <= 10; i++) {
      expect(AUDIT_SYSTEM_PROMPT).toMatch(new RegExp(`\\b${i}\\.`));
    }
  });

  it("instructs the model not to emit think blocks", () => {
    // The prompt must explicitly tell the model to skip think/reasoning
    // blocks in its response. Check for the literal think tag reference
    // and a directive against chain-of-thought.
    expect(AUDIT_SYSTEM_PROMPT).toContain("think");
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("chain-of-thought");
    expect(lower).toContain("reasoning");
  });

  it("requires currentQuestion in the JSON output", () => {
    expect(AUDIT_SYSTEM_PROMPT).toContain("currentQuestion");
  });

  it("defines the voice as plain and Australian", () => {
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("casual");
    expect(lower).toContain("australia");
  });

  it("provides a rotation pool of reaction beats", () => {
    // The opener pool is what stops the model defaulting to "cool" / "right"
    // on every turn. Keep at least 8 distinct shapes.
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    const beats = ["cool", "right", "got it", "fair", "noted", "yep", "mm", "makes sense"];
    const found = beats.filter((b) => lower.includes(b));
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it("enforces anti-repetition on reaction beats", () => {
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/anti-?repetition|never start two|consecutive beats?/);
  });

  it("documents a pattern-callout beat shape (use sparingly)", () => {
    // Shape C — the personality move. Should be flagged as rare so the
    // model doesn't over-deploy it. Look for "pattern" + a "sparingly" /
    // "use" / "once every" qualifier.
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("pattern");
    expect(lower).toMatch(/sparingly|use.*(?:once|rare)|max.*(?:once|3|4)/);
  });

  it("allows free-form follow-ups on rich answers", () => {
    // The audit agency: when an answer is rich, the LLM may ask ONE
    // short follow-up before moving on. Follow-ups do NOT advance
    // currentQuestion.
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/follow.?up/);
    expect(lower).toMatch(/rich|concrete/);
  });

  it("sets readyForEmail on the wrap condition", () => {
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("readyforemail");
    expect(lower).toMatch(/8.*(?:signal|answer|substantive)|signal on|questions? covered/);
  });

  it("forbids backtracking to covered topics", () => {
    // The audit is one-way. If a user volunteers info about a covered
    // topic later, fold it into findings — never ask twice.
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/no backtrack|never revisit|one-way/);
  });
});

describe("QUESTIONS", () => {
  it("has 10 questions numbered 1–10", () => {
    expect(QUESTIONS).toHaveLength(10);
    expect(QUESTIONS.map((q) => q.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("each question has a prompt and an intent", () => {
    for (const q of QUESTIONS) {
      expect(q.prompt.length).toBeGreaterThan(10);
      expect(q.intent.length).toBeGreaterThan(10);
    }
  });
});

describe("TOTAL_QUESTIONS", () => {
  it("matches QUESTIONS.length", () => {
    expect(TOTAL_QUESTIONS).toBe(QUESTIONS.length);
    expect(TOTAL_QUESTIONS).toBe(10);
  });
});

describe("emptyAssessment", () => {
  it("starts at question 0", () => {
    const a = emptyAssessment();
    expect(a.currentQuestion).toBe(0);
  });

  it("starts with empty arrays and false flags", () => {
    const a = emptyAssessment();
    expect(a.findings).toEqual([]);
    expect(a.painPoints).toEqual([]);
    expect(a.manualTasks).toEqual([]);
    expect(a.messageCount).toBe(0);
    expect(a.readyForEmail).toBe(false);
  });
});

describe("REPORT_SYSTEM_PROMPT", () => {
  it("requires the 5-section envelope shape", () => {
    // The v3 report is: summary, opportunities, quickWin, checklist, nextStep.
    // `checklist` replaces `first90Days` from v2 — flat string[], no phasing.
    for (const key of ["summary", "opportunities", "quickWin", "checklist", "nextStep"]) {
      expect(REPORT_SYSTEM_PROMPT).toContain(`"${key}"`);
    }
  });

  it("requires exactly 3 opportunities, each with 4 sub-fields", () => {
    expect(REPORT_SYSTEM_PROMPT).toContain("Exactly 3 opportunities");
    for (const key of ["whatItIs", "whyMatters", "whatChanges", "howFast"]) {
      expect(REPORT_SYSTEM_PROMPT).toContain(`"${key}"`);
    }
  });

  it("specifies the flat 30-day checklist (no 30/60/90 phasing)", () => {
    expect(REPORT_SYSTEM_PROMPT).toContain("checklist");
    expect(REPORT_SYSTEM_PROMPT).toContain("30 days");
    expect(REPORT_SYSTEM_PROMPT).toContain("5-7 string items");
    // v3 explicitly drops the 3-phase phasing. Guard against regression
    // back to the v2 shape.
    expect(REPORT_SYSTEM_PROMPT).not.toContain("Days 60-90");
  });

  it("names Hermes as an available tool", () => {
    // Hermes is EMVY's own agent platform — recommended in v3 for
    // multi-step reasoning loops (e.g. lead follow-up, scheduling).
    expect(REPORT_SYSTEM_PROMPT).toContain("Hermes");
  });

  it("lets the LLM pick between EMVY CTA and honest 'come back when'", () => {
    expect(REPORT_SYSTEM_PROMPT).toContain("come back when");
    expect(REPORT_SYSTEM_PROMPT).toContain("discovery call");
  });
});
