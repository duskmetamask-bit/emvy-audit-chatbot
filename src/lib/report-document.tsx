// Shared PDF document for the AI strategy report. Imported by /api/report-pdf
// (which serves the PDF for download) and /api/send-report (which emails
// it via Resend). Keeping the React tree in one place means a styling
// change shows up in both the downloaded PDF and the emailed copy.
//
// v3 (2026-06-25): report shape changed. Now renders 6 sections —
// cover, 3 OpportunityCards, Automation Areas (4-6 named workflow
// areas), Quick Win callout, flat 30-day checklist, closing nextStep.
// The user pushed back that v2 buried automation inside opportunities/
// checklist copy; v3 surfaces it as its own scan-friendly section so
// the owner can read it before the action plan.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
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
  automationAreas: string[];
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

  // Automation areas (v3 — workflow map surfaced separately from opportunities)
  automationAreasBlock: {
    marginTop: 22,
    marginBottom: 6,
  },
  automationAreasHeader: {
    marginBottom: 10,
  },
  automationAreasEyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: COLORS.accent,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  automationAreasTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  automationRow: {
    flexDirection: "row",
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#EFEFEF",
    alignItems: "flex-start",
  },
  automationRowFirst: {
    borderTopWidth: 0,
  },
  automationBullet: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    width: 22,
    paddingTop: 2,
  },
  automationText: {
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

function AutomationAreasBlock({ items }: { items: string[] }) {
  return React.createElement(
    View,
    { style: styles.automationAreasBlock },
    React.createElement(
      View,
      { style: styles.automationAreasHeader },
      React.createElement(Text, { style: styles.automationAreasEyebrow }, "Areas to automate"),
      React.createElement(Text, { style: styles.automationAreasTitle }, "AI automation workflow map")
    ),
    ...items.map((text, i) =>
      React.createElement(
        View,
        { key: `aa${i}`, style: [styles.automationRow, i === 0 ? styles.automationRowFirst : {}] },
        React.createElement(Text, { style: styles.automationBullet }, String(i + 1).padStart(2, "0")),
        React.createElement(Text, { style: styles.automationText }, text)
      )
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
      // 3 Opportunities
      ...report.opportunities.map((o, i) =>
        React.createElement(OpportunityCard, { key: `o${i}`, opportunity: o, index: i })
      ),

      // Automation Areas — workflow map (4-6 named areas with a one-line
      // description of the trigger + target outcome). Sits between the
      // opportunities and the quick win so the owner can scan "where
      // AI fits" before reading "what to ship this week".
      report.automationAreas.length > 0 &&
        React.createElement(AutomationAreasBlock, { items: report.automationAreas }),

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
