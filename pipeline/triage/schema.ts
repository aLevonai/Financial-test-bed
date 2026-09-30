import { z } from "zod";
import { AREAS, CONFIDENCE, HYPE_FLAGS } from "@/lib/types";

const hypeSet = new Set<string>(HYPE_FLAGS);

export const TriageResultSchema = z.object({
  ref: z.coerce.number().int(),
  relevant: z.boolean().catch(false),
  area: z.enum(AREAS).catch("other"),
  topics: z
    .array(z.string())
    .catch([])
    .transform((t) => t.map((s) => s.toLowerCase().trim().slice(0, 32)).filter(Boolean).slice(0, 4)),
  significance: z.coerce.number().catch(1).transform((n) => Math.min(5, Math.max(1, Math.round(n)))),
  confidence: z.enum(CONFIDENCE).catch("low"),
  headline: z.string().catch("").transform((s) => s.trim().slice(0, 140)),
  why: z.string().catch("").transform((s) => s.trim().slice(0, 600)),
  hype_flags: z
    .array(z.string())
    .catch([])
    .transform((f) => [...new Set(f.map((s) => s.toLowerCase().trim()).filter((s) => hypeSet.has(s)))]),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

/** Validates each result independently so one malformed entry doesn't sink the batch. */
export function parseTriageResults(parsed: unknown): TriageResult[] {
  const list = (parsed as { results?: unknown })?.results;
  if (!Array.isArray(list)) throw new Error('Model response has no "results" array');
  const out: TriageResult[] = [];
  for (const entry of list) {
    const r = TriageResultSchema.safeParse(entry);
    if (r.success) out.push(r.data);
  }
  return out;
}
