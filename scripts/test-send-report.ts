// scripts/test-send-report.ts — smoke test for /api/send-report on a
// deployed environment. Builds a sample report and POSTs it. Pass the
// target URL as the first arg, e.g.
//   npx tsx scripts/test-send-report.ts https://emvy-audit-chatbot.vercel.app

import { ReportData, ReportLead } from "../src/lib/report-document";

const url = process.argv[2] || "http://localhost:3000";
const to = process.argv[3] || "duskonee@gmail.com";

const report: ReportData = {
  businessName: "Dusk Plumbing",
  industry: "Trades & services",
  summary:
    "Based on the audit, the priority is to remove the most painful manual work and ship one meaningful automation inside 30 days.",
  opportunities: [
    {
      title: "Speed up lead response",
      whatItIs:
        "Auto-draft a personalised reply within 2 minutes of a new enquiry landing.",
      whyMatters:
        "You said every hour of delay drops conversion — that's the leak to plug first.",
      whatChanges: "Conversion rate lifts, fewer jobs slip through.",
      howFast: "First drafted reply cycle lands in week 2.",
    },
    {
      title: "Quote follow-up nudges",
      whatItIs: "Auto-nudge outstanding quotes at day 3 and day 7.",
      whyMatters: "Quotes that go cold cost you revenue you already worked for.",
      whatChanges: "Quote-to-job conversion lifts, less manual chasing.",
      howFast: "First nudge cycle lands in week 2.",
    },
    {
      title: "Invoice collection cycle",
      whatItIs: "Wire Xero to Zapier to Resend so unpaid invoices trigger reminders.",
      whyMatters:
        "You said cashflow depends on chasing payments by phone — automate the chase.",
      whatChanges: "Collections cycle shortens, less phone tag.",
      howFast: "Live within 2 weeks once the automation is wired.",
    },
  ],
  quickWin:
    "This week: stop chasing payments by phone. Pick your top 5 outstanding invoices and call each one ONCE — after that, automate.",
  checklist: [
    "Audit every enquiry source (call, web form, email) and list the response-time gap on each.",
    "Pick the single most painful one — that's your week 1 target.",
    "Set up a shared Notion or Google Doc so the team can see the roadmap.",
    "Wire Xero to Zapier to Resend so unpaid invoices trigger an automated reminder at days 3, 7, and 14.",
    "Brief the team on a lightweight AI policy — what's allowed, what's reviewed.",
  ],
  nextStep:
    "Next step — if you'd like to see if EMVY is the right fit, book a free 15-minute discovery call: https://emvyai.com/services/discovery-call",
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