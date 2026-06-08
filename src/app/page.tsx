"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rrjktvvnzjzlfquaghut.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbG...lder";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Questions
const questions = [
  { id: "business_name", text: "What is your business called and what do you do?", skip: false },
  { id: "team_size", text: "How many people are in your team?", skip: false },
  { id: "work_location", text: "Where does your team work? (remote / hybrid / office)", skip: false },
  { id: "pain_points", text: "What are the biggest pain points in your business right now?", skip: false },
  { id: "manual_tasks", text: "What manual tasks take up most of your time?", skip: false },
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
  let score = 30; // Base score
  
  // Team size scoring
  const teamSize = answers.team_size?.toLowerCase() || "";
  if (teamSize.includes("1") || teamSize.includes("solo") || teamSize.includes("just me")) {
    score += 5;
  } else if (teamSize.match(/\d+/)) {
    const num = parseInt(teamSize.match(/\d+/)?.[0] || "0");
    if (num >= 2 && num <= 5) score += 15;
    else if (num >= 6 && num <= 15) score += 20;
    else if (num > 15) score += 25;
  }
  
  // Work location (remote/hybrid = more complex = higher need)
  const workLoc = answers.work_location?.toLowerCase() || "";
  if (workLoc.includes("remote")) score += 15;
  else if (workLoc.includes("hybrid")) score += 10;
  else score += 5;
  
  // Budget
  const budget = answers.budget?.toLowerCase() || "";
  if (budget.includes("0") || budget.includes("nothing") || budget.includes("not")) {
    score += 0;
  } else if (budget.includes("500") || budget.includes("1k") || budget.includes("1000")) {
    score += 20;
  } else if (budget.match(/\d+/)) {
    const num = parseInt(budget.match(/\d+/)?.[0] || "0");
    if (num > 0) score += 15;
  }
  
  // AI tools usage
  const aiTools = answers.ai_tools?.toLowerCase() || "";
  if (aiTools.includes("none") || aiTools.includes("not using") || aiTools === "") {
    score += 0;
  } else {
    score += 20;
  }
  
  // Pain points indicate readiness
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
  
  // Check for common automation opportunities
  if (painPoints.includes("email") || manualTasks.includes("email")) {
    recs.push("Automate email responses with AI-powered email management tools like SMTP or email APIs");
  }
  
  if (painPoints.includes("social media") || manualTasks.includes("social media")) {
    recs.push("Implement AI social media scheduling tools to auto-post and generate content");
  }
  
  if (painPoints.includes("data entry") || manualTasks.includes("data entry") || manualTasks.includes("spreadsheet")) {
    recs.push("Use AI-powered data entry automation to eliminate manual spreadsheet work");
  }
  
  if (painPoints.includes("customer") || painPoints.includes("support")) {
    recs.push("Deploy AI chatbots for instant customer support on your website");
  }
  
  if (painPoints.includes("content") || manualTasks.includes("content")) {
    recs.push("Use AI content generation tools for blog posts, product descriptions, and marketing copy");
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
  
  // Default recommendations if nothing specific matched
  if (recs.length < 3) {
    recs.push("Automate repetitive administrative tasks with AI workflow tools");
    recs.push("Implement AI-powered customer relationship management (CRM) automation");
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    
    // Save answer
    setAnswers(prev => ({ ...prev, [questionId]: userAnswer }));
    
    // Add user message
    setMessages(prev => [...prev, { role: "user", content: userAnswer }]);
    setInput("");
    
    // Move to next question or email capture
    if (currentQuestion < questions.length - 1) {
      setTimeout(() => {
        setCurrentQuestion(prev => prev + 1);
        setMessages(prev => [...prev, { role: "bot", content: questions[currentQuestion + 1].text }]);
      }, 300);
    } else {
      setTimeout(() => {
        setStage("email");
      }, 300);
    }
  };

  const handleSkip = () => {
    // Add empty answer and move to next
    const questionId = questions[currentQuestion].id;
    setAnswers(prev => ({ ...prev, [questionId]: "" }));
    
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
      setMessages(prev => [...prev, { role: "bot", content: questions[currentQuestion + 1].text }]);
    } else {
      setStage("email");
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
    
    // Save email answers
    const finalAnswers: Answers = { ...answers, name, email, company };
    
    // Push to Supabase
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
      
      if (error) {
        console.error("Supabase error:", error);
      }
    } catch (err) {
      console.error("Failed to save lead:", err);
    }
    
    // Generate report
    const score = calculateAIRScore(finalAnswers);
    const recommendations = getRecommendations(finalAnswers);
    
    const reportContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
 <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">EMVY AI Audit Report</h1>
        <p style="color: #666; margin-bottom: 24px;">Prepared for ${finalAnswers.name} | ${finalAnswers.email}</p>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
          <h2 style="font-size: 18px; margin-bottom: 12px;">AI Readiness Score</h2>
          <div style="font-size: 48px; font-weight: bold; color: ${score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444'};">${score}/100</div>
          <p style="color: #666; margin-top: 8px;">${score >= 70 ? 'High readiness' : score >= 40 ? 'Moderate readiness' : 'Early stage - significant opportunity'}</p>
        </div>
        
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 18px; margin-bottom: 12px;">Your Business Snapshot</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Business</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${finalAnswers.business_name || 'Not specified'}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Team Size</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${finalAnswers.team_size || 'Not specified'}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Work Location</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${finalAnswers.work_location || 'Not specified'}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">AI Tools</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${finalAnswers.ai_tools || 'None specified'}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Budget</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${finalAnswers.budget || 'Not specified'}</td></tr>
          </table>
        </div>
        
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 18px; margin-bottom: 12px;">Top Easy-Win Recommendations</h2>
          <ol style="padding-left: 20px;">
            ${recommendations.map((rec, i) => `<li style="margin-bottom: 8px;">${rec}</li>`).join('')}
          </ol>
        </div>
        
        <div style="background: #3b82f6; color: white; padding: 20px; border-radius: 8px; text-align: center;">
          <h2 style="font-size: 18px; margin-bottom: 8px;">Ready for a Full AI Audit?</h2>
          <p style="margin-bottom: 16px;">Get comprehensive recommendations tailored to your business. Our experts will analyze your workflows and create a custom AI implementation roadmap.</p>
          <a href="mailto:audit@emvyai.com" style="background: white; color: #3b82f6; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Book a Full Audit</a>
        </div>
      </div>
    `;
    
    setReportHtml(reportContent);
    setStage("report");
  };

  const generatePdf = async () => {
    setIsGeneratingPdf(true);
    
    try {
      // Dynamically import html2pdf to avoid SSR issues
      const html2pdf = (await import("html2pdf.js")).default;
      
      const element = document.getElementById("report-content");
      if (!element) return;
      
      const opt = {
        margin: 10,
        filename: `EMVY-AI-Audit-Report-${name}.pdf`,
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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#141414] border-b border-[#262626] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold text-lg">EMVY AI Audit</span>
          </div>
          {stage === "chat" && (
            <div className="flex items-center gap-2">
              <span className="text-[#a3a3a3] text-sm">Question {currentQuestion + 1} of {questions.length}</span>
            </div>
          )}
        </div>
      </header>

      {/* Progress Bar */}
      {stage === "chat" && (
        <div className="fixed top-[52px] left-0 right-0 z-40 bg-[#0a0a0a] h-1">
          <div 
            className="h-full bg-[#3b82f6] transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 pt-16 pb-24 overflow-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Welcome Screen */}
          {stage === "welcome" && (
            <div className="fade-in flex flex-col items-center justify-center min-h-[70vh] text-center">
              <h1 className="text-3xl font-semibold text-white mb-4">AI Audit for Your Business</h1>
              <p className="text-[#a3a3a3] text-lg mb-2 max-w-md">
                Answer 13 questions to get personalized AI recommendations for your business.
              </p>
              <p className="text-[#a3a3a3] mb-8">Takes 7-10 minutes to complete.</p>
              <button
                onClick={startAudit}
                className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-8 py-3 rounded-md font-medium transition-colors"
              >
                Start Audit
              </button>
            </div>
          )}

          {/* Chat Screen */}
          {stage === "chat" && (
            <div className="space-y-4">
              {messages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} fade-in`}
                >
                  <div 
                    className={`max-w-[80%] px-4 py-3 rounded-xl text-sm ${
                      msg.role === "user" 
                        ? "bg-[#3b82f6] text-white rounded-tr-sm" 
                        : "bg-[#1f1f1f] text-white rounded-tl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Email Capture Screen */}
          {stage === "email" && (
            <div className="fade-in max-w-md mx-auto">
              <h2 className="text-2xl font-semibold text-white mb-2">Where should we send your report?</h2>
              <p className="text-[#a3a3a3] mb-6">Enter your details to receive your personalized AI audit report.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#a3a3a3] mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#262626] rounded-md px-4 py-2 text-white focus:outline-none focus:border-[#3b82f6]"
                    placeholder="Jane Smith"
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-[#a3a3a3] mb-1">Email Address *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#262626] rounded-md px-4 py-2 text-white focus:outline-none focus:border-[#3b82f6]"
                    placeholder="jane@company.com"
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-[#a3a3a3] mb-1">Company Name (Optional)</label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#262626] rounded-md px-4 py-2 text-white focus:outline-none focus:border-[#3b82f6]"
                    placeholder="Acme Inc"
                  />
                </div>
                
                {emailError && (
                  <p className="text-[#ef4444] text-sm">{emailError}</p>
                )}
                
                <button
                  onClick={handleEmailSubmit}
                  className="w-full bg-[#3b82f6] hover:bg-[#2563eb] text-white px-6 py-3 rounded-md font-medium transition-colors mt-4"
                >
                  Get My Report
                </button>
              </div>
            </div>
          )}

          {/* Report Screen */}
          {stage === "report" && (
            <div className="fade-in">
              <div id="report-content" className="bg-white text-black rounded-lg p-6 mb-6">
                <h1 className="text-2xl font-bold mb-2">EMVY AI Audit Report</h1>
                <p className="text-gray-600 mb-6">Prepared for {name} | {email}</p>
                
                <div className="bg-gray-100 p-5 rounded-lg mb-6">
                  <h2 className="text-lg font-semibold mb-3">AI Readiness Score</h2>
                  <div 
                    className="text-5xl font-bold"
                    style={{ color: calculateAIRScore({...answers, name, email}) >= 70 ? '#22c55e' : calculateAIRScore({...answers, name, email}) >= 40 ? '#eab308' : '#ef4444' }}
                  >
                    {calculateAIRScore({...answers, name, email})}/100
                  </div>
                  <p className="text-gray-600 mt-2">
                    {calculateAIRScore({...answers, name, email}) >= 70 
                      ? 'High readiness - You are well positioned for AI adoption'
                      : calculateAIRScore({...answers, name, email}) >= 40 
                        ? 'Moderate readiness - Some opportunities identified'
                        : 'Early stage - Significant opportunity for AI transformation'}
                  </p>
                </div>
                
                <div className="mb-6">
                  <h2 className="text-lg font-semibold mb-3">Your Business Snapshot</h2>
                  <table className="w-full text-sm">
                    <tbody>
                      <tr><td className="py-2 text-gray-500 border-b border-gray-200">Business</td><td className="py-2 border-b border-gray-200">{answers.business_name || 'Not specified'}</td></tr>
                      <tr><td className="py-2 text-gray-500 border-b border-gray-200">Team Size</td><td className="py-2 border-b border-gray-200">{answers.team_size || 'Not specified'}</td></tr>
                      <tr><td className="py-2 text-gray-500 border-b border-gray-200">Work Location</td><td className="py-2 border-b border-gray-200">{answers.work_location || 'Not specified'}</td></tr>
                      <tr><td className="py-2 text-gray-500 border-b border-gray-200">AI Tools</td><td className="py-2 border-b border-gray-200">{answers.ai_tools || 'None specified'}</td></tr>
                      <tr><td className="py-2 text-gray-500 border-b border-gray-200">Budget</td><td className="py-2 border-b border-gray-200">{answers.budget || 'Not specified'}</td></tr>
                      <tr><td className="py-2 text-gray-500 border-b border-gray-200">Goal (6 months)</td><td className="py-2 border-b border-gray-200">{answers.goal_6months || 'Not specified'}</td></tr>
                      <tr><td className="py-2 text-gray-500 border-b border-gray-200">Main Obstacles</td><td className="py-2 border-b border-gray-200">{answers.obstacles || 'Not specified'}</td></tr>
                    </tbody>
                  </table>
                </div>
                
                <div className="mb-6">
                  <h2 className="text-lg font-semibold mb-3">Top Easy-Win Recommendations</h2>
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    {getRecommendations({...answers, name, email}).map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ol>
                </div>
                
                <div className="bg-blue-600 text-white p-5 rounded-lg text-center">
                  <h2 className="text-lg font-semibold mb-2">Ready for a Full AI Audit?</h2>
                  <p className="mb-4 text-sm opacity-90">Get comprehensive recommendations tailored to your business. Our experts will analyze your workflows and create a custom AI implementation roadmap.</p>
                  <a href="mailto:audit@emvyai.com" className="inline-block bg-white text-blue-600 px-6 py-2 rounded-md font-medium">Book a Full Audit</a>
                </div>
              </div>
              
              <div className="flex flex-col gap-3">
                <button
                  onClick={generatePdf}
                  disabled={isGeneratingPdf}
                  className="w-full bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-[#3b82f6]/50 text-white px-6 py-3 rounded-md font-medium transition-colors"
                >
                  {isGeneratingPdf ? "Generating PDF..." : "Download PDF Report"}
                </button>
                
                <div className="bg-[#141414] border border-[#262626] p-5 rounded-lg text-center">
                  <h3 className="text-white font-medium mb-2">Want expert guidance?</h3>
                  <p className="text-[#a3a3a3] text-sm mb-4">Book a proper audit for full recommendations and a custom AI roadmap.</p>
                  <a 
                    href="mailto:audit@emvyai.com" 
                    className="inline-block bg-[#3b82f6] hover:bg-[#2563eb] text-white px-6 py-2 rounded-md font-medium transition-colors text-sm"
                  >
                    Book a Full Audit
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Input Bar */}
      {stage === "chat" && (
        <footer className="fixed bottom-0 left-0 right-0 bg-[#141414] border-t border-[#262626] px-4 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 mb-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1 bg-[#1f1f1f] border border-[#262626] rounded-md px-4 py-2 text-white focus:outline-none focus:border-[#3b82f6]"
                placeholder="Type your answer..."
              />
              <button
                onClick={handleSend}
                className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-4 py-2 rounded-md font-medium transition-colors"
              >
                Send
              </button>
            </div>
            {questions[currentQuestion].skip && (
              <button
                onClick={handleSkip}
                className="text-[#a3a3a3] text-sm hover:text-white transition-colors"
              >
                Skip this question
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
