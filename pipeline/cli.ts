import { readFile } from "node:fs/promises";
import { closeSql, getSql } from "@/lib/db";
import { fetchText } from "./http";
import { ingest, normalizeEntries, parseSource } from "./ingest";
import { miniMaxConfigFromEnv } from "./llm/minimax";
import { SOURCES } from "./sources";
import { finishRun, prune, startRun } from "./store";
import { miniMaxChat, triage } from "./triage/triage";

const USAGE = `Usage: npm run pipeline -- <command> [--source <id>]

Commands:
  ingest    Fetch all sources and store new items
  triage    Score pending items with MiniMax
  prune     Delete old low-value items
  all       ingest + triage + prune (what the scheduled job runs)
  check     Fetch and parse sources without touching the database`;

function sourcesFor(args: string[]) {
  const i = args.indexOf("--source");
  if (i === -1) return SOURCES;
  const id = args[i + 1];
  const found = SOURCES.filter((s) => s.id === id);
  if (found.length === 0) throw new Error(`Unknown source "${id}"`);
  return found;
}

async function check(args: string[]): Promise<void> {
  let failures = 0;
  for (const source of sourcesFor(args)) {
    try {
      const entries = parseSource(source, await fetchText(source.url));
      const recent = normalizeEntries(source, entries);
      console.log(`✓ ${source.id}: ${entries.length} parsed, ${recent.length} recent`);
      for (const e of recent.slice(0, 2)) console.log(`    - ${e.title.slice(0, 100)}`);
    } catch (err) {
      failures++;
      console.log(`✗ ${source.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failures) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") return check(args);
  if (!["ingest", "triage", "prune", "all"].includes(command)) {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
    return;
  }

  const sql = getSql();
  const runId = await startRun(sql, command);
  const stats: Record<string, unknown> = {};
  try {
    if (command === "ingest" || command === "all") {
      console.log("Ingesting…");
      stats.ingest = await ingest(sql, sourcesFor(args));
    }
    if (command === "triage" || command === "all") {
      console.log("Triaging…");
      const profile = await readFile(new URL("../profile.md", import.meta.url), "utf8");
      stats.triage = await triage(sql, profile, miniMaxChat(miniMaxConfigFromEnv()), {
        limit: Number(process.env.TRIAGE_LIMIT || 400),
        concurrency: Number(process.env.TRIAGE_CONCURRENCY || 4),
      });
    }
    if (command === "prune" || command === "all") {
      stats.pruned = await prune(sql);
    }
    await finishRun(sql, runId, stats);
    console.log(JSON.stringify(stats, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(sql, runId, stats, message).catch(() => {});
    throw err;
  } finally {
    await closeSql();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
