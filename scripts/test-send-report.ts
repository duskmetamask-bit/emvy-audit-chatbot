// scripts/test-send-report.ts — smoke test for /api/send-report on a
// deployed environment. Builds a sample report and POSTs it. Pass the
// target URL as the first arg, e.g.
//   npx tsx scripts/test-send-report.ts https://emvy-audit-chatbot.vercel.app

import { ReportData, ReportLead } from "../src/lib/report-document";

const url = process.argv[2] || "http://localhost:3000";
const to = process.argv[3] || "duskonee@gmail.com";

const report: ReportData = {
  score: 42,
  scoreLabel: "Moderate readiness",
  scoreBlurb:
    "Real opportunity to cut manual work and tighten the operations across the teams you mentioned.",
  businessName: "Dusk Plumbing",
  industry: "Trades & services",
  summary:
    "Based on the audit, the next 90 days can be shaped around three moves: remove the most painful manual work, ship one meaningful automation, and build a habit of AI-assisted decisions.",
  week1: [
    "Audit every enquiry source (call, web form, email) and list the response-time gap on each.",
    "Pick the single most painful one — that's your week 1 target.",
    "Set up a shared Notion or Google Doc so the team can see the roadmap.",
  ],
  weeks24: [
    "Ship the week 1 automation end-to-end. Measure the time it frees up.",
    "Set up automated invoice or follow-up reminders if cashflow or lead response is leaking.",
    "Brief the team on a lightweight AI policy — what's allowed, what's reviewed.",
  ],
  months23: [
    "Layer AI into the next-priority workflow (lead qualification, reporting, or scheduling).",
    "Move to a weekly AI review cadence — what's working, what to retire, what to try next.",
    "Plan a quarterly audit checkpoint to keep the roadmap honest as the business shifts.",
  ],
  nextStep:
    "Book a free 15-min discovery call and we'll map a custom 30/60/90 plan for your business.",
};

const lead: ReportLead = {
  name: "Dusk",
  email: to,
  company: "Dusk Plumbing",
};

async function main() {
  console.log(`POST ${url}/api/send-report`);
  const res = await fetch(`${url}/api/send-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report, lead }),
  });
  const text = await res.text();
  console.log(`status: ${res.status}`);
  console.log(`body: ${text}`);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
