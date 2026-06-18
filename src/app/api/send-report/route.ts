// /api/send-report — emails the personalised AI strategy PDF to the lead
// via Resend. Called from the client right after the on-screen report
// lands. The PDF is rendered with the same ReportDocument used by
// /api/report-pdf so the downloaded and emailed copies are byte-for-byte
// identical.
//
// v3 (2026-06-19): inlined the HTML/text instead of requiring a hosted
// Resend template. The template path needed RESEND_REPORT_TEMPLATE_ID set
// in Vercel and silently failed if it wasn't (the route returned 500 and
// no email arrived). Inline HTML is resilient and matches the lead-magnet
// trigger we ship today; we can swap to a hosted template later when
// brand-design wants to own the email shell.

import { NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import { ReportDocument, ReportData, ReportLead } from "@/lib/report-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SendRequestBody {
  report: ReportData;
  lead: ReportLead;
}

const FROM_NAME = process.env.RESEND_FROM_NAME || "EMVY";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "hello@emvyai.com";
const FROM_ADDRESS = `${FROM_NAME} <${FROM_EMAIL}>`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(name: string, businessName: string, summary: string): string {
  const firstName = (name || "there").split(/\s+/)[0];
  const biz = businessName ? esc(businessName) : "your business";
  const summaryHtml = esc(summary || "Your personalised AI strategy report is attached as a PDF.");
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A1118;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#E8EEF4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0A1118;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#11202C;border-radius:12px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 16px;font-size:14px;letter-spacing:0.06em;color:#56D9FF;text-transform:uppercase;">EMVY · Mini AI Strategy</p>
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#FFFFFF;font-weight:600;">Hey ${esc(firstName)},</h1>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#E8EEF4;">Your personalised AI strategy report for ${biz} is attached as a PDF.</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#9FB1C0;">${summaryHtml}</p>
            <p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#E8EEF4;">Next step — if you want help mapping the right AI process for your business, book a free discovery call:</p>
            <p style="margin:0 0 32px;"><a href="https://emvyai.com/services/discovery-call" style="display:inline-block;background:#56D9FF;color:#0A1118;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;font-size:15px;">Book free discovery call</a></p>
            <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#E8EEF4;">Talk soon,</p>
            <p style="margin:0;font-size:15px;line-height:1.55;color:#E8EEF4;">— Jake, EMVY</p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#5A6B7A;">EMVY · AI consultancy for Australian SMBs · <a href="https://emvyai.com" style="color:#5A6B7A;">emvyai.com</a></p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildText(name: string, businessName: string, summary: string): string {
  const firstName = (name || "there").split(/\s+/)[0];
  const biz = businessName || "your business";
  return `Hey ${firstName},

Your personalised AI strategy report for ${biz} is attached as a PDF.

${summary || ""}

Next step — if you want help mapping the right AI process for your business, book a free discovery call:
https://emvyai.com/services/discovery-call

Talk soon,
— Jake, EMVY

---
EMVY · AI consultancy for Australian SMBs · https://emvyai.com`;
}

export async function POST(req: NextRequest) {
  let body: SendRequestBody;
  try {
    body = (await req.json()) as SendRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body?.report || !body?.lead?.email) {
    return json({ error: "Missing report or lead email" }, 400);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[/api/send-report] RESEND_API_KEY not set");
    return json({ error: "Email service not configured" }, 500);
  }

  let pdfBuffer: Buffer;
  try {
    const element = React.createElement(ReportDocument, {
      report: body.report,
      lead: body.lead,
    }) as unknown as React.ReactElement<Record<string, unknown>>;
    pdfBuffer = await renderToBuffer(element);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/send-report] PDF render failed:", errMsg);
    return json({ error: "PDF render failed: " + errMsg }, 500);
  }

  const slug = (body.report.businessName || "audit")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const filename = `emvy-roadmap-${slug}.pdf`;

  const subject = body.report.businessName
    ? `Your ${body.report.businessName} AI strategy report`
    : "Your EMVY AI strategy report";

  const html = buildHtml(body.lead.name, body.report.businessName, body.report.summary);
  const text = buildText(body.lead.name, body.report.businessName, body.report.summary);

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [body.lead.email],
      subject,
      html,
      text,
      attachments: [
        {
          filename,
          content: pdfBuffer,
        },
      ],
    });

    if (error) {
      console.error("[/api/send-report] Resend error:", error);
      return json({ error: "Resend failed: " + (error.message || "unknown") }, 502);
    }

    return json({ ok: true, id: data?.id || null }, 200);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/send-report] send threw:", errMsg);
    return json({ error: "Email send failed: " + errMsg }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
