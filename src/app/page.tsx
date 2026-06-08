"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rrjktvvnzjzlfquaghut.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2t0dmZuemp6bGZxdWFnaHV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4Mjg3MTYsImV4cCI6MTk2NTQwNDcxNn0.1nK0o7RJRLJdMIl4_dQgMqZ5ibjzDt6pbNcLqJYIJWw";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Questions
const questions = [
  { id: "business_name", text: "What is your business called and what do you do?", skip: false },
  { id: "team_size", text: "How many people are in your team?", skip: false },
  { id: "work_location", text: "Where does your team work? (remote / hybrid / office)", skip: false },
  { id: "pain_points", text: "What are the biggest pain points in your business right now?", skip: false },
  { id: "manual_tasks", text: "What manual tasks take most of your time?", skip: false },
  { id: "ai_tools", text: "Are you currently using any AI tools? If so, which ones?", skip: false },
  { id: "budget", text: "What's your monthly budget for AI tools or automation?", skip: false },
  { id: "goal_6months", text: "What's your main goal for your business in the next 6 months?", skip: false },
  { id: "obstacles", text: "What's stopping you from achieving that goal right now?", skip: false },
  { id: "referral_source", text: "How did you hear about us?", skip: false },
  { id: "industry", text: "What industry are you in?", skip: true },
  { id: "recurring_clients", text: "Do you have any recurring clients or subscribers?", skip: true },
  { id: "workflow_frustration", text: "What's your biggest frustration with your current workflow?", skip: true },
];

type Stage = "welcome" | "chat" | "email" | "report";

interface Message {
  role: "bot" | "user";
  content: string;
}

interface Answers {
  [key: string]: string | undefined;
  name?: string;
  email?: string;
  company?: string;
  business_name?: string;
  business_description?: string;
  team_size?: string;
  work_location?: string;
  pain_points?: string;
  manual_tasks?: string;
  ai_tools?: string;
  budget?: string;
  goal_6months?: string;
  obstacles?: string;
  referral_source?: string;
  industry?: string;
  recurring_clients?: string;
  workflow_frustration?: string;
}

function calculateAIRScore(answers: Answers): number {
  let score = 30;

  const teamSize = answers.team_size?.toLowerCase() || "";
  if (teamSize.includes("1") || teamSize.includes("solo") || teamSize.includes("just me")) {
    score += 5;
  } else if (teamSize.match(/\d+/)) {
    const num = parseInt(teamSize.match(/\d+/)?.[0] || "0");
    if (num >= 2 && num <= 5) score += 15;
    else if (num >= 6 && num <= 15) score += 20;
    else if (num > 15) score += 25;
  }

  const workLoc = answers.work_location?.toLowerCase() || "";
  if (workLoc.includes("remote")) score += 15;
  else if (workLoc.includes("hybrid")) score += 10;
  else score += 5;

  const budget = answers.budget?.toLowerCase() || "";
  if (budget.includes("0") || budget.includes("nothing") || budget.includes("not")) {
    score += 0;
  } else if (budget.includes("500") || budget.includes("1k") || budget.includes("1000")) {
    score += 20;
  } else if (budget.match(/\d+/)) {
    const num = parseInt(budget.match(/\d+/)?.[0] || "0");
    if (num > 0) score += 15;
  }

  const aiTools = answers.ai_tools?.toLowerCase() || "";
  if (aiTools.includes("none") || aiTools.includes("not using") || aiTools === "") {
    score += 0;
  } else {
    score += 20;
  }

  const pain = answers.pain_points?.toLowerCase() || "";
  if (pain.includes("time") || pain.includes("manual") || pain.includes("automation")) {
    score += 10;
  }

  return Math.min(score, 100);
}

function getRecommendations(answers: Answers): string[] {
  const recs: string[] = [];
  const painPoints = (answers.pain_points || "").toLowerCase();
  const manualTasks = (answers.manual_tasks || "").toLowerCase();
  const aiTools = (answers.ai_tools || "").toLowerCase();
  const workLoc = (answers.work_location || "").toLowerCase();

  if (painPoints.includes("email") || manualTasks.includes("email")) {
    recs.push("Automate email responses with AI-powered email management");
  }
  if (painPoints.includes("social media") || manualTasks.includes("social media")) {
    recs.push("Implement AI social media scheduling to auto-post and generate content");
  }
  if (painPoints.includes("data entry") || manualTasks.includes("data entry") || manualTasks.includes("spreadsheet")) {
    recs.push("Use AI-powered data entry automation to eliminate manual spreadsheet work");
  }
  if (painPoints.includes("customer") || painPoints.includes("support")) {
    recs.push("Deploy AI chatbots for instant customer support on your website");
  }
  if (painPoints.includes("content") || manualTasks.includes("content")) {
    recs.push("Use AI content generation for blog posts, product descriptions, and marketing copy");
  }
  if (painPoints.includes("invoicing") || painPoints.includes("billing") || manualTasks.includes("invoice")) {
    recs.push("Automate invoicing and payment reminders with accounting AI tools");
  }
  if (workLoc.includes("remote")) {
    recs.push("Set up AI-powered team collaboration and project management automation");
  }
  if (!aiTools || aiTools === "none" || aiTools.includes("not using")) {
    recs.push("Start with basic AI tools like ChatGPT or Claude for document drafting and brainstorming");
  }
  if (recs.length < 3) {
    recs.push("Automate repetitive administrative tasks with AI workflow tools");
    recs.push("Implement AI-powered CRM automation");
    recs.push("Use AI for data analysis and reporting to make faster business decisions");
  }

  return recs.slice(0, 5);
}

export default function AuditChatbot() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [reportHtml, setReportHtml] = useState("");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (stage === "chat") {
      inputRef.current?.focus();
    }
  }, [stage, currentQuestion]);

  const startAudit = () => {
    setStage("chat");
    setMessages([
      { role: "bot", content: questions[0].text }
    ]);
  };

  const handleSend = () => {
    if (!input.trim()) return;

    const userAnswer = input.trim();
    const questionId = questions[currentQuestion].id;

    setAnswers(prev => ({ ...prev, [questionId]: userAnswer }));
    setMessages(prev => [...prev, { role: "user", content: userAnswer }]);
    setInput("");

    // Show typing indicator
    setIsTyping(true);

    if (currentQuestion < questions.length - 1) {
      setTimeout(() => {
        setIsTyping(false);
        setCurrentQuestion(prev => prev + 1);
        setMessages(prev => [...prev, { role: "bot", content: questions[currentQuestion + 1].text }]);
      }, 400 + Math.random() * 300);
    } else {
      setTimeout(() => {
        setIsTyping(false);
        setStage("email");
      }, 400 + Math.random() * 300);
    }
  };

  const handleSkip = () => {
    const questionId = questions[currentQuestion].id;
    setAnswers(prev => ({ ...prev, [questionId]: "" }));

    setIsTyping(true);
    if (currentQuestion < questions.length - 1) {
      setTimeout(() => {
        setIsTyping(false);
        setCurrentQuestion(prev => prev + 1);
        setMessages(prev => [...prev, { role: "bot", content: questions[currentQuestion + 1].text }]);
      }, 300);
    } else {
      setTimeout(() => {
        setIsTyping(false);
        setStage("email");
      }, 300);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleEmailSubmit = async () => {
    setEmailError("");

    if (!name.trim()) {
      setEmailError("Please enter your name");
      return;
    }
    if (!email.trim() || !validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    const finalAnswers: Answers = { ...answers, name, email, company };

    try {
      const { error } = await supabase.from("leads").insert({
        name: finalAnswers.name,
        email: finalAnswers.email,
        company: finalAnswers.company || null,
        business_name: finalAnswers.business_name || null,
        business_description: finalAnswers.business_description || null,
        team_size: finalAnswers.team_size || null,
        work_location: finalAnswers.work_location || null,
        pain_points: finalAnswers.pain_points || null,
        manual_tasks: finalAnswers.manual_tasks || null,
        ai_tools: finalAnswers.ai_tools || null,
        budget: finalAnswers.budget || null,
        goal_6months: finalAnswers.goal_6months || null,
        obstacles: finalAnswers.obstacles || null,
        referral_source: finalAnswers.referral_source || null,
        industry: finalAnswers.industry || null,
        recurring_clients: finalAnswers.recurring_clients || null,
        workflow_frustration: finalAnswers.workflow_frustration || null,
      });
      if (error) console.error("Supabase error:", error);
    } catch (err) {
      console.error("Failed to save lead:", err);
    }

    const score = calculateAIRScore(finalAnswers);
    const recommendations = getRecommendations(finalAnswers);

    // Professional HTML report using the playbook's PDF template system
    const reportContent = `
      <div style="font-family: 'Source Serif 4', Georgia, serif; max-width: 600px; margin: 0 auto; padding: 0;">
        <!-- Header -->
        <div style="margin-bottom: 40px;">
          <div style="font-family: 'Inter', sans-serif; font-size: 9pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #f59e0b; margin-bottom: 8px;">AI Business Audit</div>
          <h1 style="font-family: 'Inter', sans-serif; font-size: 28pt; font-weight: 700; letter-spacing: -0.02em; color: #1a1a1a; margin: 0 0 4px 0;">EMVY Audit Report</h1>
          <p style="font-family: 'Inter', sans-serif; font-size: 10pt; color: #6b6b70; margin: 0;">Prepared for ${finalAnswers.name} · ${finalAnswers.email}</p>
          <div style="width: 40px; height: 3px; background: #f59e0b; margin-top: 16px;"></div>
        </div>

        <!-- Score Section -->
        <div style="background: #F7F7F8; border-radius: 10px; padding: 28px; margin-bottom: 32px; text-align: center;">
          <div style="font-family: 'Inter', sans-serif; font-size: 9pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6b6b70; margin-bottom: 12px;">AI Readiness Score</div>
          <div style="font-family: 'Inter', sans-serif; font-size: 52pt; font-weight: 800; letter-spacing: -0.03em; color: ${score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'}; line-height: 1;">${score}<span style="font-size: 24pt; font-weight: 500; color: #6b6b70;">/100</span></div>
          <p style="font-family: 'Source Serif 4', serif; font-size: 12pt; color: #4B4B4B; margin: 10px 0 0 0;">
            ${score >= 70 ? 'High readiness — well positioned for AI adoption' : score >= 40 ? 'Moderate readiness — meaningful opportunity ahead' : 'Early stage — significant AI transformation potential'}
          </p>
        </div>

        <!-- Business Snapshot -->
        <div style="margin-bottom: 32px;">
          <div style="font-family: 'Inter', sans-serif; font-size: 9pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6b6b70; margin-bottom: 12px;">Business Snapshot</div>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #6b6b70; width: 40%;">Business</td><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #1a1a1a; font-weight: 500;">${finalAnswers.business_name || '—'}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #6b6b70;">Team Size</td><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #1a1a1a; font-weight: 500;">${finalAnswers.team_size || '—'}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #6b6b70;">Work Location</td><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #1a1a1a; font-weight: 500;">${finalAnswers.work_location || '—'}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #6b6b70;">AI Tools</td><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #1a1a1a; font-weight: 500;">${finalAnswers.ai_tools || 'None yet'}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #6b6b70;">Budget</td><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #1a1a1a; font-weight: 500;">${finalAnswers.budget || '—'}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #6b6b70;">Goal (6 months)</td><td style="padding: 10px 0; border-bottom: 1px solid #E5E5E5; font-size: 11pt; color: #1a1a1a; font-weight: 500;">${finalAnswers.goal_6months || '—'}</td></tr>
          </table>
        </div>

        <!-- Recommendations -->
        <div style="margin-bottom: 32px;">
          <div style="font-family: 'Inter', sans-serif; font-size: 9pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6b6b70; margin-bottom: 12px;">Top Easy-Win Recommendations</div>
          <ol style="margin: 0; padding: 0 0 0 20px;">
            ${recommendations.map((rec, i) => `<li style="font-family: 'Source Serif 4', serif; font-size: 11pt; color: #1a1a1a; line-height: 1.6; margin-bottom: 8px;">${rec}</li>`).join('')}
          </ol>
        </div>

        <!-- CTA -->
        <div style="background: #f59e0b; border-radius: 10px; padding: 24px; text-align: center;">
          <h2 style="font-family: 'Inter', sans-serif; font-size: 16pt; font-weight: 700; color: #000; margin: 0 0 8px 0;">Ready for a Full Audit?</h2>
          <p style="font-family: 'Source Serif 4', serif; font-size: 11pt; color: rgba(0,0,0,0.7); margin: 0 0 16px 0;">Get a comprehensive AI roadmap tailored to your business. Our experts will analyse your workflows and create a custom implementation plan.</p>
          <a href="mailto:audit@emvyai.com" style="display: inline-block; font-family: 'Inter', sans-serif; font-size: 11pt; font-weight: 700; background: #000; color: #f59e0b; padding: 12px 28px; border-radius: 999px; text-decoration: none; letter-spacing: 0.02em;">Book a Full Audit</a>
        </div>

        <!-- Footer -->
        <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #E5E5E5; text-align: center;">
          <p style="font-family: 'Inter', sans-serif; font-size: 9pt; color: #6b6b70; margin: 0;">EMVY AI · emvyai.com · audit@emvyai.com</p>
        </div>
      </div>
    `;

    setReportHtml(reportContent);
    setStage("report");
  };

  const generatePdf = async () => {
    setIsGeneratingPdf(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.getElementById("report-content");
      if (!element) return;
      const opt = {
        margin: 10,
        filename: `EMVY-AI-Audit-${name.replace(/\s+/g, '-')}.pdf`,
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
      };
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const progress = ((currentQuestion + 1) / questions.length) * 100;

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Background — single subtle accent glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          style={{
            position: 'absolute',
            top: '20%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '600px',
            height: '600px',
            background: 'radial-gradient(circle, rgba(245,158,11,0.04) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Header */}
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{ background: 'rgba(9,9,11,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center"
              style={{
                width: '32px',
                height: '32px',
                background: '#f59e0b',
                borderRadius: '8px',
              }}
            >
              <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800, fontSize: '14px', color: '#000' }}>E</span>
            </div>
            <div>
              <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '16px', color: '#fafafa', letterSpacing: '-0.02em' }}>EMVY</span>
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 400, fontSize: '16px', color: '#6b6b70', marginLeft: '4px' }}>AI Audit</span>
            </div>
          </div>

          {stage === "chat" && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="progress-track" style={{ width: '80px' }}>
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-dot" />
              </div>
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '11px', color: '#6b6b70', fontWeight: 500 }}>
                {currentQuestion + 1}/{questions.length}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pt-[72px] pb-28 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-10">

          {/* ═══════════════ WELCOME ═══════════════ */}
          {stage === "welcome" && (
            <div className="min-h-[70vh] flex flex-col justify-center">
              {/* Corner decorators — restrained */}
              <div className="geo-corner geo-corner-tl" style={{ marginBottom: '48px' }} />

              <div className="stagger-children">
                <div style={{ marginBottom: '32px' }}>
                  <div className="label-accent" style={{ marginBottom: '10px' }}>Free · 7 minutes · No commitment</div>
                  <h1 style={{ fontSize: 'clamp(40px, 8vw, 64px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#fafafa', margin: 0 }}>
                    Business
                  </h1>
                  <h1 style={{ fontSize: 'clamp(40px, 8vw, 64px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#f59e0b', margin: 0 }}>
                    AI Audit
                  </h1>
                </div>

                <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '17px', lineHeight: 1.65, color: '#a1a1aa', maxWidth: '480px', margin: '0 0 32px 0' }}>
                  Answer 13 targeted questions. Get a personalised AI readiness score and recommendations tailored to your business.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '40px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="geo-dot" />
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#6b6b70' }}>7–10 minutes</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="geo-dot" />
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#6b6b70' }}>13 questions</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="geo-dot" />
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#6b6b70' }}>PDF report</span>
                  </div>
                </div>

                <button onClick={startAudit} className="btn-primary" style={{ marginTop: '8px' }}>
                  Begin Assessment
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>

              <div className="geo-corner geo-corner-br" style={{ marginTop: '64px' }} />
            </div>
          )}

          {/* ═══════════════ CHAT ═══════════════ */}
          {stage === "chat" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingTop: '8px' }}>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-slide-up`}
                  style={{ animationDelay: `${Math.min(idx * 40, 200)}ms` }}
                >
                  <div
                    className={msg.role === "user" ? "message-user" : "message-bot"}
                  >
                    <span className="message-text">{msg.content}</span>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div className="flex justify-start animate-fade-in">
                  <div className="message-bot">
                    <div className="typing-indicator">
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}

          {/* ═══════════════ EMAIL CAPTURE ═══════════════ */}
          {stage === "email" && (
            <div className="min-h-[70vh] flex flex-col justify-center">
              <div className="geo-corner geo-corner-tl" style={{ marginBottom: '40px' }} />

              <div className="stagger-children">
                <div style={{ marginBottom: '8px' }}>
                  <div className="label-accent" style={{ marginBottom: '10px' }}>Your Report</div>
                  <h2 style={{ fontSize: 'clamp(32px, 6vw, 48px)', fontWeight: 800, letterSpacing: '-0.025em', color: '#fafafa', lineHeight: 1.1, margin: '0 0 4px 0' }}>
                    Is Ready
                  </h2>
                  <h2 style={{ fontSize: 'clamp(32px, 6vw, 48px)', fontWeight: 800, letterSpacing: '-0.025em', color: '#f59e0b', lineHeight: 1.1, margin: 0 }}>
                    to Send
                  </h2>
                </div>

                <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '16px', lineHeight: 1.6, color: '#a1a1aa', maxWidth: '420px', margin: '0 0 36px 0' }}>
                  Enter your details to receive your personalised AI audit report with actionable recommendations.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '400px' }}>
                  <div>
                    <label className="label-uppercase" style={{ display: 'block', marginBottom: '8px' }}>Full Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="input-field"
                      placeholder="Jane Smith"
                    />
                  </div>

                  <div>
                    <label className="label-uppercase" style={{ display: 'block', marginBottom: '8px' }}>Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input-field"
                      placeholder="jane@company.com"
                    />
                  </div>

                  <div>
                    <label className="label-uppercase" style={{ display: 'block', marginBottom: '8px' }}>Company <span style={{ opacity: 0.5 }}>(optional)</span></label>
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      className="input-field"
                      placeholder="Acme Inc"
                    />
                  </div>

                  {emailError && (
                    <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#ef4444', margin: 0 }}>{emailError}</p>
                  )}

                  <button onClick={handleEmailSubmit} className="btn-primary" style={{ marginTop: '8px' }}>
                    Get My Report
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════ REPORT ═══════════════ */}
          {stage === "report" && (
            <div style={{ paddingTop: '8px' }}>
              <div className="stagger-children" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div>
                  <div className="label-accent" style={{ marginBottom: '8px' }}>AI Business Audit</div>
                  <h2 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.025em', color: '#fafafa', margin: 0 }}>
                    Your Report
                  </h2>
                  <div className="geo-line-short" style={{ marginTop: '12px' }} />
                </div>

                {/* The report — white page, print-ready */}
                <div
                  id="report-content"
                  className="card"
                  style={{ background: '#ffffff', border: 'none', padding: '40px', borderRadius: '12px' }}
                >
                  <div dangerouslySetInnerHTML={{ __html: reportHtml }} />
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button
                    onClick={generatePdf}
                    disabled={isGeneratingPdf}
                    className="btn-primary"
                    style={{ justifyContent: 'center' }}
                  >
                    {isGeneratingPdf ? (
                      <>
                        <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M8 2v8M4 6l4 4 4-4M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Download PDF Report
                      </>
                    )}
                  </button>

                  <div className="card-elevated" style={{ textAlign: 'center', padding: '24px' }}>
                    <h3 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: '16px', fontWeight: 700, color: '#fafafa', margin: '0 0 6px 0' }}>Want expert guidance?</h3>
                    <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#a1a1aa', margin: '0 0 16px 0', lineHeight: 1.55 }}>
                      Book a proper audit for full recommendations and a custom AI roadmap.
                    </p>
                    <a
                      href="mailto:audit@emvyai.com"
                      className="btn-outline"
                      style={{ display: 'inline-block', textDecoration: 'none' }}
                    >
                      Book a Full Audit
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ═══════════════ INPUT BAR ═══════════════ */}
      {stage === "chat" && (
        <footer
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'rgba(9,9,11,0.95)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            padding: '16px 24px',
          }}
        >
          <div className="max-w-3xl mx-auto">
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                className="input-field"
                placeholder="Type your answer..."
                style={{ flex: 1 }}
              />
              <button
                onClick={handleSend}
                className="btn-primary"
                style={{ padding: '12px 20px', flexShrink: 0 }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            {questions[currentQuestion].skip && (
              <button onClick={handleSkip} className="btn-ghost" style={{ fontSize: '12px', marginTop: '10px', padding: '6px 0' }}>
                Skip this question
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}