// Convex client for the worker. Same deployment as the Next.js app
// (glad-camel-940). The audit chat agent's `store_lead` tool calls
// audit_chatbot_leads:create directly from the worker — no Vercel
// hop needed.

const CONVEX_URL = "https://glad-camel-940.convex.cloud";

export interface ConvexCallOptions {
  functionName: string;
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
