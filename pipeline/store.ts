import type { Sql } from "@/lib/db";
import type { SourceDef } from "./sources";

export interface NormalizedItem {
  canonicalId: string;
  url: string;
  title: string;
  summary: string | null;
  authors: string[];
  publishedAt: Date | null;
  extra: Record<string, unknown>;
}

export interface UpsertResult {
  inserted: number;
  newSightings: number;
  requeued: number;
}

const CHUNK = 400;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Mirrors the source registry into the DB; sources dropped from the registry get disabled. */
export async function syncSources(sql: Sql, defs: SourceDef[]): Promise<Map<string, Date | null>> {
  for (const d of defs) {
    await sql`
      insert into radar.sources (id, name, kind, url, area, tier, enabled)
      values (${d.id}, ${d.name}, ${d.kind}, ${d.url}, ${d.area}, ${d.tier}, ${d.enabled ?? true})
      on conflict (id) do update set
        name = excluded.name, kind = excluded.kind, url = excluded.url, area = excluded.area,
        tier = excluded.tier, enabled = excluded.enabled, updated_at = now()`;
  }
  const ids = defs.map((d) => d.id);
  await sql`update radar.sources set enabled = false, updated_at = now() where id <> all(${ids}) and enabled`;
  const rows = await sql<{ id: string; last_ok_at: Date | null }[]>`select id, last_ok_at from radar.sources`;
  return new Map(rows.map((r) => [r.id, r.last_ok_at]));
}

/**
 * Inserts new items, records a sighting for every item, and re-queues an
 * already-triaged item for triage when a *different* source newly reports it
 * (corroboration can change its significance).
 *
 * `baseline` items (a source's first fetch, undated entries) are stored as
 * skipped so a newsroom's back catalogue doesn't flood the feed.
 */
export async function upsertItems(
  sql: Sql,
  sourceId: string,
  items: NormalizedItem[],
  baseline: (item: NormalizedItem) => boolean,
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, newSightings: 0, requeued: 0 };
  const unique = [...new Map(items.map((i) => [i.canonicalId, i])).values()];
  for (const batch of chunks(unique, CHUNK)) {
    const rows = batch.map((i) => ({
      canonical_id: i.canonicalId,
      source_id: sourceId,
      url: i.url,
      title: i.title,
      summary: i.summary,
      authors: i.authors,
      published_at: i.publishedAt,
      extra: sql.json(i.extra as never),
      triage_status: baseline(i) ? "skipped" : "pending",
    }));
    const inserted = await sql<{ id: string }[]>`
      insert into radar.items ${sql(rows)}
      on conflict (canonical_id) do nothing
      returning id`;
    result.inserted += inserted.length;
    const insertedIds = new Set(inserted.map((r) => String(r.id)));

    const ids = await sql<{ id: string; canonical_id: string }[]>`
      select id, canonical_id from radar.items where canonical_id = any(${batch.map((i) => i.canonicalId)})`;
    const idByCanonical = new Map(ids.map((r) => [r.canonical_id, r.id]));
    const sightings = batch
      .filter((i) => idByCanonical.has(i.canonicalId))
      .map((i) => ({
        item_id: idByCanonical.get(i.canonicalId)!,
        source_id: sourceId,
        url: i.url,
        extra: sql.json(i.extra as never),
      }));
    if (sightings.length === 0) continue;
    const seen = await sql<{ item_id: string; inserted: boolean }[]>`
      insert into radar.sightings ${sql(sightings)}
      on conflict (item_id, source_id) do update set last_seen_at = now(), extra = excluded.extra
      returning item_id, (xmax = 0) as inserted`;
    const fresh = seen.filter((s) => s.inserted);
    result.newSightings += fresh.length;
    const corroborated = fresh.map((s) => String(s.item_id)).filter((id) => !insertedIds.has(id));
    if (corroborated.length) {
      const requeued = await sql`
        update radar.items set triage_status = 'pending', triage_attempts = 0
        where id = any(${corroborated}::bigint[]) and triage_status = 'done'
        returning id`;
      result.requeued += requeued.length;
    }
  }
  return result;
}

export async function recordSourceResult(
  sql: Sql,
  sourceId: string,
  outcome: { ok: true; count: number } | { ok: false; error: string },
): Promise<void> {
  if (outcome.ok) {
    await sql`
      update radar.sources
      set last_fetched_at = now(), last_ok_at = now(), last_error = null, last_item_count = ${outcome.count}
      where id = ${sourceId}`;
  } else {
    await sql`
      update radar.sources set last_fetched_at = now(), last_error = ${outcome.error.slice(0, 500)}
      where id = ${sourceId}`;
  }
}

export async function startRun(sql: Sql, command: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`insert into radar.runs (command) values (${command}) returning id`;
  return row.id;
}

export async function finishRun(sql: Sql, runId: string, stats: Record<string, unknown>, error?: string): Promise<void> {
  await sql`
    update radar.runs set finished_at = now(), stats = ${sql.json(stats as never)}, error = ${error ?? null}
    where id = ${runId}`;
}

/**
 * Drops items below significance 3 after 30 days (keeping anything you voted
 * on) — but only once no source has listed them for 14 days, so undated
 * newsroom links aren't re-ingested as "new".
 */
export async function prune(sql: Sql): Promise<number> {
  const rows = await sql`
    delete from radar.items i
    where i.first_seen_at < now() - interval '30 days'
      and (i.triage_status <> 'done' or i.relevant is not true or i.significance <= 2)
      and not exists (select 1 from radar.feedback f where f.item_id = i.id)
      and not exists (
        select 1 from radar.sightings s
        where s.item_id = i.id and s.last_seen_at > now() - interval '14 days')
    returning i.id`;
  await sql`delete from radar.runs where started_at < now() - interval '30 days'`;
  return rows.length;
}
