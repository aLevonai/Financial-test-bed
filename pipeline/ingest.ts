import type { Sql } from "@/lib/db";
import { canonicalId } from "./canonical";
import { fetchText, mapConcurrent } from "./http";
import { parseArxivFeed, parseFeed } from "./parsers/feed";
import { parseHtmlLinks } from "./parsers/htmlLinks";
import { parseCisaKev, parseHfDaily } from "./parsers/json";
import type { ParsedEntry } from "./parsers/types";
import type { SourceDef } from "./sources";
import { recordSourceResult, syncSources, upsertItems, type NormalizedItem } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseSource(source: SourceDef, body: string): ParsedEntry[] {
  switch (source.kind) {
    case "feed":
      return parseFeed(body);
    case "arxiv":
      return parseArxivFeed(body);
    case "cisa-kev":
      return parseCisaKev(body);
    case "hf-daily":
      return parseHfDaily(body);
    case "html-links":
      if (!source.linkPattern) throw new Error(`${source.id}: html-links source needs linkPattern`);
      return parseHtmlLinks(body, source.url, source.linkPattern);
  }
}

/** Canonicalizes entries and drops ones older than the source's window. */
export function normalizeEntries(source: SourceDef, entries: ParsedEntry[], now = new Date()): NormalizedItem[] {
  const cutoff = now.getTime() - (source.maxAgeDays ?? 7) * DAY_MS;
  return entries
    .filter((e) => !e.publishedAt || e.publishedAt.getTime() >= cutoff)
    .map((e) => ({
      canonicalId: canonicalId(e.url, e.guid),
      url: e.url,
      title: e.title.slice(0, 500),
      summary: e.summary,
      authors: e.authors,
      publishedAt: e.publishedAt,
      extra: e.extra,
    }));
}

export interface IngestStats {
  sources: number;
  failed: string[];
  fetched: number;
  inserted: number;
  newSightings: number;
  requeued: number;
}

export async function ingest(sql: Sql, sources: SourceDef[], log = console.log): Promise<IngestStats> {
  const enabled = sources.filter((s) => s.enabled !== false);
  const lastOk = await syncSources(sql, sources);
  const stats: IngestStats = { sources: enabled.length, failed: [], fetched: 0, inserted: 0, newSightings: 0, requeued: 0 };

  await mapConcurrent(enabled, 6, async (source) => {
    try {
      const body = await fetchText(source.url);
      const items = normalizeEntries(source, parseSource(source, body));
      // A source's first successful fetch seeds its undated back catalogue as already-seen.
      const firstFetch = !lastOk.get(source.id);
      const res = await upsertItems(sql, source.id, items, (i) => firstFetch && !i.publishedAt);
      await recordSourceResult(sql, source.id, { ok: true, count: items.length });
      stats.fetched += items.length;
      stats.inserted += res.inserted;
      stats.newSightings += res.newSightings;
      stats.requeued += res.requeued;
      log(`  ✓ ${source.id}: ${items.length} entries, ${res.inserted} new`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.failed.push(source.id);
      await recordSourceResult(sql, source.id, { ok: false, error: message }).catch(() => {});
      log(`  ✗ ${source.id}: ${message}`);
    }
  });
  return stats;
}
