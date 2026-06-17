// /api/send-report — emails the personalised 30/60/90 PDF to the lead via
// Resend. Called from the client right after the on-screen report lands.
// The PDF is rendered with the same ReportDocument used by /api/report-pdf
// so the downloaded and emailed copies are byte-for-byte identical.

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
    ? `Your ${body.report.businessName} AI roadmap`
    : "Your EMVY AI roadmap";

  const scoreLine = body.report.score
    ? `Your AI readiness score: ${body.report.score}/100 (${body.report.scoreLabel}).`
    : "";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.55; color: #0A1118; max-width: 560px;">
      <p style="margin: 0 0 12px;">Hi ${escapeHtml(body.lead.name || "there")},</p>
      <p style="margin: 0 0 12px;">Thanks for running the EMVY Mini AI Strategy Assessment. Your personalised 30/60/90 day roadmap is attached.</p>
      ${scoreLine ? `<p style="margin: 0 0 12px;"><strong>${escapeHtml(scoreLine)}</strong></p>` : ""}
      <p style="margin: 0 0 12px;">${escapeHtml(body.report.summary || "")}</p>
      <p style="margin: 0 0 12px;">If you want help shipping any of these, grab a free 15-min slot: <a href="https://emvyai.com/services/discovery-call">emvyai.com/services/discovery-call</a>.</p>
      <p style="margin: 24px 0 0; color: #6B6B70; font-size: 13px;">— The EMVY team</p>
    </div>
  `;

  const text =
    `Hi ${body.lead.name || "there"},\n\n` +
    `Thanks for running the EMVY Mini AI Strategy Assessment. Your personalised 30/60/90 day roadmap is attached.\n\n` +
    (scoreLine ? `${scoreLine}\n\n` : "") +
    `${body.report.summary || ""}\n\n` +
    `If you want help shipping any of these, grab a free 15-min slot: https://emvyai.com/services/discovery-call\n\n` +
    `— The EMVY team\n`;

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
