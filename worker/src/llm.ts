// LLM client for the audit agent worker. Model is pinned to MiniMax-M2.7.
// Reads MINIMAX_API_KEY from the worker's env (set via `wrangler secret put`).
//
// This is a port of src/lib/llm.ts with the Hermes/API_SERVER_KEY branch
// dropped — the worker only has access to the direct MiniMax endpoint.

const DIRECT_KEY = (env: { MINIMAX_API_KEY?: string }) => env.MINIMAX_API_KEY;
const DIRECT_BASE = "https://api.minimax.io/anthropic";

// LOCKED MODEL — MiniMax-M2.7 only. Dusk specified M2.7 for this build.
export const LLM_MODEL = "MiniMax-M2.7";

export interface EnvLike {
  MINIMAX_API_KEY?: string;
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

function endpoint(env: EnvLike): { baseUrl: string; apiKey: string } {
  const apiKey = DIRECT_KEY(env);
  if (!apiKey) {
    throw new Error("No LLM credentials: set MINIMAX_API_KEY via `wrangler secret put`");
  }
  return { baseUrl: DIRECT_BASE, apiKey };
}

export async function chatCompletion(req: ChatRequest, env: EnvLike): Promise<ChatResponse> {
  const ep = endpoint(env);
  const res = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": ep.apiKey,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 2048,
      stream: false,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("LLM chat failed (" + res.status + "): " + errText);
  }
  return (await res.json()) as ChatResponse;
}

export async function* chatCompletionStream(req: ChatRequest, env: EnvLike): AsyncGenerator<string, string, void> {
  const ep = endpoint(env);
  const res = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": ep.apiKey,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 2048,
      stream: true,
    }),
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
