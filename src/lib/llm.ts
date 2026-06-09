// EMVY LLM client. Model is pinned to MiniMax-M2.7 — do not change without Dusk's
// approval. Reads config from env so the same code works against:
//   - Hermes API server (default): http://localhost:8642/v1  (API_SERVER_KEY)
//   - MiniMax direct: https://api.minimax.io/anthropic        (MINIMAX_API_KEY)
//
// Both expose OpenAI-compatible chat completions.

const HERMES_BASE = process.env.HERMES_API_BASE || "http://localhost:8642/v1";
const HERMES_KEY = process.env.API_SERVER_KEY;
const DIRECT_KEY = process.env.MINIMAX_API_KEY;
const DIRECT_BASE = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/anthropic";

// LOCKED MODEL — MiniMax-M2.7 only. Dusk specified M2.7 for this build.
export const LLM_MODEL = "MiniMax-M2.7";

export interface ResolvedEndpoint {
  baseUrl: string;
  apiKey: string;
  source: "hermes" | "direct";
  authHeader?: "Authorization" | "X-Api-Key";
}

export function resolveEndpoint(): ResolvedEndpoint {
  if (HERMES_KEY) {
    return { baseUrl: HERMES_BASE, apiKey: HERMES_KEY, source: "hermes", authHeader: "Authorization" };
  }
  if (DIRECT_KEY) {
    return { baseUrl: DIRECT_BASE, apiKey: DIRECT_KEY, source: "direct", authHeader: "X-Api-Key" };
  }
  throw new Error(
    "No LLM credentials found. Set API_SERVER_KEY (for Hermes API server) or MINIMAX_API_KEY in .env.local"
  );
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
      index?: number;
    }>;
    reasoning_details?: Array<{ type: string; text: string }>;
  };
  finish_reason: string;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface StreamChunk {
  id: string;
  model: string;
  choices: { index: number; delta: { role?: string; content?: string }; finish_reason: string | null }[];
}

// Non-streaming call.
export async function chatCompletion(req: ChatRequest): Promise<ChatResponse> {
  const ep = resolveEndpoint();
  const body = {
    model: LLM_MODEL,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 2048,
    stream: false,
  };
  const authHeader = ep.authHeader === "X-Api-Key" ? "X-Api-Key" : "Authorization";
  const authValue = ep.authHeader === "X-Api-Key" ? ep.apiKey : "Bearer " + ep.apiKey;
  const res = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [authHeader]: authValue,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("LLM chat failed (" + res.status + "): " + errText);
  }
  return (await res.json()) as ChatResponse;
}

// Streaming call. Yields content deltas, returns concatenated content.
export async function* chatCompletionStream(req: ChatRequest): AsyncGenerator<string, string, void> {
  const ep = resolveEndpoint();
  const body = {
    model: LLM_MODEL,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 2048,
    stream: true,
  };
  const authHeader = ep.authHeader === "X-Api-Key" ? "X-Api-Key" : "Authorization";
  const authValue = ep.authHeader === "X-Api-Key" ? ep.apiKey : "Bearer " + ep.apiKey;
  const res = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [authHeader]: authValue,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("LLM stream failed (" + res.status + "): " + errText);
  }
  if (!res.body) throw new Error("LLM stream returned empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineEnd;
    while ((lineEnd = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        return full;
      }
      try {
        const chunk = JSON.parse(payload) as StreamChunk;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          yield delta;
        }
      } catch {
        // Ignore malformed chunks; SSE can split across lines.
      }
    }
  }
  return full;
}