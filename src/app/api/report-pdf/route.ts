// /api/report-pdf — server-side PDF generation using @react-pdf/renderer.
// Pure JS, no system deps, runs on Vercel.
//
// The report content comes from /api/report (M2.7). This route receives the
// structured report + lead details, renders them to a React-PDF document,
// and returns the binary PDF as a download.

import { NextRequest } from "next/server";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReportData {
  score: number;
  scoreLabel: string;
  scoreBlurb: string;
  businessName: string;
  industry: string;
  summary: string;
  topFindings: string[];
  recommendations: string[];
  priorityAutomations: string[];
  nextStep: string;
}

interface ReportRequestBody {
  report: ReportData;
  lead: { name: string; email: string; company?: string };
}

const COLORS = {
  bg: "#FFFFFF",
  text: "#1A1A1A",
  textMuted: "#6B6B70",
  textSecondary: "#4A4A4F",
  accent: "#06B6D4",
  accentDark: "#0891B2",
  surface: "#F7F7F8",
  border: "#E5E5E5",
  ink: "#0A0A0A",
  onDark: "#FFFFFF",
  onDarkMuted: "#C4C4C8",
};

function scoreColor(score: number): string {
  if (score >= 70) return "#1B8A5A";
  if (score >= 40) return "#06B6D4";
  return "#E85D04";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 36,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    lineHeight: 1.55,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 10,
    marginBottom: 18,
  },
  brand: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.8,
    color: COLORS.accent,
    textTransform: "uppercase",
  },
  brandSub: {
    fontSize: 8,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  meta: {
    fontSize: 8,
    color: COLORS.textMuted,
    marginTop: 6,
    fontFamily: "Courier",
  },
  hero: {
    marginBottom: 18,
  },
  eyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  heroTitle: {
    fontSize: 30,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.6,
    lineHeight: 1.05,
    color: COLORS.ink,
  },
  heroTitleAccent: {
    color: COLORS.accent,
  },
  heroSub: {
    fontSize: 11,
    lineHeight: 1.55,
    color: COLORS.textSecondary,
    marginTop: 8,
    maxWidth: 380,
  },
  accentRule: {
    width: 28,
    height: 3,
    backgroundColor: COLORS.accent,
    marginTop: 12,
  },
  scoreBlock: {
    backgroundColor: COLORS.surface,
    padding: 18,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  scoreNumWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  scoreNum: {
    fontSize: 56,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -1.8,
    lineHeight: 1,
  },
  scoreSuffix: {
    fontSize: 14,
    fontFamily: "Helvetica",
    color: COLORS.textMuted,
    marginTop: 8,
    marginLeft: 3,
  },
  scoreSide: {
    marginLeft: 22,
    flex: 1,
  },
  scoreLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    marginBottom: 2,
  },
  scoreBlurb: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: COLORS.textSecondary,
  },
  section: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionEyebrow: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.4,
    lineHeight: 1.15,
    color: COLORS.ink,
    marginBottom: 10,
  },
  finding: {
    paddingTop: 5,
    paddingBottom: 5,
    borderTopWidth: 0.5,
    borderTopColor: "#EFEFEF",
  },
  findingFirst: {
    borderTopWidth: 0,
  },
  findingNum: {
    fontSize: 8,
    fontFamily: "Courier-Bold",
    color: COLORS.accent,
    marginBottom: 2,
  },
  findingText: {
    fontSize: 10,
    lineHeight: 1.55,
    color: COLORS.text,
  },
  rec: {
    flexDirection: "row",
    paddingTop: 4,
    paddingBottom: 4,
    borderTopWidth: 0.5,
    borderTopColor: "#EFEFEF",
  },
  recFirst: {
    borderTopWidth: 0,
  },
  recArrow: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    width: 14,
  },
  recText: {
    fontSize: 10,
    lineHeight: 1.55,
    color: COLORS.text,
    flex: 1,
  },
  auto: {
    backgroundColor: COLORS.surface,
    borderLeftWidth: 2.5,
    borderLeftColor: COLORS.accent,
    padding: 8,
    marginBottom: 5,
  },
  autoLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  autoText: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: COLORS.text,
  },
  ctaBlock: {
    backgroundColor: COLORS.ink,
    color: COLORS.onDark,
    padding: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  ctaEyebrow: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  ctaTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: COLORS.onDark,
    lineHeight: 1.2,
    marginBottom: 6,
  },
  ctaBody: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: COLORS.onDarkMuted,
    marginBottom: 10,
    maxWidth: 380,
  },
  ctaBtn: {
    backgroundColor: COLORS.accent,
    color: COLORS.ink,
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    alignSelf: "flex-start",
  },
  ctaFine: {
    fontSize: 7.5,
    fontFamily: "Courier",
    color: COLORS.textMuted,
    marginTop: 10,
  },
  footer: {
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    paddingTop: 6,
    fontSize: 7.5,
    color: COLORS.textMuted,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function ReportDocument({ report, lead }: { report: ReportData; lead: ReportRequestBody["lead"] }) {
  const date = formatDate();
  const scoreCol = scoreColor(report.score);

  return React.createElement(
    Document,
    {
      title: `EMVY AI Audit — ${report.businessName}`,
      author: "EMVY AI",
      subject: "AI Readiness Audit Report",
    },
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      // Header
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.brand }, "EMVY · AI AUDIT"),
        React.createElement(Text, { style: styles.brandSub }, `Prepared for ${lead.company || report.businessName}`),
        React.createElement(Text, { style: styles.meta }, `${date}  ·  ${lead.email}`)
      ),
      // Hero
      React.createElement(
        View,
        { style: styles.hero },
        React.createElement(Text, { style: styles.eyebrow }, "AI Readiness Audit"),
        React.createElement(
          Text,
          { style: styles.heroTitle },
          report.businessName,
          React.createElement(Text, { style: styles.heroTitleAccent }, "\naudit report")
        ),
        React.createElement(Text, { style: styles.heroSub }, report.summary),
        React.createElement(View, { style: styles.accentRule })
      ),
      // Score block
      React.createElement(
        View,
        { style: styles.scoreBlock },
        React.createElement(
          View,
          { style: styles.scoreNumWrap },
          React.createElement(Text, { style: [styles.scoreNum, { color: scoreCol }] }, String(report.score)),
          React.createElement(Text, { style: styles.scoreSuffix }, "/100")
        ),
        React.createElement(
          View,
          { style: styles.scoreSide },
          React.createElement(Text, { style: styles.scoreLabel }, report.scoreLabel),
          React.createElement(Text, { style: styles.scoreBlurb }, report.scoreBlurb)
        )
      ),
      // Top findings
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionEyebrow }, "Section 01"),
        React.createElement(Text, { style: styles.sectionTitle }, "Top findings"),
        ...report.topFindings.slice(0, 5).map((f, i) =>
          React.createElement(
            View,
            { key: `f${i}`, style: [styles.finding, i === 0 ? styles.findingFirst : {}] },
            React.createElement(Text, { style: styles.findingNum }, String(i + 1).padStart(2, "0")),
            React.createElement(Text, { style: styles.findingText }, f)
          )
        )
      ),
      // Easy wins
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionEyebrow }, "Section 02"),
        React.createElement(Text, { style: styles.sectionTitle }, "Easy wins to make this week"),
        ...report.recommendations.slice(0, 3).map((r, i) =>
          React.createElement(
            View,
            { key: `r${i}`, style: [styles.rec, i === 0 ? styles.recFirst : {}] },
            React.createElement(Text, { style: styles.recArrow }, "→"),
            React.createElement(Text, { style: styles.recText }, r)
          )
        )
      ),
      // Priority automations
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionEyebrow }, "Section 03"),
        React.createElement(Text, { style: styles.sectionTitle }, "Workflows to automate first"),
        ...report.priorityAutomations.slice(0, 3).map((a, i) =>
          React.createElement(
            View,
            { key: `a${i}`, style: styles.auto },
            React.createElement(Text, { style: styles.autoLabel }, `Priority ${String(i + 1).padStart(2, "0")}`),
            React.createElement(Text, { style: styles.autoText }, a)
          )
        )
      ),
      // CTA
      React.createElement(
        View,
        { style: styles.ctaBlock },
        React.createElement(Text, { style: styles.ctaEyebrow }, "Next step"),
        React.createElement(Text, { style: styles.ctaTitle }, report.nextStep),
        React.createElement(
          Text,
          { style: styles.ctaBody },
          "A 30-minute discovery call with EMVY. We map the exact automations to your business, sequence them by ROI, and ship the first one inside two weeks."
        ),
        React.createElement(Text, { style: styles.ctaBtn }, "Book a discovery call →"),
        React.createElement(Text, { style: styles.ctaFine }, "emvyai.com  ·  hello@emvyai.com  ·  Sydney, AU")
      ),
      // Footer
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(Text, {}, `EMVY AI Audit  ·  ${lead.email}`),
        React.createElement(Text, {}, date)
      )
    )
  );
}

export async function POST(req: NextRequest) {
  let body: ReportRequestBody;
  try {
    body = await req.json();
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
    const element = React.createElement(ReportDocument, { report: body.report, lead: body.lead }) as any;
    const buffer = await renderToBuffer(element);
    const slug = (body.report.businessName || "audit")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="emvy-audit-${slug}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "PDF generation failed", detail: err?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}