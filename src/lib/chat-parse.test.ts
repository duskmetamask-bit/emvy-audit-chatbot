import { describe, it, expect } from "vitest";
import {
  stripThinkBlocks,
  extractJsonObject,
  parseChatResponse,
  type ParsedChatResponse,
} from "./chat-parse";
import { emptyAssessment, Assessment } from "./agent";

function current(): Assessment {
  return {
    ...emptyAssessment(),
    scores: { lead_capture: 2 },
    findings: [],
    painPoints: ["existing pain"],
    manualTasks: [],
    categoriesCovered: ["lead_capture"],
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
      currentCategory: "lead_capture",
      assessment: {
        scores: { lead_capture: 2 },
        painPoints: ["manual invoicing"],
        categoriesCovered: ["lead_capture"],
        readyForEmail: false,
      },
    });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("hey, what's the business called?");
    expect(out!.currentQuestion).toBe(1);
    expect(out!.currentCategory).toBe("lead_capture");
    expect(out!.assessmentUpdate.scores).toEqual({ lead_capture: 2, invoicing: undefined });
  });

  it("strips a think block before parsing", () => {
    const raw =
      "<think>Let me greet and ask Q1.</think>" +
      JSON.stringify({
        message: "hey, ready when you are",
        currentQuestion: 1,
        currentCategory: "lead_capture",
        assessment: { categoriesCovered: ["lead_capture"] },
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

  it("clamps currentQuestion to 1-13", () => {
    const raw = JSON.stringify({ message: "q", currentQuestion: 99 });
    expect(parseChatResponse(raw, current())!.currentQuestion).toBe(13);
    const raw2 = JSON.stringify({ message: "q", currentQuestion: -2 });
    expect(parseChatResponse(raw2, current())!.currentQuestion).toBe(1);
    const raw3 = JSON.stringify({ message: "q", currentQuestion: 7 });
    expect(parseChatResponse(raw3, current())!.currentQuestion).toBe(7);
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

  it("merges scores into the current assessment", () => {
    const raw = JSON.stringify({
      message: "ok",
      assessment: { scores: { invoicing: 1, lead_capture: 4 } },
    });
    const c = current(); // lead_capture is 2
    const out = parseChatResponse(raw, c);
    expect(out).not.toBe(null);
    // existing lead_capture is overwritten by the new value
    expect(out!.assessmentUpdate.scores).toEqual({ lead_capture: 4, invoicing: 1 });
  });

  it("ignores scores outside 1-5 and preserves existing scores", () => {
    const raw = JSON.stringify({
      message: "ok",
      assessment: { scores: { invoicing: 0, lead_capture: 6, booking: 3.7 } },
    });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    // existing lead_capture: 2 is preserved, booking: 3.7 rounds to 4,
    // out-of-range values are dropped
    expect(out!.assessmentUpdate.scores).toEqual({ lead_capture: 2, booking: 4 });
  });

  it("extracts findings with severity defaulting to medium", () => {
    const raw = JSON.stringify({
      message: "ok",
      assessment: {
        findings: [
          { category: "invoicing", text: "manual invoicing is painful", severity: "high" },
          { category: "ops", text: "no job tracker" },
          { category: "ops", text: "weird", severity: "bogus" },
          { category: "ops" },
        ],
      },
    });
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    const findings = out!.assessmentUpdate.findings!;
    // 4 inputs; the entry without text is dropped
    expect(findings).toHaveLength(3);
    expect(findings[0]).toEqual({
      category: "invoicing",
      text: "manual invoicing is painful",
      severity: "high",
    });
    expect(findings[1]).toEqual({ category: "ops", text: "no job tracker", severity: "medium" });
    expect(findings[2]).toEqual({ category: "ops", text: "weird", severity: "medium" });
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

  it("handles real-shape output with think block + code fence + prose", () => {
    const raw =
      "<think>The user greeted me, I should ask Q1 now.</think>\n" +
      "```json\n" +
      JSON.stringify({
        message: "hey, ready when you are — what's the business called and what do you do?",
        currentQuestion: 1,
        currentCategory: "lead_capture",
        assessment: {
          businessName: "",
          scores: {},
          painPoints: [],
          manualTasks: [],
          findings: [],
          categoriesCovered: [],
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
    expect(out!.currentCategory).toBe("lead_capture");
  });

  it("falls back to prose when only a think block is present", () => {
    const raw = "<think>reasoning here</think>ok cool";
    const out = parseChatResponse(raw, current());
    expect(out).not.toBe(null);
    expect(out!.message).toBe("ok cool");
    expect(out!.assessmentUpdate).toEqual({});
  });
});
