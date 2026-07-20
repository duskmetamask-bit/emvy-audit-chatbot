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
//
// Type-safe call wrapper: the args shape for each `functionName`
// string is constrained by the generated types at
// src/lib/convex-generated/audit-chatbot-types.d.ts (regenerated from
// the website repo via `npm run sync:convex-types`). Drift between the
// front-end args and the server-side validators fails `tsc --noEmit`
// at build time — see scripts/verify-convex-types.mjs for the
// bullet-proof commit-time gate.

import type {
  AuditChatbotLeadsCreateArgs,
  AuditChatbotLeadsCreateReturn,
  AuditChatbotLeadsGetArgs,
  AuditChatbotLeadsGetReturn,
  AuditChatbotLeadsGetStatsArgs,
  AuditChatbotLeadsGetStatsReturn,
  AuditChatbotLeadsListArgs,
  AuditChatbotLeadsListReturn,
  AuditChatbotLeadsMarkReviewedArgs,
  AuditChatbotLeadsMarkReviewedReturn,
  AuditChatbotLeadsUpdateArgs,
  AuditChatbotLeadsUpdateReturn,
} from "./convex-generated/audit-chatbot-types";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  "https://glad-camel-940.convex.cloud";

// Discriminated union: each function name maps to its generated arg
// type. Call sites that use `functionName: "audit_chatbot_leads:create"`
// get `args: AuditChatbotLeadsCreateArgs`; a typo or extra field is a
// compile error.
export type ConvexFunctionName =
  | "audit_chatbot_leads:create"
  | "audit_chatbot_leads:update"
  | "audit_chatbot_leads:get"
  | "audit_chatbot_leads:list"
  | "audit_chatbot_leads:getStats"
  | "audit_chatbot_leads:markReviewed";

type ConvexArgsByName<T extends ConvexFunctionName> =
  T extends "audit_chatbot_leads:create" ? AuditChatbotLeadsCreateArgs :
  T extends "audit_chatbot_leads:update" ? AuditChatbotLeadsUpdateArgs :
  T extends "audit_chatbot_leads:get" ? AuditChatbotLeadsGetArgs :
  T extends "audit_chatbot_leads:list" ? AuditChatbotLeadsListArgs :
  T extends "audit_chatbot_leads:getStats" ? AuditChatbotLeadsGetStatsArgs :
  T extends "audit_chatbot_leads:markReviewed" ? AuditChatbotLeadsMarkReviewedArgs :
  never;

export type ConvexReturnByName<T extends ConvexFunctionName> =
  T extends "audit_chatbot_leads:create" ? AuditChatbotLeadsCreateReturn :
  T extends "audit_chatbot_leads:update" ? AuditChatbotLeadsUpdateReturn :
  T extends "audit_chatbot_leads:get" ? AuditChatbotLeadsGetReturn :
  T extends "audit_chatbot_leads:list" ? AuditChatbotLeadsListReturn :
  T extends "audit_chatbot_leads:getStats" ? AuditChatbotLeadsGetStatsReturn :
  T extends "audit_chatbot_leads:markReviewed" ? AuditChatbotLeadsMarkReviewedReturn :
  never;

export type ConvexCallOptions<T extends ConvexFunctionName> = {
  functionName: T;
  args: ConvexArgsByName<T>;
};

export async function callConvexMutation<T extends ConvexFunctionName>(
  opts: ConvexCallOptions<T>
): Promise<ConvexReturnByName<T>> {
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
  const data = (await res.json()) as {
    status: string;
    value?: unknown;
    errorMessage?: string;
  };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage}`);
  }
  return (data.value ?? null) as ConvexReturnByName<T>;
}

// Mirrors callConvexMutation against the `/api/query` endpoint. Used by the
// reload-recovery path in page.tsx to read back a chatbot_lead row by id
// after a mid-build page reload — the report we may already have on the
// server. Throws on non-2xx / Convex-side errors (the caller catches and
// falls through to the SSE re-fire branch).
export async function callConvexQuery<T extends ConvexFunctionName>(
  opts: ConvexCallOptions<T>
): Promise<ConvexReturnByName<T> | null> {
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
  const data = (await res.json()) as {
    status: string;
    value?: unknown;
    errorMessage?: string;
  };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage}`);
  }
  return (data.value ?? null) as ConvexReturnByName<T> | null;
}
