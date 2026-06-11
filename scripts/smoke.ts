// scripts/smoke.ts — end-to-end smoke test for the audit chat.
// Walks the bot through several turns, asserts the response shape and
// the new currentQuestion/currentCategory tracking, and prints a
// transcript. Requires MINIMAX_API_KEY in the environment.
//
// Run with: npx tsx scripts/smoke.ts
//   (or)   node --import tsx scripts/smoke.ts
//
// This is not a unit test — it talks to the real LLM. It belongs in
// scripts/, not in the vitest suite.

import { chatCompletion } from "../src/lib/llm";
import { AUDIT_SYSTEM_PROMPT, emptyAssessment, Assessment } from "../src/lib/agent";
import { parseChatResponse } from "../src/lib/chat-parse";

interface Turn {
  user: string;
}

const TURNS: Turn[] = [
  { user: "hey, ready when you are" },
  { user: "Dusk Plumbing, residential and small commercial, 4 of us, based in Brisbane" },
  { user: "mostly word of mouth and a few google ads, calls come into my mobile" },
  { user: "i just write jobs into my head, no calendar, customers ring me to book" },
];

async function main() {
  if (!process.env.MINIMAX_API_KEY) {
    console.error("MINIMAX_API_KEY not set");
    process.exit(1);
  }

  const assessment: Assessment = { ...emptyAssessment() };
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  console.log("\n=== Mini AI Audit smoke test ===\n");
  for (const turn of TURNS) {
    console.log("USER:", turn.user);

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: AUDIT_SYSTEM_PROMPT },
      {
        role: "system",
        content:
          "CURRENT_RUNNING_ASSESSMENT (update this in every response, set currentQuestion to the number of the question you just asked):\n" +
          JSON.stringify(assessment, null, 2),
      },
      ...history.map((m) => ({ role: m.role, content: m.content } as const)),
      { role: "user", content: turn.user },
    ];

    const t0 = Date.now();
    const response = await chatCompletion({ messages, temperature: 0.7, maxTokens: 1024 }, process.env);
    const ms = Date.now() - t0;

    const raw = response.choices?.[0]?.message?.content ?? "";
    const parsed = parseChatResponse(raw, assessment);

    if (!parsed) {
      console.error("  -> parser returned null. Raw response was:\n", raw);
      process.exit(2);
    }

    console.log("  ->", parsed.message);
    console.log(
      `  (q${parsed.currentQuestion ?? "?"} of 13 · ${parsed.currentCategory ?? "?"} · ${ms}ms)`
    );
    if (raw.includes("<think>")) {
      console.warn("  WARN: raw response still contains <think> tags after parsing");
    }

    Object.assign(assessment, parsed.assessmentUpdate);
    if (parsed.currentQuestion !== undefined) assessment.currentQuestion = parsed.currentQuestion;
    if (parsed.currentCategory !== undefined) assessment.currentCategory = parsed.currentCategory;
    assessment.messageCount = history.filter((m) => m.role === "user").length + 1;

    history.push({ role: "user", content: turn.user });
    history.push({ role: "assistant", content: parsed.message });
    console.log();
  }

  console.log("=== Final assessment ===");
  console.log(JSON.stringify(assessment, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
