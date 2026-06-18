// /api/send-report — emails the personalised AI strategy PDF to the lead
// via Resend. Called from the client right after the on-screen report
// lands. The PDF is rendered with the same ReportDocument used by
// /api/report-pdf so the downloaded and emailed copies are byte-for-byte
// identical.
//
// v2 (2026-06-18): switched from inline html/text to Resend's hosted
// Templates feature. The template (footer PNG + "— Jake" signature +
// greeting/summary copy) lives in the Resend dashboard. This route
// passes the template ID + dynamic variables + the PDF attachment.
//
// Required template variables (handlebars-style):
//   {{name}}          — lead's first name
//   {{businessName}}  — from the report
//   {{summary}}       — 2-3 sentence strategy summary
//   {{filename}}      — slug for the PDF attachment name
//
// To set the template ID:
//   1. Create the template in the Resend dashboard with the variables above.
//   2. Add the template's ID to Vercel env as RESEND_REPORT_TEMPLATE_ID.
//   3. Redeploy. /api/send-report will then use it on the next send.

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

  const templateId = process.env.RESEND_REPORT_TEMPLATE_ID;
  if (!templateId) {
    console.error("[/api/send-report] RESEND_REPORT_TEMPLATE_ID not set");
    return json({ error: "Email template not configured" }, 500);
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

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [body.lead.email],
      subject,
      template: {
        id: templateId,
        variables: {
          name: body.lead.name,
          businessName: body.report.businessName,
          summary: body.report.summary,
          filename,
        },
      },
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
