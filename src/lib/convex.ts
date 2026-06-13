// Convex client for the audit chatbot. Same deployment as the
// EMVY website repo (glad-camel-940). The chat writes leads via
// the public `audit_chatbot_leads:create` mutation; the board
// (emvy-board) reads from the same Convex and shows the lead.
//
// We call Convex over the HTTP API rather than via the codegen'd
// ConvexClient because the audit chatbot repo doesn't have its own
// convex/ directory — the functions live in the website repo and we
// only need a couple of entry points.
//
// Source of truth for the Convex schema: emvy-website-v2/convex/schema.ts
// and convex/audit_chatbot_leads.ts.

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  "https://glad-camel-940.convex.cloud";

export interface ConvexCallOptions {
  functionName: string; // e.g. "audit_chatbot_leads:create"
  args: Record<string, unknown>;
}

export async function callConvexMutation(opts: ConvexCallOptions): Promise<unknown> {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: opts.functionName,
      args: opts.args,
      format: "json",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convex mutation failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { status: string; value?: unknown; errorMessage?: string };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage}`);
  }
  return data.value;
}

// Mirrors callConvexMutation against the `/api/query` endpoint. Used by the
// reload-recovery path in page.tsx to read back a chatbot_lead row by id
// after a mid-build page reload — the report we may already have on the
// server. Throws on non-2xx / Convex-side errors (the caller catches and
// falls through to the SSE re-fire branch).
export async function callConvexQuery<T = unknown>(opts: ConvexCallOptions): Promise<T | null> {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: opts.functionName,
      args: opts.args,
      format: "json",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convex query failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { status: string; value?: T; errorMessage?: string };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage}`);
  }
  return (data.value as T) ?? null;
}
