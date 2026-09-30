export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface MiniMaxConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export function miniMaxConfigFromEnv(env = process.env): MiniMaxConfig {
  const apiKey = env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY is not set");
  return {
    apiKey,
    baseUrl: (env.MINIMAX_BASE_URL || "https://api.minimax.io/v1").replace(/\/+$/, ""),
    model: env.MINIMAX_MODEL || "MiniMax-M3",
    timeoutMs: Number(env.MINIMAX_TIMEOUT_MS || 180_000),
    maxRetries: 3,
  };
}

class RetryableError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One chat completion against MiniMax's OpenAI-compatible endpoint.
 * `reasoning_split` moves the model's thinking out of `content`.
 */
export async function chat(
  config: MiniMaxConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; fetchImpl?: typeof fetch } = {},
): Promise<ChatResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) await sleep(Math.min(30_000, 2_000 * 2 ** (attempt - 1)) + Math.random() * 500);
    try {
      const res = await doFetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages,
          max_tokens: opts.maxTokens ?? 8192,
          reasoning_split: true,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const bodyText = await res.text();
      if (res.status === 429 || res.status >= 500) throw new RetryableError(`MiniMax HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      const body = JSON.parse(bodyText) as {
        model?: string;
        choices?: { message?: { content?: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        base_resp?: { status_code?: number; status_msg?: string };
      };
      // MiniMax can report errors with HTTP 200 and a non-zero base_resp.
      const code = body.base_resp?.status_code;
      if (code && code !== 0) {
        const msg = `MiniMax error ${code}: ${body.base_resp?.status_msg ?? "unknown"}`;
        // 1000 unknown, 1001 timeout, 1002 RPM limit, 1013 internal, 1039 TPM limit
        if ([1000, 1001, 1002, 1013, 1039].includes(code)) throw new RetryableError(msg);
        throw new Error(msg);
      }
      const content = body.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) throw new RetryableError(`MiniMax returned empty content (finish_reason=${body.choices?.[0]?.finish_reason})`);
      return {
        content,
        model: body.model ?? config.model,
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof RetryableError ||
        (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("fetch failed")));
      if (!retryable) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
