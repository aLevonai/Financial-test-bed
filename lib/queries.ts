import type { Sql } from "./db";
import type { Area, Confidence, FeedItem } from "./types";

export const WINDOWS = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" } as const;
export type FeedWindow = keyof typeof WINDOWS;
export type FeedSort = "top" | "latest";
export type AreaFilter = Area | "all";

export interface FeedParams {
  window: FeedWindow;
  area: AreaFilter;
  minSignificance: number;
  sort: FeedSort;
  limit?: number;
}

/** When the item happened: its publish date, unless missing or later than when we first saw it. */
const EVENT_TIME = "coalesce(least(i.published_at, i.first_seen_at), i.first_seen_at)";

interface FeedRow {
  id: string;
  url: string;
  title: string;
  headline: string | null;
  why_it_matters: string | null;
  area: Area | null;
  topics: string[];
  significance: number | null;
  confidence: Confidence | null;
  hype_flags: string[];
  source_name: string;
  published_at: Date | null;
  first_seen_at: Date;
  sighting_count: number;
  vote: number | null;
}

export async function getFeed(sql: Sql, p: FeedParams): Promise<FeedItem[]> {
  const eventTime = sql.unsafe(EVENT_TIME);
  const order =
    p.sort === "top"
      ? sql`i.significance desc, sighting_count desc, ${eventTime} desc`
      : sql`${eventTime} desc, i.significance desc`;
  const rows = await sql<FeedRow[]>`
    select i.id, i.url, i.title, i.headline, i.why_it_matters, i.area, i.topics, i.significance,
           i.confidence, i.hype_flags, s.name as source_name, i.published_at, i.first_seen_at,
           (select count(*)::int from radar.sightings x where x.item_id = i.id) as sighting_count,
           f.vote
    from radar.items i
    join radar.sources s on s.id = i.source_id
    left join radar.feedback f on f.item_id = i.id
    where i.triage_status = 'done' and i.relevant
      and i.significance >= ${p.minSignificance}
      and ${eventTime} > now() - ${WINDOWS[p.window]}::interval
      and (${p.area} = 'all' or i.area = ${p.area})
    order by ${order}
    limit ${p.limit ?? 150}`;
  return rows.map((r) => ({
    id: Number(r.id),
    url: r.url,
    title: r.title,
    headline: r.headline,
    whyItMatters: r.why_it_matters,
    area: r.area,
    topics: r.topics,
    significance: r.significance,
    confidence: r.confidence,
    hypeFlags: r.hype_flags,
    sourceName: r.source_name,
    publishedAt: r.published_at,
    firstSeenAt: r.first_seen_at,
    sightingCount: r.sighting_count,
    vote: r.vote === 1 || r.vote === -1 ? r.vote : null,
  }));
}

export async function getAreaCounts(sql: Sql, window: FeedWindow, minSignificance: number): Promise<Record<string, number>> {
  const rows = await sql<{ area: string; n: number }[]>`
    select coalesce(i.area, 'other') as area, count(*)::int as n
    from radar.items i
    where i.triage_status = 'done' and i.relevant and i.significance >= ${minSignificance}
      and ${sql.unsafe(EVENT_TIME)} > now() - ${WINDOWS[window]}::interval
    group by 1`;
  const counts: Record<string, number> = { all: 0 };
  for (const r of rows) {
    counts[r.area] = r.n;
    counts.all += r.n;
  }
  return counts;
}

export interface RadarStatus {
  lastRunAt: Date | null;
  lastRunError: string | null;
  pending: number;
  seen24h: number;
  failingSources: number;
}

export async function getStatus(sql: Sql): Promise<RadarStatus> {
  const [row] = await sql<
    { last_run_at: Date | null; last_run_error: string | null; pending: number; seen_24h: number; failing: number }[]
  >`
    select
      (select finished_at from radar.runs where finished_at is not null order by started_at desc limit 1) as last_run_at,
      (select error from radar.runs where finished_at is not null order by started_at desc limit 1) as last_run_error,
      (select count(*)::int from radar.items where triage_status = 'pending') as pending,
      (select count(*)::int from radar.items where first_seen_at > now() - interval '24 hours') as seen_24h,
      (select count(*)::int from radar.sources where enabled and last_error is not null) as failing`;
  return {
    lastRunAt: row.last_run_at,
    lastRunError: row.last_run_error,
    pending: row.pending,
    seen24h: row.seen_24h,
    failingSources: row.failing,
  };
}

export interface SourceHealth {
  id: string;
  name: string;
  kind: string;
  url: string;
  area: string;
  tier: number;
  lastOkAt: Date | null;
  lastFetchedAt: Date | null;
  lastError: string | null;
  lastItemCount: number | null;
  items7d: number;
  relevant7d: number;
}

export async function getSources(sql: Sql): Promise<SourceHealth[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      kind: string;
      url: string;
      area: string;
      tier: number;
      last_ok_at: Date | null;
      last_fetched_at: Date | null;
      last_error: string | null;
      last_item_count: number | null;
      items_7d: number;
      relevant_7d: number;
    }[]
  >`
    select s.id, s.name, s.kind, s.url, s.area, s.tier, s.last_ok_at, s.last_fetched_at, s.last_error,
           s.last_item_count,
           count(x.item_id) filter (where x.first_seen_at > now() - interval '7 days')::int as items_7d,
           count(x.item_id) filter (where x.first_seen_at > now() - interval '7 days' and i.relevant and i.significance >= 3)::int as relevant_7d
    from radar.sources s
    left join radar.sightings x on x.source_id = s.id
    left join radar.items i on i.id = x.item_id
    where s.enabled
    group by s.id
    order by (s.last_error is not null) desc, s.area, s.tier, s.name`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    url: r.url,
    area: r.area,
    tier: r.tier,
    lastOkAt: r.last_ok_at,
    lastFetchedAt: r.last_fetched_at,
    lastError: r.last_error,
    lastItemCount: r.last_item_count,
    items7d: r.items_7d,
    relevant7d: r.relevant_7d,
  }));
}

export async function setVote(sql: Sql, itemId: number, vote: -1 | 0 | 1): Promise<void> {
  if (vote === 0) {
    await sql`delete from radar.feedback where item_id = ${itemId}`;
    return;
  }
  await sql`
    insert into radar.feedback (item_id, vote) values (${itemId}, ${vote})
    on conflict (item_id) do update set vote = excluded.vote, updated_at = now()`;
}
