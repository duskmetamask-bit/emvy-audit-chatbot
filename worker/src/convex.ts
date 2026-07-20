// Convex client for the worker. Same deployment as the Next.js app
// (glad-camel-940). The audit chat agent's `store_lead` tool calls
// audit_chatbot_leads:create directly from the worker — no Vercel
// hop needed.
//
// Mirrors src/lib/convex.ts but ships in the worker's own bundle.
// The two files share the same generated types (../convex-generated/...),
// kept in sync via `npm run sync:convex-types` in the parent repo.
//
// Currently uncalled — the worker scaffold is here so future
// Hermes/Cloudflare agent calls can fire from the edge without
// hopping through Vercel. When the first call site lands, the
// same discriminated-union typing as src/lib/convex.ts applies.

const CONVEX_URL = "https://glad-camel-940.convex.cloud";

export async function callConvexMutation(
  functionName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: functionName,
      args,
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
  return data.value;
}
