// EMVY AuditAgent — Cloudflare Durable Object backing the audit chatbot.
// One instance per lead session, identified by session ID. State persists
// across requests and reloads.
//
// Slice 0: minimal scaffolding with a `ping()` method to verify the
// DO binding + HTTP routing work end-to-end. Slices 1+ add the chat loop,
// tools, and personality.

import { Agent } from "agents";

export interface Env {
  AUDIT_AGENT: DurableObjectNamespace<AuditAgent>;
  // Vars (set in wrangler.toml [vars])
  CONVEX_URL: "https://glad-camel-940.convex.cloud";
  SUPABASE_URL: "https://rrjktvvnzjzlfquaghut.supabase.co";
  VERCEL_REPORT_URL?: string;
  // Secrets (set via `wrangler secret put`)
  MINIMAX_API_KEY?: string;
  SUPABASE_ANON_KEY?: string;
}

// Assessment shape — mirrors src/lib/agent.ts (kept in sync; the report
// generator on Vercel is the source of truth for the canonical shape).
export interface Assessment {
  businessName?: string;
  businessDescription?: string;
  teamSize?: string;
  industry?: string;
  aiTools?: string;
  budget?: string;
  goal?: string;
  obstacles?: string;
  painPoints: string[];
  manualTasks: string[];
  scores: Record<string, number>;
  findings: Array<{ category: string; text: string; severity: "high" | "medium" | "low" }>;
  categoriesCovered: string[];
  messageCount: number;
  readyForEmail: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export interface State {
  sessionId: string;
  history: ChatMessage[];
  assessment: Assessment;
  lead: { name?: string; email?: string; company?: string } | null;
  report: unknown | null;
  reportReady: boolean;
  createdAt: number;
  updatedAt: number;
}

function emptyAssessment(): Assessment {
  return {
    painPoints: [],
    manualTasks: [],
    scores: {},
    findings: [],
    categoriesCovered: [],
    messageCount: 0,
    readyForEmail: false,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class AuditAgent extends Agent<Env, State> {
  // `initialState` runs once per DO instance on first activation.
  initialState: State = {
    sessionId: "",
    history: [],
    assessment: emptyAssessment(),
    lead: null,
    report: null,
    reportReady: false,
    createdAt: 0,
    updatedAt: 0,
  };

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onStart(): Promise<void> {
    if (!this.state.createdAt) {
      this.setState({
        ...this.state,
        sessionId: this.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  // ─── HTTP entry point ─────────────────────────────────────────────────────
  // When a non-WebSocket request hits the DO, the partyserver runtime
  // routes it here. We implement a simple JSON-RPC: callers POST
  // { "method": "...", "args": [...] } and we return the result.
  // The Vercel proxy uses this for every chat turn.

  async onRequest(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return json({ ok: true, name: this.name, state: this.state });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body: { method?: string; args?: unknown[] } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const method = body.method;
    const args = Array.isArray(body.args) ? body.args : [];
    if (typeof method !== "string" || !method) {
      return json({ error: "Missing method" }, 400);
    }

    const fn = (this as unknown as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      return json({ error: `Unknown method: ${method}` }, 404);
    }

    try {
      const result = await (fn as (...a: unknown[]) => Promise<unknown>).apply(
        this,
        args
      );
      return json({ ok: true, result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return json({ ok: false, error: message }, 500);
    }
  }

  // ─── Methods ──────────────────────────────────────────────────────────────

  async ping(): Promise<{ ok: true; ts: number; sessionId: string; messageCount: number }> {
    return {
      ok: true,
      ts: Date.now(),
      sessionId: this.name,
      messageCount: this.state.history.length,
    };
  }

  async getState(): Promise<State> {
    return this.state;
  }
}
