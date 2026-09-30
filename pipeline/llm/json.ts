/** Removes <think>…</think> reasoning blocks some models inline into content. */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // An unterminated block at the start means everything after it is reasoning;
  // a stray closing tag means everything before it was.
  const close = out.lastIndexOf("</think>");
  if (close !== -1) out = out.slice(close + "</think>".length);
  const open = out.indexOf("<think>");
  if (open !== -1) out = out.slice(0, open);
  return out.trim();
}

/** Every balanced top-level {...} span in `text`, respecting JSON strings. */
function objectSpans(text: string): string[] {
  const spans: string[] = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        spans.push(text.slice(start, i + 1));
        start = i; // continue scanning after this object
        break;
      }
    }
  }
  return spans;
}

/**
 * Finds the JSON object in a model response: prefers the answer outside any
 * reasoning block, falls back to the last parseable object anywhere.
 */
export function extractJsonObject(raw: string, requiredKey?: string): unknown {
  const candidates = [stripThinking(raw), raw];
  for (const text of candidates) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
    const spans = [...(fenced ? objectSpans(fenced) : []), ...objectSpans(text).reverse()];
    for (const span of spans) {
      try {
        const parsed = JSON.parse(span) as Record<string, unknown>;
        if (!requiredKey || (parsed && typeof parsed === "object" && requiredKey in parsed)) return parsed;
      } catch {
        // try the next candidate
      }
    }
  }
  throw new Error(`No JSON object${requiredKey ? ` with "${requiredKey}"` : ""} in model response`);
}
