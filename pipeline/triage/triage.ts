import type { Sql } from "@/lib/db";
import { mapConcurrent } from "../http";
import { extractJsonObject } from "../llm/json";
import { chat, type ChatMessage, type ChatResult } from "../llm/minimax";
import { buildSystemPrompt, buildUserPrompt, type TriageInput } from "./prompt";
import { parseTriageResults, type TriageResult } from "./schema";

export type ChatFn = (messages: ChatMessage[]) => Promise<ChatResult>;

export interface TriageOptions {
  limit: number;
  batchSize: number;
  concurrency: number;
  maxAttempts: number;
}

export const DEFAULT_TRIAGE_OPTIONS: TriageOptions = { limit: 400, batchSize: 12, concurrency: 4, maxAttempts: 3 };

export interface TriageStats {
  selected: number;
  triaged: number;
  failedBatches: number;
  expired: number;
  inputTokens: number;
  outputTokens: number;
}

interface PendingRow {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: Date | null;
  source_name: string;
  tier: number;
  sightings: number;
  hf_upvotes: number | null;
}

async function selectPending(sql: Sql, limit: number, maxAttempts: number): Promise<PendingRow[]> {
  return sql<PendingRow[]>`
    select i.id, i.title, i.summary, i.url, i.published_at, s.name as source_name, s.tier,
           (select count(*)::int from radar.sightings x where x.item_id = i.id) as sightings,
           (select max((x.extra->>'hf_upvotes')::int) from radar.sightings x where x.item_id = i.id) as hf_upvotes
    from radar.items i
    join radar.sources s on s.id = i.source_id
    where i.triage_status = 'pending' and i.triage_attempts < ${maxAttempts}
    order by case when s.tier = 2 then 9 else s.tier end, i.first_seen_at desc
    limit ${limit}`;
}

async function saveResults(sql: Sql, rows: PendingRow[], results: TriageResult[], model: string): Promise<number> {
  const byRef = new Map(results.map((r) => [r.ref, r]));
  let saved = 0;
  await sql.begin(async (tx) => {
    for (const [idx, row] of rows.entries()) {
      const r = byRef.get(idx + 1);
      if (!r) continue;
      await tx`
        update radar.items set
          triage_status = 'done', triaged_at = now(), triage_model = ${model}, triage_error = null,
          relevant = ${r.relevant}, area = ${r.area}, topics = ${r.topics}, significance = ${r.significance},
          confidence = ${r.confidence}, headline = ${r.headline || null}, why_it_matters = ${r.why || null},
          hype_flags = ${r.hype_flags}
        where id = ${row.id}`;
      saved++;
    }
  });
  return saved;
}

async function markFailed(sql: Sql, ids: string[], error: string, maxAttempts: number): Promise<void> {
  await sql`
    update radar.items set
      triage_attempts = triage_attempts + 1,
      triage_error = ${error.slice(0, 500)},
      triage_status = case when triage_attempts + 1 >= ${maxAttempts} then 'error' else 'pending' end
    where id = any(${ids}::bigint[]) and triage_status = 'pending'`;
}

export async function triage(
  sql: Sql,
  profile: string,
  chatFn: ChatFn,
  options: Partial<TriageOptions> = {},
  log = console.log,
): Promise<TriageStats> {
  const opts = { ...DEFAULT_TRIAGE_OPTIONS, ...options };
  const expired = await sql`
    update radar.items set triage_status = 'skipped'
    where triage_status = 'pending' and first_seen_at < now() - interval '7 days'
    returning id`;
  const pending = await selectPending(sql, opts.limit, opts.maxAttempts);
  const stats: TriageStats = { selected: pending.length, triaged: 0, failedBatches: 0, expired: expired.length, inputTokens: 0, outputTokens: 0 };
  if (pending.length === 0) return stats;

  const system = buildSystemPrompt(profile);
  const batches: PendingRow[][] = [];
  for (let i = 0; i < pending.length; i += opts.batchSize) batches.push(pending.slice(i, i + opts.batchSize));

  await mapConcurrent(batches, opts.concurrency, async (rows) => {
    const inputs: TriageInput[] = rows.map((r, idx) => ({
      ref: idx + 1,
      source: r.source_name,
      sourceTier: r.tier,
      title: r.title,
      summary: r.summary,
      url: r.url,
      publishedAt: r.published_at,
      sightings: r.sightings,
      hfUpvotes: r.hf_upvotes,
    }));
    try {
      const res = await chatFn([
        { role: "system", content: system },
        { role: "user", content: buildUserPrompt(inputs) },
      ]);
      stats.inputTokens += res.inputTokens;
      stats.outputTokens += res.outputTokens;
      const results = parseTriageResults(extractJsonObject(res.content, "results"));
      const saved = await saveResults(sql, rows, results, res.model);
      stats.triaged += saved;
      const missing = rows.filter((_, idx) => !results.some((r) => r.ref === idx + 1)).map((r) => r.id);
      if (missing.length) await markFailed(sql, missing, "missing from model response", opts.maxAttempts);
      log(`  ✓ batch of ${rows.length}: ${saved} triaged`);
    } catch (err) {
      stats.failedBatches++;
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(sql, rows.map((r) => r.id), message, opts.maxAttempts);
      log(`  ✗ batch of ${rows.length}: ${message}`);
    }
  });
  return stats;
}

export function miniMaxChat(config: Parameters<typeof chat>[0]): ChatFn {
  return (messages) => chat(config, messages);
}
