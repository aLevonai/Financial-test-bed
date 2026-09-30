import { describe, expect, it, vi } from "vitest";
import { extractJsonObject, stripThinking } from "@/pipeline/llm/json";
import { chat, type MiniMaxConfig } from "@/pipeline/llm/minimax";
import { buildSystemPrompt, buildUserPrompt } from "@/pipeline/triage/prompt";
import { parseTriageResults } from "@/pipeline/triage/schema";

describe("stripThinking / extractJsonObject", () => {
  it("removes closed and unterminated think blocks", () => {
    expect(stripThinking("<think>hmm {x}</think>\nanswer")).toBe("answer");
    expect(stripThinking("reasoning… </think> answer")).toBe("answer");
    expect(stripThinking("answer <think>trailing")).toBe("answer");
  });

  it("finds the answer object outside the reasoning", () => {
    const raw = '<think>maybe {"results": []} no</think>\n```json\n{"results": [{"ref": 1}]}\n```';
    expect(extractJsonObject(raw, "results")).toEqual({ results: [{ ref: 1 }] });
  });

  it("handles braces inside strings", () => {
    const raw = 'Here: {"results": [{"ref": 1, "why": "uses {curly} braces \\" and quotes"}]}';
    expect(extractJsonObject(raw, "results")).toEqual({ results: [{ ref: 1, why: 'uses {curly} braces " and quotes' }] });
  });

  it("falls back to JSON inside the reasoning when the answer leaked into it", () => {
    const raw = '<think>let me answer {"results": [{"ref": 2}]}';
    expect(extractJsonObject(raw, "results")).toEqual({ results: [{ ref: 2 }] });
  });

  it("throws when no matching object exists", () => {
    expect(() => extractJsonObject("no json here", "results")).toThrow(/No JSON object/);
  });
});

describe("parseTriageResults", () => {
  it("coerces and clamps fields, dropping unknown hype flags", () => {
    const [r] = parseTriageResults({
      results: [
        {
          ref: "3",
          relevant: true,
          area: "AI",
          topics: ["LLM-Agents", "prompt-injection", "", "a", "b"],
          significance: 7,
          confidence: "very high",
          headline: "  Agents fall to indirect injection  ",
          why: "Because.",
          hype_flags: ["benchmark-only", "made-up-flag", "benchmark-only"],
        },
      ],
    });
    expect(r).toMatchObject({
      ref: 3,
      relevant: true,
      area: "other",
      topics: ["llm-agents", "prompt-injection", "a", "b"],
      significance: 5,
      confidence: "low",
      headline: "Agents fall to indirect injection",
      hype_flags: ["benchmark-only"],
    });
  });

  it("skips entries without a ref instead of failing the batch", () => {
    const out = parseTriageResults({ results: [{ relevant: true }, { ref: 1, relevant: false }] });
    expect(out.map((r) => r.ref)).toEqual([1]);
  });
});

describe("prompts", () => {
  it("embeds the profile and injection warning in the system prompt", () => {
    const system = buildSystemPrompt("I love lattices.");
    expect(system).toContain("I love lattices.");
    expect(system).toContain("untrusted text");
    expect(system).toContain("toy-scale");
  });

  it("lists every item with its ref", () => {
    const user = buildUserPrompt([
      { ref: 1, source: "IACR ePrint", sourceTier: 1, title: "T", summary: null, url: "u", publishedAt: null, sightings: 2, hfUpvotes: null },
    ]);
    expect(user).toContain("Return exactly 1 results");
    expect(user).toContain('"ref": 1');
    expect(user).not.toContain("hf_upvotes");
  });
});

describe("MiniMax chat", () => {
  const config: MiniMaxConfig = { apiKey: "k", baseUrl: "https://api.example/v1", model: "MiniMax-M3", timeoutMs: 5000, maxRetries: 2 };
  const ok = (content: string) =>
    new Response(JSON.stringify({ model: "MiniMax-M3", choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));

  it("sends an OpenAI-style request with reasoning_split", async () => {
    const fetchImpl = vi.fn(async () => ok("hi"));
    const res = await chat(config, [{ role: "user", content: "x" }], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ content: "hi", model: "MiniMax-M3", inputTokens: 10, outputTokens: 5 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "MiniMax-M3", reasoning_split: true });
  });

  it("retries rate limits and server errors", { timeout: 20_000 }, async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(ok("done"));
    const res = await chat(config, [{ role: "user", content: "x" }], { fetchImpl });
    expect(res.content).toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces MiniMax base_resp errors without retrying auth failures", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: "authorization failure" } })));
    await expect(chat(config, [{ role: "user", content: "x" }], { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      /1004: authorization failure/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry client errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(chat(config, [{ role: "user", content: "x" }], { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
