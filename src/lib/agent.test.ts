import { describe, it, expect } from "vitest";
import { AUDIT_SYSTEM_PROMPT, CATEGORIES, TOTAL_QUESTIONS, emptyAssessment } from "./agent";

describe("AUDIT_SYSTEM_PROMPT", () => {
  it("declares exactly 13 mini-audit questions", () => {
    // The list uses " 1." through "13." with a space prefix. The closing
    // section references "Q13" in the email transition.
    for (let i = 1; i <= 13; i++) {
      expect(AUDIT_SYSTEM_PROMPT).toMatch(new RegExp(`\\b${i}\\.`));
    }
    expect(AUDIT_SYSTEM_PROMPT).toContain("Q13");
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
    // on every turn. Check that at least 5 distinct beat shapes are listed.
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    const beats = ["cool", "right", "got it", "fair", "noted", "yep", "mm", "makes sense"];
    const found = beats.filter((b) => lower.includes(b));
    expect(found.length).toBeGreaterThanOrEqual(5);
  });

  it("enforces anti-repetition on reaction beats", () => {
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/anti-?repetition|never start two|consecutive beats?/);
  });

  it("documents adaptive question selection (skip / acknowledge)", () => {
    const lower = AUDIT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/adaptive/);
    expect(lower).toContain("skip");
    expect(lower).toContain("acknowledge");
    expect(lower).toContain("categoriescovered");
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
