// Quick v2 smoke for the JSON-envelope fix. Mirrors the new /api/chat
// shape: reminder system message + JSON-wrapped assistant history. Walks
// 6 turns to catch the M2.7 turn-2/3/4 envelope drop. Asserts that
// readyForEmail flips to true at the wrap turn.

import { chatCompletion } from "../src/lib/llm";
import { AUDIT_SYSTEM_PROMPT, emptyAssessment, Assessment, TOTAL_QUESTIONS } from "../src/lib/agent";
import { parseChatResponse } from "../src/lib/chat-parse";

interface Turn { user: string }

const TURNS: Turn[] = [
  { user: "hey, ready when you are" },
  { user: "Dusk Plumbing, residential and small commercial, 4 of us, based in Brisbane" },
  { user: "invoicing in xero, chasing payments over the phone, takes 3 hours a week" },
  { user: "leads come in via google ads and word of mouth, i ring them back same day" },
  { user: "once they say yes i just book it in my head, no calendar system" },
  { user: "yeah i want to automate the invoicing chase, and stop losing leads to slow follow-up" },
];

async function main() {
  if (!process.env.MINIMAX_API_KEY) {
    console.error("MINIMAX_API_KEY not set");
    process.exit(1);
  }

  const assessment: Assessment = { ...emptyAssessment() };
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  console.log("\n=== JSON-envelope smoke (v2) ===\n");
  let envelopeDrops = 0;

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    console.log(`--- Turn ${i + 1} ---`);
    console.log("USER:", turn.user);

    const messages = [
      { role: "system" as const, content: AUDIT_SYSTEM_PROMPT },
      {
        role: "system" as const,
        content:
          "REMINDER: respond ONLY with a single JSON object. First char `{`, last char `}`. " +
          "No prose outside the braces. No `think` blocks. No reasoning. No code fences. " +
          "If you cannot form JSON, slow down internally and emit JSON — prose is the failure path.",
      },
      {
        role: "system" as const,
        content:
          "CURRENT_RUNNING_ASSESSMENT (update this in every response, set currentQuestion to the number of the question you just asked):\n" +
          JSON.stringify(assessment, null, 2),
      },
      ...history.map((m) => {
        if (m.role === "assistant") {
          return {
            role: "assistant" as const,
            content: JSON.stringify({
              message: m.content,
              currentQuestion: assessment.currentQuestion,
              assessment,
            }),
          };
        }
        return { role: "user" as const, content: m.content };
      }),
      { role: "user" as const, content: turn.user },
    ];

    const t0 = Date.now();
    const response = await chatCompletion({ messages, temperature: 0.7, maxTokens: 1500 });
    const ms = Date.now() - t0;

    const raw = response.choices?.[0]?.message?.content ?? "";
    const parsed = parseChatResponse(raw, assessment);

    if (!parsed) {
      console.error("  -> parser returned null. Raw response was:\n", raw);
      process.exit(2);
    }

    // Envelope drop detection: parsed.assessmentUpdate is empty (no
    // assessment fields updated) AND no currentQuestion bumped.
    const hasEnvelope =
      Object.keys(parsed.assessmentUpdate).length > 0 ||
      parsed.currentQuestion !== undefined;
    if (!hasEnvelope) {
      envelopeDrops++;
      console.warn("  WARN: envelope drop (no assessment fields + no currentQuestion bump)");
    }

    console.log("  ->", parsed.message.slice(0, 120) + (parsed.message.length > 120 ? "..." : ""));
    console.log(
      `  (q${parsed.currentQuestion ?? "?"}/${TOTAL_QUESTIONS} · readyForEmail=${assessment.readyForEmail || parsed.assessmentUpdate.readyForEmail || false} · ${ms}ms)`
    );

    Object.assign(assessment, parsed.assessmentUpdate);
    if (parsed.currentQuestion !== undefined) assessment.currentQuestion = parsed.currentQuestion;
    assessment.messageCount = history.filter((m) => m.role === "user").length + 1;

    history.push({ role: "user", content: turn.user });
    history.push({ role: "assistant", content: parsed.message });
    console.log();
  }

  console.log("=== Final assessment ===");
  console.log(JSON.stringify(assessment, null, 2));
  console.log(`\nEnvelope drops: ${envelopeDrops} / ${TURNS.length}`);
  console.log(`readyForEmail: ${assessment.readyForEmail}`);
  console.log(`currentQuestion: ${assessment.currentQuestion}`);

  if (!assessment.readyForEmail) {
    console.error("\nFAIL: readyForEmail is false at end of smoke — wrap message didn't set the flag.");
    process.exit(3);
  }
  if (envelopeDrops > 0) {
    console.warn(`\nWARN: ${envelopeDrops} envelope drop(s) detected. Fix did not eliminate the quirk.`);
  }
  console.log("\nPASS: wrap fired, readyForEmail=true.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
