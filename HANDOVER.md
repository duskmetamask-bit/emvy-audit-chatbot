# Audit Chatbot — Handover Brief

## What This Is
EMVY Mini AI Audit Chatbot — conversational lead-gen tool. User answers questions → gets audit report → prompted to book discovery call.

**Live:** `https://emvy-audit-chatbot.vercel.app`
**Vercel project ID:** `prj_JbHVa9ScDvAaxPFQ5ExdCKsoKurQ`
**Repo:** `https://github.com/duskmetamask-bit/emvy-audit-chatbot`

---

## What's Implemented

### Stages
Welcome → Chat → Email capture → Report → PDF download

### Design (Stitch-aligned)
- Session metadata bar: `SESSION ID: EMVY-XXXXX-AUDIT` + `MODEL: EMVY-CORE-V4`
- Timestamps on messages (HH:MM:SS monospace)
- `EMVY SYSTEM` label in cyan monospace
- Bordered bot message cards with cyan tint
- Cyan user pills (dark text)
- Blinking cursor typing indicator
- Security footer: `DATA SECURE // END-TO-END ENCRYPTED` + `AUTO-SAVING AUDIT STATE`
- Input field with cyan-tinted border
- Progress: `XX% PROCESSED` in cyan header

### Copy
- Product name: **Mini AI Audit**
- Welcome heading: "Mini AI Audit for your business"
- Time: "5 minutes"
- Report: "EMVY Mini AI Audit Report"
- Score: "Mini AI Audit Score"
- CTA: "Ready for the Full Picture?"

---

## What's Pending

### 1. Stitch Design System
- DESIGN.md at `/home/dusk/DESIGN.md` — complete EMVY brand spec
- Upload to Stitch project via `mcp__stitch__upload_design_md` (project ID: `1549993675311018346`)
- Requires interactive Claude Code approval for Stitch MCP write tools

### 2. Step Indicators
- Agent needs to output `step: "STEP 04/13: CATEGORY"` in response
- Wire up `msg.step` in page.tsx to display as cyan badge

### 3. Stitch Screens Not Yet Built
- Landing page variant — welcome screen alternatives
- Results Dashboard — refined report layout
- EMVY Official Logo — header logo

### 4. Website Assessment Copy
- emvyai.com assessment section needs updating to match Mini AI Audit framing
- Repo location not yet found

---

## Environment Variables (Vercel)
Set in Vercel dashboard:
- `MINIMAX_API_KEY` — MiniMax API key
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key

---

## Key Files
- `src/app/page.tsx` — main chatbot UI
- `src/app/globals.css` — design tokens + animations
- `src/lib/mini-agent.ts` — MiniMax agent loop
- `src/lib/llm.ts` — dual auth
- `src/app/api/chat/route.ts` — chat API
- `src/app/api/report/route.ts` — report generation
- `src/app/api/report-pdf/route.ts` — PDF generation

---

## Stitch MCP Setup
```bash
claude mcp add --transport http stitch https://stitch.googleapis.com/mcp \
  --header "X-Goog-Api-Key: <STITCH_API_KEY>"
```
Get API key from: stitch.withgoogle.com → project settings → API
Project ID: `1549993675311018346`