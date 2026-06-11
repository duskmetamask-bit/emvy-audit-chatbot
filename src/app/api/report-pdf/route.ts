// /api/report-pdf — server-side PDF generation using @react-pdf/renderer.
// Document tree lives in src/lib/report-document.tsx so the email send
// (Resend) can reuse the exact same render.

import { NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportDocument, ReportData, ReportLead } from "@/lib/report-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReportRequestBody {
  report: ReportData;
  lead: ReportLead;
}

export async function POST(req: NextRequest) {
  let body: ReportRequestBody;
  try {
    body = (await req.json()) as ReportRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!body?.report || !body?.lead?.email) {
    return new Response(JSON.stringify({ error: "Missing report or lead" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const element = React.createElement(ReportDocument, {
      report: body.report,
      lead: body.lead,
    }) as unknown as React.ReactElement<Record<string, unknown>>;
    const buffer = await renderToBuffer(element);
    const slug = (body.report.businessName || "audit")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="emvy-roadmap-${slug}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/report-pdf] render failed:", errMsg);
    return new Response(JSON.stringify({ error: "PDF render failed: " + errMsg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
