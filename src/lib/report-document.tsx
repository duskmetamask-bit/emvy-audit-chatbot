// Shared PDF document for the AI strategy report. Imported by /api/report-pdf
// (which serves the PDF for download) and /api/send-report (which emails
// it via Resend). Keeping the React tree in one place means a styling
// change shows up in both the downloaded PDF and the emailed copy.
//
// v2 (2026-06-18): report shape changed. Now renders 5 sections —
// cover (eyebrow + businessName + summary), 3 OpportunityCards, Quick
// Win callout, flat checklist, closing nextStep. No findings block, no
// hardcoded dark CTA at the bottom (the LLM's `nextStep` is the closer).

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

export interface ReportOpportunity {
  title: string;
  whatItIs: string;
  whyMatters: string;
  whatChanges: string;
  howFast: string;
}

export interface ReportData {
  businessName: string;
  industry: string;
  summary: string;
  opportunities: ReportOpportunity[];
  quickWin: string;
  checklist: string[];
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
  accent: "#00E5FF",
  accentInk: "#06121A",
  accentDim: "rgba(0, 229, 255, 0.10)",
  surface: "#F2F4F7",
  surfaceDark: "#0A1118",
  border: "#E5E5E5",
  onDark: "#F4F6F8",
  onDarkMuted: "#B6BEC9",
};

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
    maxWidth: 460,
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

  // Opportunities
  opportunityBlock: {
    paddingTop: 14,
    paddingBottom: 14,
    borderTopWidth: 0.5,
    borderTopColor: "#E5E5E5",
  },
  opportunityFirst: {
    borderTopWidth: 0,
    paddingTop: 0,
  },
  opportunityIndex: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    marginBottom: 4,
  },
  opportunityTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.3,
    lineHeight: 1.2,
    color: COLORS.ink,
    marginBottom: 12,
  },
  oppRow: {
    flexDirection: "row",
    marginBottom: 6,
    alignItems: "flex-start",
  },
  oppLabel: {
    width: 96,
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
    color: COLORS.textMuted,
    textTransform: "uppercase",
    paddingTop: 2,
  },
  oppValue: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 1.55,
    color: COLORS.text,
  },

  // Quick win callout
  quickWinBlock: {
    backgroundColor: COLORS.accentDim,
    padding: 18,
    marginTop: 22,
    marginBottom: 22,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
  },
  quickWinEyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  quickWinBody: {
    fontSize: 12,
    lineHeight: 1.5,
    color: COLORS.ink,
  },

  // Checklist (v3 — replaces the old 30/60/90 phasing)
  checklistBlock: {
    marginBottom: 18,
  },
  checklistHeader: {
    marginBottom: 8,
  },
  checklistEyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  checklistTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  action: {
    flexDirection: "row",
    paddingTop: 5,
    paddingBottom: 5,
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

  // Closer (nextStep)
  closerBlock: {
    marginTop: 8,
    marginBottom: 12,
    paddingTop: 18,
    paddingBottom: 18,
    borderTopWidth: 2,
    borderTopColor: COLORS.ink,
  },
  closerEyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  closerBody: {
    fontSize: 13,
    lineHeight: 1.5,
    color: COLORS.ink,
  },

  // Footer
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

function OpportunityCard({ opportunity, index }: { opportunity: ReportOpportunity; index: number }) {
  const isFirst = index === 0;
  return React.createElement(
    View,
    { style: [styles.opportunityBlock, isFirst ? styles.opportunityFirst : {}] },
    React.createElement(Text, { style: styles.opportunityIndex }, `OPPORTUNITY 0${index + 1}`),
    React.createElement(Text, { style: styles.opportunityTitle }, opportunity.title),
    React.createElement(
      View,
      { style: styles.oppRow },
      React.createElement(Text, { style: styles.oppLabel }, "What it is"),
      React.createElement(Text, { style: styles.oppValue }, opportunity.whatItIs)
    ),
    React.createElement(
      View,
      { style: styles.oppRow },
      React.createElement(Text, { style: styles.oppLabel }, "Why it matters"),
      React.createElement(Text, { style: styles.oppValue }, opportunity.whyMatters)
    ),
    React.createElement(
      View,
      { style: styles.oppRow },
      React.createElement(Text, { style: styles.oppLabel }, "What changes"),
      React.createElement(Text, { style: styles.oppValue }, opportunity.whatChanges)
    ),
    React.createElement(
      View,
      { style: styles.oppRow },
      React.createElement(Text, { style: styles.oppLabel }, "How fast"),
      React.createElement(Text, { style: styles.oppValue }, opportunity.howFast)
    )
  );
}

function QuickWinCallout({ quickWin }: { quickWin: string }) {
  return React.createElement(
    View,
    { style: styles.quickWinBlock },
    React.createElement(Text, { style: styles.quickWinEyebrow }, "Your quick win — this week"),
    React.createElement(Text, { style: styles.quickWinBody }, quickWin)
  );
}

function ChecklistBlock({ items }: { items: string[] }) {
  return React.createElement(
    View,
    { style: styles.checklistBlock },
    React.createElement(
      View,
      { style: styles.checklistHeader },
      React.createElement(Text, { style: styles.checklistEyebrow }, "Your 30-day checklist"),
      React.createElement(Text, { style: styles.checklistTitle }, "What to ship in the next 30 days")
    ),
    ...items.map((a, i) =>
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

  return React.createElement(
    Document,
    {
      title: `EMVY Mini AI Strategy Assessment — ${report.businessName}`,
      author: "EMVY AI",
      subject: "AI Strategy Report",
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
      React.createElement(Text, { style: styles.coverEyebrow }, "AI Strategy Report"),
      React.createElement(
        Text,
        { style: styles.coverTitle },
        report.businessName,
        React.createElement(Text, { style: styles.coverTitleAccent }, " — your AI strategy")
      ),
      React.createElement(Text, { style: styles.coverSub }, report.summary),
      React.createElement(
        Text,
        { style: styles.coverMeta },
        `Prepared for ${nameOrCompany(lead, report)}  ·  ${date}  ·  ${lead.email}`
      ),
      React.createElement(View, { style: styles.accentRule }),

      // 3 Opportunities
      ...report.opportunities.map((o, i) =>
        React.createElement(OpportunityCard, { key: `o${i}`, opportunity: o, index: i })
      ),

      // Quick Win
      report.quickWin && React.createElement(QuickWinCallout, { quickWin: report.quickWin }),

      // 30-Day Checklist (v3 — replaces the old 3-phase first90Days)
      report.checklist.length > 0 &&
        React.createElement(ChecklistBlock, { items: report.checklist }),

      // Closer (LLM's nextStep)
      report.nextStep &&
        React.createElement(
          View,
          { style: styles.closerBlock },
          React.createElement(Text, { style: styles.closerEyebrow }, "What to do next"),
          React.createElement(Text, { style: styles.closerBody }, report.nextStep)
        ),

      // Footer
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(Text, {}, `EMVY Mini AI Strategy Assessment  ·  ${lead.email}`),
        React.createElement(Text, {}, `${date}`)
      )
    )
  );
}
