# Business AI Audit Chatbot — SPEC

## 1. Concept& Vision

A conversational lead-generation chatbot that guides business owners through a structured AI audit assessment. The experience feels like a professional consultation — not a form. Users answer one question at a time, get a personalized PDF report with easy-win recommendations, and are pitched on booking a full paid audit. The chatbot demonstrates EMVY's expertise while capturing qualified leads.

## 2. Design Language

**Aesthetic:** Dark, professional, enterprise-grade. Inspired by board.emvyai.com and emvy-website dark theme.

**Color Palette:**
- Background: `#0a0a0a` (near-black)
- Surface: `#141414` (card backgrounds)
- Border: `#262626` (subtle borders)
- Text Primary: `#ffffff`
- Text Secondary: `#a3a3a3`
- Accent: `#3b82f6` (blue — buttons, highlights)
- Accent Hover: `#2563eb`
- Success: `#22c55e`
- Error: `#ef4444`

**Typography:**
- Font: `Inter` (Google Fonts) with system fallbacks
- Headings: 600 weight
- Body: 400 weight
- Sizes: 14px base, 18px subheadings, 24px headings

**Spatial System:**
- Padding: 16px / 24px / 32px
- Border radius: 8px (cards), 6px (buttons/inputs)
- Max content width: 640px (chat bubble container)

**Motion:**
- Subtle fade-in for each new question (opacity 0→1, 200ms ease-out)
- Progress bar smooth transition (300ms)
- No bouncy or playful animations — professional and calm

**NO EMOJIS — text-only interface. Hard constraint.**

## 3. Layout & Structure

**Single-page application with chat-style layout:**

```
┌─────────────────────────────────┐
│  EMVY AI Audit    [Progress]    │  <- Header (fixed)
├─────────────────────────────────┤
│                                 │
│  [Bot message bubble]           │
│                                 │
│         [User response bubble]  │
│                                 │
│  [Bot message bubble]           │
│                                 │
├─────────────────────────────────┤
│  [Input field]        [Send]    │  <- Footer (fixed)
│              [Skip this question]│
└─────────────────────────────────┘
```

- Mobile-first, centered content
- Chat bubbles left-aligned (bot) and right-aligned (user)
- Input auto-focuses on each new question
- Skip button on every question except email capture

**Pages:**
1. Welcome screen (brief intro + "Start Audit" CTA)
2. Question flow (13 questions total)
3. Email capture screen (name + email required)
4. Report display screen (show report + email PDF)
5. CTA screen (book a proper audit)

## 4. Features & Interactions

### Chat Flow
- One question displayed at a time
- User types answer and presses Enter or clicks Send
- Bot shows question, user sees their answer, bot shows next question
- Skip button available on every question (except email capture)
- Progress bar shows "Question X of Y"
- Back button to revisit previous question (optional nice-to-have)

### Questions (13 total):
1. What is your business called and what do you do?
2. How many people are in your team?
3. Where does your team work? (remote / hybrid / office)
4. What are the biggest pain points in your business right now?
5. What manual tasks take up most of your time?
6. Are you currently using any AI tools? If so, which ones?
7. What's your monthly budget for AI tools or automation?
8. What's your main goal for your business in the next 6 months?
9. What's stopping you from achieving that goal right now?
10. How did you hear about us?
11. What industry are you in? (follow-up to Q1)
12. Do you have any recurring clients or subscribers?
13. What's your biggest frustration with your current workflow?

### Email Capture
- Required: Full name
- Required: Email address
- Optional: Company name
- Cannot proceed without name + email
- Validation: email format check

### Report Generation
- Client-side PDF generation using browser print / html2pdf
- Report includes:
  - Business summary
  - AI readiness score (calculated from answers)
  - Top 3-5 easy-win recommendations
  - Current AI tool snapshot
  - CTA to book proper audit
- Report displayed on screen after generation
- PDF emailed to user (viaResend or similar)

### Lead Storage
- Push to Supabase `leads` table
- Schema: id, name, email, company, business_name, business_description, team_size, work_location, pain_points, manual_tasks, ai_tools, budget, goal_6months, obstacles, referral_source, industry, recurring_clients, workflow_frustration, created_at, report_sent

## 5. Component Inventory

### Header
- Logo text "EMVY AI Audit"
- Progress indicator "Question X of Y"
- Dark background (#141414)

### ChatContainer
- Scrollable area for chat bubbles
- Auto-scrolls to bottom on new message
- Subtle border or separator

### BotBubble
- Left-aligned
- Background: #1f1f1f
- Border-radius: 12px (top-left square)
- Padding: 16px
- Text: white

### UserBubble
- Right-aligned
- Background: #3b82f6
- Border-radius: 12px (top-right square)
- Padding: 16px
- Text: white

### InputBar
- Text input field (full width minus Send button)
- Placeholder text matching current question
- Send button (blue, icon: arrow or "Send")
- Skip link below input

### SkipButton
- Text: "Skip this question"
- Subtle, secondary text color
- No border/background

### ProgressBar
- Thin bar at top of chat area
- Shows completion percentage
- Smooth animation on progress

### WelcomeScreen
- Headline: "AI Audit for Your Business"
- Subtext: "Answer 13 questions to get personalized AI recommendations. Takes 7-10 minutes."
- CTA button: "Start Audit"

### EmailCaptureScreen
- Headline: "Where should we send your report?"
- Name input (required)
- Email input (required)
- Company input (optional)
- Submit button: "Get My Report"

### ReportScreen
- Headline: "Your AI Audit Report"
- Sections with recommendations
- AI Readiness Score (visual meter)
- CTA: "Book a Full Audit"

## 6. Technical Approach

**Stack:**
- Next.js 14+ (App Router)
- TypeScript
- Supabase JS client (for lead storage)
- @react-email/resend for PDF email (or browser print-to-PDF)
- CSS Modules or Tailwind (dark theme)
- Deployed on Vercel

**Architecture:**
- Single page `/` for the entire chat flow
- React state manages current question index, answers object, flow stage
- No backend needed for chat logic — all client-side
- Supabase call on email capture to store lead
- PDF generation via browser `window.print()` with print-specific CSS, or html2pdf.js

**State Shape:**
```typescript
interface AuditState {
  stage: 'welcome' | 'chat' | 'email' | 'report'
  currentQuestion: number
  answers: Record<string, string>
}
```

**Supabase Schema — leads table:**
```sql
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  business_name TEXT,
  business_description TEXT,
  team_size TEXT,
  work_location TEXT,
  pain_points TEXT,
  manual_tasks TEXT,
  ai_tools TEXT,
  budget TEXT,
  goal_6months TEXT,
  obstacles TEXT,
  referral_source TEXT,
  industry TEXT,
  recurring_clients TEXT,
  workflow_frustration TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  report_sent BOOLEAN DEFAULT false
);
```

**Environment Variables:**
- `NEXT_PUBLIC_SUPABASE_URL` = https://xxx.supabase.co
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = xxx
- `RESEND_API_KEY` = xxx (for email)

**AI Readiness Score Algorithm:**
- Score0-100 based on:
  - Team size (larger = higher potential)
  - Budget allocated (has budget = higher)
  - Current AI tool usage (using tools = higher)
  - Remote/hybrid (more complex = higher need)
  - Pain points around automation (clear pain = higher need)
