// Smoke test for the report LLM call. Calls the LLM with the exact
// prompt shape /api/report uses and prints what comes back. If the
// LLM returns prose, the parseRoadmap in /api/report fails silently
// and the route falls back to deriveFallbackRoadmap — the generic
// boilerplate. We want to see whether the LLM is the failure source.

import { chatCompletion } from "../src/lib/llm";
import { REPORT_SYSTEM_PROMPT, emptyAssessment, Assessment } from "../src/lib/agent";

async function main() {
  if (!process.env.MINIMAX_API_KEY) {
    console.error("MINIMAX_API_KEY not set");
    process.exit(1);
  }

  // The same kind of assessment the chat would have produced for a
  // EMVY-style self-test (the user's report screenshot was an EMVY
  // self-test with ~2 findings from the chat).
  const assessment: Assessment = {
    ...emptyAssessment(),
    businessName: "EMVY",
    businessDescription: "AI consultancy — audits and builds",
    teamSize: "1-2",
    industry: "AI consultancy",
    findings: [
      { category: "process", text: "AI consultancy — audits and builds" },
      { category: "process", text: "discovery call → payment → work starts" },
      { category: "process", text: "manuals in head, follow-ups by phone" },
    ],
    painPoints: [
      "client onboarding is manual — every new lead gets a custom proposal",
      "discovery call → payment → work starts is slow, drops conversion",
    ],
    manualTasks: ["drafting proposals", "writing the strategy report manually", "sending follow-up emails"],
    aiTools: "ChatGPT for drafting, no automation wired in",
    goal: "more revenue with less manual grind",
    messageCount: 11,
    readyForEmail: true,
    currentQuestion: 10,
  };

  const messages = [
    { role: "system" as const, content: REPORT_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content:
        "Generate the report for this lead. Lead details: " +
        JSON.stringify({ name: "Dusk Wun", email: "duskonee@gmail.com", company: "EMVY" }) +
        "\n\nAssessment (from the chat): " +
        JSON.stringify(assessment, null, 2) +
        "\n\nReturn ONLY the JSON object described in your instructions.",
    },
  ];

  console.log("=== /api/report LLM smoke ===\n");
  const t0 = Date.now();
  try {
    const response = await chatCompletion({ messages, temperature: 0.6, maxTokens: 2400 });
    const ms = Date.now() - t0;
    const raw = response.choices?.[0]?.message?.content ?? "";
    console.log(`LLM returned ${ms}ms, ${raw.length} chars\n`);
    console.log("--- RAW OUTPUT ---");
    console.log(raw);
    console.log("--- /RAW ---\n");

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) {
      console.log("PARSE FAIL: no braces found");
      process.exit(2);
    }
    try {
      const parsed = JSON.parse(raw.slice(first, last + 1));
      console.log("PARSE OK:", Object.keys(parsed).join(", "));
      if (Array.isArray(parsed.opportunities)) {
        console.log(`  opportunities: ${parsed.opportunities.length}`);
        parsed.opportunities.forEach((o: { title?: string }, i: number) => {
          console.log(`    [${i + 1}] ${o.title ?? "(no title)"}`);
        });
      }
    } catch (e) {
      console.log("PARSE FAIL:", (e as Error).message);
      // Show the suspect slice
      console.log("--- SUSPECT SLICE (first 500 chars) ---");
      console.log(raw.slice(first, Math.min(first + 500, last + 1)));
    }
  } catch (e) {
    console.error("LLM call threw:", (e as Error).message);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
