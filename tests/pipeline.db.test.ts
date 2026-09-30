import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "@/lib/db";
import { getAreaCounts, getFeed, getSources, getStatus, setVote } from "@/lib/queries";
import { ingest } from "@/pipeline/ingest";
import type { ChatMessage } from "@/pipeline/llm/minimax";
import { SOURCES, type SourceDef } from "@/pipeline/sources";
import { prune } from "@/pipeline/store";
import { triage } from "@/pipeline/triage/triage";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const source = (id: string) => SOURCES.find((s) => s.id === id)!;
const quiet = () => {};

// Fixture dates are rewritten to "now" so the time windows hold whenever the suite runs.
const nowRfc = new Date().toUTCString();
const today = new Date().toISOString().slice(0, 10);
const PAPER_TITLES: Record<string, string> = {
  "2609.01234": "Hybrid Key Exchange in TLS 1.3: A Formal Analysis of X25519MLKEM768",
  "2609.05678": "Prompt Injection Attacks on Tool-Using Agents",
};
const hfPapers = (ids: string[]) =>
  JSON.stringify(
    ids.map((id) => ({
      paper: { id, title: PAPER_TITLES[id], summary: "s", upvotes: 90, authors: [] },
      publishedAt: new Date().toISOString(),
    })),
  );

const bodies = new Map<string, string>([
  [source("arxiv-cr").url, fixture("arxiv.xml").replaceAll("Tue, 29 Sep 2026 00:00:00 -0400", nowRfc)],
  [source("cisa-kev").url, fixture("kev.json").replace('"2026-09-28"', `"${today}"`)],
  [source("hf-daily").url, hfPapers(["2609.05678"])],
  [source("anthropic").url, '<a href="/news/alpha">Alpha launch</a><a href="/news/beta">Beta paper</a>'],
]);
const broken: SourceDef = { id: "broken", name: "Broken", kind: "feed", url: "https://broken.example/feed", area: "ai", tier: 3 };
const testSources = [source("arxiv-cr"), source("cisa-kev"), source("hf-daily"), source("anthropic"), broken];

/** Stands in for MiniMax: scores by title keywords, wraps output in a think block, omits the KEV item. */
async function fakeChat(messages: ChatMessage[]) {
  const user = messages[1].content;
  const items = JSON.parse(user.slice(user.indexOf("["))) as { ref: number; title: string }[];
  const results = items
    .filter((i) => !i.title.includes("Gateway"))
    .map((i) => ({
      ref: i.ref,
      relevant: true,
      area: i.title.includes("Prompt") ? "ai" : "crypto",
      topics: ["test"],
      significance: i.title.includes("Hybrid") ? 4 : i.title.includes("Gamma") ? 3 : 2,
      confidence: "medium",
      headline: `H: ${i.title}`,
      why: "Because it matters.",
      hype_flags: [],
    }));
  return { content: `<think>scoring…</think>${JSON.stringify({ results })}`, model: "fake-model", inputTokens: 1, outputTokens: 1 };
}

let pg: EmbeddedPostgres;
let sql: Sql;
let pgParent: string;

beforeAll(async () => {
  pgParent = mkdtempSync(join(tmpdir(), "radar-pg-"));
  chmodSync(pgParent, 0o755); // postgres refuses root, so it runs as its own user
  const port = 55000 + Math.floor(Math.random() * 5000);
  pg = new EmbeddedPostgres({
    databaseDir: join(pgParent, "data"),
    user: "postgres",
    password: "test",
    port,
    persistent: false,
    createPostgresUser: process.getuid?.() === 0, // only needed (and only possible) as root
    onLog: quiet,
    onError: quiet,
  });
  await pg.initialise();
  await pg.start();
  sql = postgres(`postgres://postgres:test@localhost:${port}/postgres`, { prepare: false, onnotice: quiet });
  await sql.unsafe(readFileSync(new URL("../db/migrations/0001_init.sql", import.meta.url), "utf8"));
  vi.stubGlobal("fetch", async (url: string) => {
    const body = bodies.get(url);
    return body ? new Response(body) : new Response("not found", { status: 404, statusText: "Not Found" });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await sql?.end();
  await pg?.stop();
  rmSync(pgParent, { recursive: true, force: true });
});

describe("pipeline against Postgres", () => {
  it("ingests sources, dedupes across them, and records failures", async () => {
    const stats = await ingest(sql, testSources, quiet);
    // arXiv: 2 papers (one also in HF Daily), KEV: 1 recent CVE, Anthropic: 2 links.
    expect(stats.inserted).toBe(5);
    expect(stats.newSightings).toBe(6);
    expect(stats.failed).toEqual(["broken"]);

    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from radar.sightings where item_id = (select id from radar.items where canonical_id = 'arxiv:2609.05678')`;
    expect(n).toBe(2);

    const statuses = await sql<{ canonical_id: string; triage_status: string }[]>`
      select canonical_id, triage_status from radar.items where source_id = 'anthropic'`;
    expect(statuses.every((s) => s.triage_status === "skipped")).toBe(true);

    const [src] = await sql<{ last_error: string }[]>`select last_error from radar.sources where id = 'broken'`;
    expect(src.last_error).toBe("HTTP 404 Not Found: not found");
  });

  it("triages pending items and retries ones the model skipped", async () => {
    const stats = await triage(sql, "profile", fakeChat, { batchSize: 10 }, quiet);
    expect(stats.selected).toBe(3);
    expect(stats.triaged).toBe(2);

    const [hybrid] = await sql`select * from radar.items where canonical_id = 'arxiv:2609.01234'`;
    expect(hybrid).toMatchObject({ triage_status: "done", significance: 4, area: "crypto", relevant: true, triage_model: "fake-model" });
    expect(hybrid.headline).toContain("Hybrid Key Exchange");

    const [kev] = await sql`select * from radar.items where canonical_id = 'cve:CVE-2026-12345'`;
    expect(kev).toMatchObject({ triage_status: "pending", triage_attempts: 1, triage_error: "missing from model response" });
  });

  it("re-queues a triaged item when a new source corroborates it; new newsroom links are not baseline", async () => {
    bodies.set(source("hf-daily").url, hfPapers(["2609.05678", "2609.01234"]));
    bodies.set(source("anthropic").url, '<a href="/news/alpha">Alpha launch</a><a href="/news/gamma">Gamma model</a>');
    const stats = await ingest(sql, testSources, quiet);
    expect(stats.requeued).toBe(1);
    expect(stats.inserted).toBe(1);

    const rows = await sql<{ canonical_id: string; triage_status: string }[]>`
      select canonical_id, triage_status from radar.items
      where canonical_id in ('arxiv:2609.01234', 'url:anthropic.com/news/gamma')
      order by canonical_id`;
    expect(rows.map((r) => r.triage_status)).toEqual(["pending", "pending"]);

    await triage(sql, "profile", fakeChat, {}, quiet);
  });

  it("serves the feed ranked by significance with corroboration and votes", async () => {
    const top = await getFeed(sql, { window: "24h", area: "all", minSignificance: 3, sort: "top" });
    expect(top.map((i) => i.title)).toEqual(["Hybrid Key Exchange in TLS 1.3: A Formal Analysis of X25519MLKEM768", "Gamma model"]);
    expect(top[0]).toMatchObject({ significance: 4, sightingCount: 2, sourceName: "arXiv cs.CR", vote: null });

    const aiOnly = await getFeed(sql, { window: "7d", area: "ai", minSignificance: 1, sort: "latest" });
    expect(aiOnly.map((i) => i.title)).toEqual(["Prompt Injection Attacks on Tool-Using Agents"]);

    expect(await getAreaCounts(sql, "24h", 2)).toEqual({ all: 3, crypto: 2, ai: 1 });

    await setVote(sql, top[0].id, 1);
    expect((await getFeed(sql, { window: "24h", area: "all", minSignificance: 4, sort: "top" }))[0].vote).toBe(1);
    await setVote(sql, top[0].id, 0);
    expect((await getFeed(sql, { window: "24h", area: "all", minSignificance: 4, sort: "top" }))[0].vote).toBeNull();
  });

  it("reports status and source health", async () => {
    const status = await getStatus(sql);
    expect(status.pending).toBe(1); // the KEV item the fake model keeps skipping
    expect(status.failingSources).toBe(1);

    const sources = await getSources(sql);
    expect(sources[0].id).toBe("broken");
    expect(sources.find((s) => s.id === "arxiv-cr")).toMatchObject({ items7d: 2, relevant7d: 1 });
  });

  it("prunes stale low-value items but keeps important ones", async () => {
    await sql`update radar.items set first_seen_at = now() - interval '40 days'`;
    await sql`update radar.sightings set last_seen_at = now() - interval '20 days'`;
    const removed = await prune(sql);
    const left = await sql<{ canonical_id: string }[]>`select canonical_id from radar.items order by canonical_id`;
    expect(left.map((r) => r.canonical_id)).toEqual(["arxiv:2609.01234", "url:anthropic.com/news/gamma"]);
    expect(removed).toBe(4);
  });
});
