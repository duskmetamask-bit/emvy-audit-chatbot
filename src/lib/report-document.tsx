// Shared PDF document for the audit report. Imported by /api/report-pdf
// (which serves the PDF for download) and /api/send-report (which emails
// it via Resend). Keeping the React tree in one place means a styling
// change shows up in both the downloaded PDF and the emailed copy.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Svg,
  Path,
} from "@react-pdf/renderer";

export interface ReportData {
  score: number;
  scoreLabel: string;
  scoreBlurb: string;
  businessName: string;
  industry: string;
  summary: string;
  week1: string[];
  weeks24: string[];
  months23: string[];
  nextStep: string;
}

export interface ReportLead {
  name: string;
  email: string;
  company?: string;
}

const COLORS = {
  bg: "#FFFFFF",
  ink: "#0A1118",
  text: "#1A1A1A",
  textSecondary: "#4A4A4F",
  textMuted: "#6B6B70",
  accent: "#56D9FF",
  accentInk: "#06121A",
  accentDim: "rgba(86, 217, 255, 0.10)",
  surface: "#F2F4F7",
  surfaceDark: "#0A1118",
  border: "#E5E5E5",
  onDark: "#F4F6F8",
  onDarkMuted: "#B6BEC9",
};

function scoreColor(score: number): string {
  if (score >= 70) return "#1B8A5A";
  if (score >= 40) return "#0891B2";
  return "#E85D04";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function nameOrCompany(lead: ReportLead, report: ReportData): string {
  if (lead.company) return lead.company;
  if (report.businessName) return report.businessName;
  return lead.name || "Your business";
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 40,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    lineHeight: 1.55,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  coverBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 28,
  },
  coverBrandText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.6,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginLeft: 6,
  },
  coverEyebrow: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  coverTitle: {
    fontSize: 30,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.6,
    lineHeight: 1.05,
    color: COLORS.ink,
  },
  coverTitleAccent: {
    color: COLORS.textMuted,
  },
  coverSub: {
    fontSize: 11,
    lineHeight: 1.55,
    color: COLORS.textSecondary,
    marginTop: 10,
    maxWidth: 380,
  },
  coverMeta: {
    fontSize: 8.5,
    color: COLORS.textMuted,
    marginTop: 12,
  },
  accentRule: {
    width: 32,
    height: 3,
    backgroundColor: COLORS.accent,
    marginTop: 14,
    marginBottom: 24,
  },
  scoreBlock: {
    backgroundColor: COLORS.surface,
    padding: 18,
    marginBottom: 22,
    flexDirection: "row",
    alignItems: "center",
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
    paddingBottom: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 10,
  },
  sectionEyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
  },
  sectionMeta: {
    fontSize: 8,
    color: COLORS.textMuted,
    fontFamily: "Courier",
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.3,
    lineHeight: 1.2,
    color: COLORS.ink,
    marginBottom: 10,
  },
  action: {
    flexDirection: "row",
    paddingTop: 6,
    paddingBottom: 6,
    borderTopWidth: 0.5,
    borderTopColor: "#EFEFEF",
    alignItems: "flex-start",
  },
  actionFirst: {
    borderTopWidth: 0,
  },
  actionNum: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    width: 22,
    paddingTop: 1,
  },
  actionText: {
    fontSize: 10,
    lineHeight: 1.55,
    color: COLORS.text,
    flex: 1,
  },
  ctaBlock: {
    backgroundColor: COLORS.surfaceDark,
    padding: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  ctaEyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  ctaTitle: {
    fontSize: 17,
    fontFamily: "Helvetica-Bold",
    color: COLORS.onDark,
    lineHeight: 1.2,
    marginBottom: 6,
  },
  ctaBody: {
    fontSize: 10,
    lineHeight: 1.55,
    color: COLORS.onDarkMuted,
    marginBottom: 12,
    maxWidth: 400,
  },
  ctaBtn: {
    backgroundColor: COLORS.accent,
    color: COLORS.accentInk,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    alignSelf: "flex-start",
  },
  ctaFine: {
    fontSize: 8,
    fontFamily: "Courier",
    color: COLORS.textMuted,
    marginTop: 12,
  },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    fontSize: 8,
    color: COLORS.textMuted,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function MVMark({ size = 14, color = COLORS.accent }: { size?: number; color?: string }) {
  return React.createElement(
    Svg,
    { width: size, height: size, viewBox: "0 0 40 40" },
    React.createElement(Path, {
      d: "M3 4 H11 L20 21 L29 4 H37 V36 H29 V17 L22 28 L18 28 L11 17 V36 H3 Z M16.5 8 L20 14 L23.5 8 Z",
      fill: color,
      fillRule: "evenodd",
    })
  );
}

function RoadmapSection({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: string;
  title: string;
  actions: string[];
}) {
  return React.createElement(
    View,
    { style: styles.section },
    React.createElement(
      View,
      { style: styles.sectionHeader },
      React.createElement(Text, { style: styles.sectionEyebrow }, eyebrow),
      React.createElement(Text, { style: styles.sectionMeta }, `· ${actions.length} actions`)
    ),
    React.createElement(Text, { style: styles.sectionTitle }, title),
    ...actions.map((a, i) =>
      React.createElement(
        View,
        { key: `a${i}`, style: [styles.action, i === 0 ? styles.actionFirst : {}] },
        React.createElement(Text, { style: styles.actionNum }, String(i + 1).padStart(2, "0")),
        React.createElement(Text, { style: styles.actionText }, a)
      )
    )
  );
}

export function ReportDocument({ report, lead }: { report: ReportData; lead: ReportLead }) {
  const date = formatDate();
  const scoreCol = scoreColor(report.score);

  return React.createElement(
    Document,
    {
      title: `EMVY Mini AI Strategy Assessment — ${report.businessName}`,
      author: "EMVY AI",
      subject: "30/60/90 AI Roadmap",
    },
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      // Cover header
      React.createElement(
        View,
        { style: styles.coverBrand },
        React.createElement(MVMark, { size: 16 }),
        React.createElement(Text, { style: styles.coverBrandText }, "EMVY · MINI AI STRATEGY ASSESSMENT")
      ),
      React.createElement(Text, { style: styles.coverEyebrow }, "30/60/90 Roadmap"),
      React.createElement(
        Text,
        { style: styles.coverTitle },
        report.businessName,
        React.createElement(Text, { style: styles.coverTitleAccent }, " — your AI roadmap")
      ),
      React.createElement(Text, { style: styles.coverSub }, report.summary),
      React.createElement(
        Text,
        { style: styles.coverMeta },
        `Prepared for ${nameOrCompany(lead, report)}  ·  ${date}  ·  ${lead.email}`
      ),
      React.createElement(View, { style: styles.accentRule }),

      // Score block
      React.createElement(
        View,
        { style: styles.scoreBlock },
        React.createElement(
          View,
          null,
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

      // Sections
      report.week1.length > 0 &&
        React.createElement(RoadmapSection, {
          eyebrow: "Week 01",
          title: "What to do this week",
          actions: report.week1,
        }),
      report.weeks24.length > 0 &&
        React.createElement(RoadmapSection, {
          eyebrow: "Weeks 02–04",
          title: "Your first 30 days",
          actions: report.weeks24,
        }),
      report.months23.length > 0 &&
        React.createElement(RoadmapSection, {
          eyebrow: "Months 02–03",
          title: "The compounding horizon",
          actions: report.months23,
        }),

      // CTA
      React.createElement(
        View,
        { style: styles.ctaBlock },
        React.createElement(Text, { style: styles.ctaEyebrow }, "Next step"),
        React.createElement(Text, { style: styles.ctaTitle }, report.nextStep),
        React.createElement(
          Text,
          { style: styles.ctaBody },
          "A free 15-min discovery call with EMVY. We map the exact automations to your business, sequence them by ROI, and ship the first one inside two weeks."
        ),
        React.createElement(Text, { style: styles.ctaBtn }, "Book a discovery call →"),
        React.createElement(Text, { style: styles.ctaFine }, "emvyai.com  ·  hello@emvyai.com  ·  Sydney, AU")
      ),

      // Footer
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(Text, {}, `EMVY Mini AI Strategy Assessment  ·  ${lead.email}`),
        React.createElement(Text, {}, `Page 1  ·  ${date}`)
      )
    )
  );
}
