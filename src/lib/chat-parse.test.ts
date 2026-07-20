import { describe, it, expect } from "vitest";
import {
  stripThinkBlocks,
  extractJsonObject,
  parseChatResponse,
} from "./chat-parse";
import { emptyAssessment, Assessment } from "./agent";

function current(): Assessment {
  return {
    ...emptyAssessment(),
    findings: [],
    painPoints: ["existing pain"],
    manualTasks: [],
    messageCount: 1,
    readyForEmail: false,
  };
}

describe("stripThinkBlocks", () => {
  it("removes a single think block", () => {
    const raw = "<think>the user said hi</think>hey there";
    expect(stripThinkBlocks(raw)).toBe("hey there");
  });

  it("removes a multiline think block", () => {
    const raw =
      "<think>\nThe user greeted me. I should greet back and ask Q1.\nLet me draft the response.\n</think>hey, ready when you are — what's the business called?";
    const out = stripThinkBlocks(raw);
    expect(out).not.toContain("think");
    expect(out).toBe("hey, ready when you are — what's the business called?");
  });

  it("removes multiple think blocks", () => {
    const raw = "<think>first thought</think>hello<think>second thought</think>there";
    expect(stripThinkBlocks(raw)).toBe("hellothere");
  });

  it("removes <think?> tag variant (M2.7 emits with literal `?` in opening tag)", () => {
    expect(stripThinkBlocks("<think>reasoning here</think>ok cool")).toBe("ok cool");
    expect(
      stripThinkBlocks("<think>\nThe user greeted me. I should greet back and ask Q1.\nLet me draft the response.\n</think>hey there")
    ).toBe("hey there");
  });

  it("removes reasoning and thinking tags too", () => {
    expect(stripThinkBlocks("<reasoning>x</reasoning>ok")).toBe("ok");
    expect(stripThinkBlocks("<thinking>x</thinking>ok")).toBe("ok");
  });

  it("is case-insensitive", () => {
    expect(stripThinkBlocks("<THINK>x</THINK>ok")).toBe("ok");
    expect(stripThinkBlocks("<Think>x</Think>ok")).toBe("ok");
  });

  it("leaves content without think blocks alone", () => {
    expect(stripThinkBlocks("just a regular reply")).toBe("just a regular reply");
  });
});

describe("extractJsonObject", () => {
  it("extracts a simple JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("handles nested objects", () => {
    const raw = '{"a":{"b":2,"c":{"d":3}}}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("handles strings with braces inside", () => {
    const raw = '{"msg":"hello {world}","x":1}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("handles escaped quotes in strings", () => {
    const raw = '{"msg":"he said \\"hi\\"","x":1}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("extracts JSON with prose prefix", () => {
    const raw = 'prefix text\n{"a":1}';
    expect(extractJsonObject(raw)).toBe('{"a":1}');
  });

  it("returns null if no JSON present", () => {
    expect(extractJsonObject("just text")).toBe(null);
  });
});

describe("parseChatResponse", () => {
  it("parses a clean response with message + assessment", () => {
    const raw = JSON.stringify({
      message: "hey, what's the business called?",
      currentQuestion: 1,
      assessment: {
        painPoints: ["manual invoicing"],
        readyForEmail: false,
      },
    });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("hey, what's the business called?");
    expect(out!.currentQuestion).toBe(1);
    expect(out!.assessmentUpdate.painPoints).toEqual(["manual invoicing"]);
  });

  it("strips a think block before parsing", () => {
    const raw =
      "<think>Let me greet and ask Q1.</think>" +
      JSON.stringify({
        message: "hey, ready when you are",
        currentQuestion: 1,
        assessment: {},
      });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("hey, ready when you are");
  });

  it("falls back to prose around the JSON when message field is missing", () => {
    const raw = 'hey, ready when you are\n{"currentQuestion":1}';
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("hey, ready when you are");
  });

  it("extracts the message from JSON even when wrapped in code fences", () => {
    const raw = "```json\n" + JSON.stringify({ message: "hi", currentQuestion: 1 }) + "\n```";
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("hi");
  });

  it("clamps currentQuestion to 1-10 (the v2 spine)", () => {
    // v2 spine is 10 questions; follow-up turns stay on the same number.
    // Anything outside 1-10 is clamped.
    const raw = JSON.stringify({ message: "q", currentQuestion: 99 });
    expect(parseChatResponse(raw, current())!.currentQuestion).toBe(10);
    const raw2 = JSON.stringify({ message: "q", currentQuestion: -2 });
    expect(parseChatResponse(raw2, current())!.currentQuestion).toBe(1);
    const raw3 = JSON.stringify({ message: "q", currentQuestion: 7 });
    expect(parseChatResponse(raw3, current())!.currentQuestion).toBe(7);
    const raw4 = JSON.stringify({ message: "q", currentQuestion: 1 });
    expect(parseChatResponse(raw4, current())!.currentQuestion).toBe(1);
    const raw5 = JSON.stringify({ message: "q", currentQuestion: 10 });
    expect(parseChatResponse(raw5, current())!.currentQuestion).toBe(10);
  });

  it("falls back to prose when no JSON is present", () => {
    const out = parseChatResponse("just a plain reply with no json", current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("just a plain reply with no json");
    expect(out!.assessmentUpdate).toEqual({});
    expect(out!.currentQuestion).toBeUndefined();
  });

  it("falls back to prose when JSON is malformed", () => {
    const out = parseChatResponse("{not valid json}", current());
    expect(out).not.toBe(null);
    // The malformed JSON has prose "not valid json" inside the braces
    expect(out!.message).toContain("not valid json");
    expect(out!.assessmentUpdate).toEqual({});
  });

  it("recovers the message field when JSON.parse fails due to unescaped quote in body", () => {
    // M2.7 sometimes emits a `"` inside the message body without escaping
    // it (e.g. apostrophes written as `"'` rather than `'`). The whole
    // envelope is then invalid JSON, but the message field is still
    // there — extract it permissively rather than dumping the envelope
    // into the bubble.
    const broken =
      '{"message":"got it — residential emergency and renos, that\'s a good mix. ok, first question: what eats your time?","currentQuestion":2,"assessment":{"businessName":"plumbing"}}';
    const out = parseChatResponse(broken, current());
    expect(out).not.toBe(null);
    expect(out!.message).not.toMatch(/^\{/);
    expect(out!.message).not.toContain('"message"');
    expect(out!.message).toContain("got it");
    expect(out!.message).toContain("residential emergency");
  });

  it("recovers the message field when surrounding envelope has trailing garbage", () => {
    // Even more degenerate: model emits the JSON with extra prose AFTER
    // the closing brace (which makes the brace-walker balance but
    // JSON.parse fails for an unrelated reason).
    const broken =
      '{"message":"hey there, ready when you are","currentQuestion":1,"assessment":{}} trailing prose that breaks parse';
    const out = parseChatResponse(broken, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("hey there, ready when you are");
  });

  it("extracts findings without severity (v2 dropped the field)", () => {
    const raw = JSON.stringify({
      message: "ok",
      assessment: {
        findings: [
          { category: "invoicing", text: "manual invoicing is painful" },
          { category: "ops", text: "no job tracker" },
          { category: "ops" }, // missing text — dropped (text is the load-bearing field)
          { category: 42, text: "bad category falls back to ops" }, // bad category → "ops" fallback, kept
        ],
      },
    });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    const findings = out!.assessmentUpdate.findings!;
    // Only the missing-text entry is dropped; the bad-category entry
    // keeps its text and falls back to category: "ops".
    expect(findings).toHaveLength(3);
    expect(findings[0]).toEqual({ category: "invoicing", text: "manual invoicing is painful" });
    expect(findings[1]).toEqual({ category: "ops", text: "no job tracker" });
    expect(findings[2]).toEqual({ category: "ops", text: "bad category falls back to ops" });
  });

  it("tolerates assessment fields at the top level of the JSON", () => {
    const raw = JSON.stringify({
      message: "ok",
      businessName: "Dusk Plumbing",
      teamSize: "5",
      currentQuestion: 3,
    });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.assessmentUpdate.businessName).toBe("Dusk Plumbing");
    expect(out!.assessmentUpdate.teamSize).toBe("5");
    expect(out!.currentQuestion).toBe(3);
  });

  it("preserves painPoints only when non-empty", () => {
    const emptyRaw = JSON.stringify({ message: "ok", assessment: { painPoints: [] } });
    expect(parseChatResponse(emptyRaw, current())!.assessmentUpdate.painPoints).toBeUndefined();

    const filledRaw = JSON.stringify({ message: "ok", assessment: { painPoints: ["x", "y"] } });
    expect(parseChatResponse(filledRaw, current())!.assessmentUpdate.painPoints).toEqual(["x", "y"]);
  });

  it("does not overwrite a wizard-set businessName with an LLM-supplied value", () => {
    // The wizard sets businessName from the company field. M2.7 will
    // often echo "the user" or "your business" in its businessName
    // field — those are obvious noise and must not replace the
    // wizard-supplied name. If the wizard didn't set one (skipped or
    // failed), the LLM value is allowed through.
    const filled = {
      ...emptyAssessment(),
      businessName: "Smith Plumbing",
      findings: [],
      painPoints: [],
      manualTasks: [],
      messageCount: 1,
      readyForEmail: false,
    };
    const raw = JSON.stringify({
      message: "ok",
      assessment: { businessName: "the user" },
    });
    const out = parseChatResponse(raw, filled)!;
    expect(out.assessmentUpdate.businessName).toBeUndefined();

    const empty = { ...emptyAssessment(), businessName: "" } as Assessment;
    const raw2 = JSON.stringify({
      message: "ok",
      assessment: { businessName: "Dusk Plumbing" },
    });
    const out2 = parseChatResponse(raw2, empty)!;
    expect(out2.assessmentUpdate.businessName).toBe("Dusk Plumbing");
  });

  it("drops removed v1 fields (scores, categoriesCovered, currentCategory, budget, obstacles)", () => {
    // The v1 LLM may have leaked scores / categoriesCovered etc. The v2
    // parser ignores them — they never reach the assessment update.
    const raw = JSON.stringify({
      message: "ok",
      scores: { lead_capture: 4 },
      categoriesCovered: ["lead_capture"],
      currentCategory: "lead_capture",
      budget: "500/mo",
      obstacles: "no time",
      assessment: {
        scores: { invoicing: 3 },
        categoriesCovered: ["invoicing"],
        budget: "500/mo",
        obstacles: "no time",
      },
    });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    const update = out!.assessmentUpdate as Record<string, unknown>;
    expect(update.scores).toBeUndefined();
    expect(update.categoriesCovered).toBeUndefined();
    expect(update.currentCategory).toBeUndefined();
    expect(update.budget).toBeUndefined();
    expect(update.obstacles).toBeUndefined();
  });

  it("handles real-shape output with think block + code fence + prose", () => {
    const raw =
      "<think>The user greeted me, I should ask Q1 now.</think>\n" +
      "```json\n" +
      JSON.stringify({
        message: "hey, ready when you are — what's the business called and what do you do?",
        currentQuestion: 1,
        assessment: {
          businessName: "",
          painPoints: [],
          manualTasks: [],
          findings: [],
          readyForEmail: false,
        },
      }, null, 2) +
      "\n```";
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe(
      "hey, ready when you are — what's the business called and what do you do?"
    );
    expect(out!.currentQuestion).toBe(1);
  });

  it("falls back to prose when only a think block is present", () => {
    const raw = "<think>reasoning here</think>ok cool";
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("ok cool");
    expect(out!.assessmentUpdate).toEqual({});
  });
});
