import { describe, it, expect } from "vitest";
import { AUDIT_SYSTEM_PROMPT, CATEGORIES, TOTAL_QUESTIONS, emptyAssessment } from "./agent";

describe("AUDIT_SYSTEM_PROMPT", () => {
  it("numbers the 13-question spine", () => {
    // The audit-v4 prompt keeps Q1–Q13 as the default order. Adaptive
    // skipping + follow-ups let the LLM take 10-16 turns instead, but
    // the spine is still 13. Don't pin the literal count in copy that
    // says "around 5 minutes" — just check the numbered list is there.
    for (let i = 1; i <= 13; i++) {
      expect(AUDIT_SYSTEM_PROMPT).toMatch(new RegExp(`\\b${i}\\.`));
    }
  });

  it("instructs the model not to emit think blocks", () => {
    // The prompt must explicitly tell the model to skip think/reasoning
    // blocks in its response. Check for the literal <think> tag reference
    // and a directive against chain-of-thought.
    expect(AUDIT_SYSTEM_PROMPT).toContain("<think>");
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
    // on every turn. The audit-v4 prompt adds pattern-callout beats on top
    // of the original short-phrase pool, so we expect at least 8 distinct
    // shapes now.
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

  it("documents adaptive question selection (skip / acknowledge)", () => {
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/adaptive/);
    expect(lower).toContain("skip");
    expect(lower).toContain("acknowledge");
    expect(lower).toContain("categoriescovered");
  });

  it("allows free-form follow-ups on rich answers", () => {
    // The audit-v4 agency: when an answer is rich, the LLM may ask ONE
    // short follow-up before moving on. Follow-ups do NOT advance
    // currentQuestion.
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/follow.?up/);
    expect(lower).toMatch(/rich|concrete/);
  });

  it("sets readyForEmail on the wrap condition", () => {
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("readyforemail");
    expect(lower).toMatch(/8.*categor|signal on|categories covered/);
  });

  it("forbids backtracking to covered categories", () => {
    // The audit is one-way. If a user volunteers info about a covered
    // category later, fold it into findings — never ask twice.
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/no backtrack|never revisit|one-way/);
  });

  it("instructs the model to trust the injected running assessment", () => {
    // The route injects `CURRENT_RUNNING_ASSESSMENT` every turn. The
    // prompt must reference it so the model reads prior state from
    // there instead of inventing it.
    expect(AUDIT_SYSTEM_PROMPT).toContain("CURRENT_RUNNING_ASSESSMENT");
  });
});

describe("CATEGORIES", () => {
  it("has 12 categories (10 original + tools + goal)", () => {
    expect(CATEGORIES).toHaveLength(12);
  });

  it("includes the new tools and goal categories", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(ids).toContain("tools");
    expect(ids).toContain("goal");
  });
});

describe("TOTAL_QUESTIONS", () => {
  it("is 13", () => {
    expect(TOTAL_QUESTIONS).toBe(13);
  });
});

describe("emptyAssessment", () => {
  it("starts at question 0 with no current category", () => {
    const a = emptyAssessment();
    expect(a.currentQuestion).toBe(0);
    expect(a.currentCategory).toBeUndefined();
  });

  it("starts with empty arrays and false flags", () => {
    const a = emptyAssessment();
    expect(a.scores).toEqual({});
    expect(a.findings).toEqual([]);
    expect(a.painPoints).toEqual([]);
    expect(a.manualTasks).toEqual([]);
    expect(a.categoriesCovered).toEqual([]);
    expect(a.messageCount).toBe(0);
    expect(a.readyForEmail).toBe(false);
  });
});
