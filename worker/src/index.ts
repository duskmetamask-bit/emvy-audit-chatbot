// EMVY Audit Agent — Cloudflare Worker entry.
//
// Routes /agents/audit-agent/:id/* to the AuditAgent Durable Object.
// The DO's `onRequest` method handles the actual JSON-RPC dispatch.

import { routeAgentRequest } from "agents";
import { AuditAgent } from "./agent";

export { AuditAgent };

interface Env {
  AUDIT_AGENT: DurableObjectNamespace;
  MINIMAX_API_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_URL?: string;
  VERCEL_REPORT_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;

    return json({ error: "Not found", path: url.pathname }, 404);
  },
};
