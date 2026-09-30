import Link from "next/link";
import { getSql } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { getAreaCounts, getFeed, getStatus, WINDOWS, type AreaFilter, type FeedSort, type FeedWindow } from "@/lib/queries";
import { AutoRefresh } from "./components/AutoRefresh";
import { ItemCard } from "./components/ItemCard";
import { TopBar } from "./components/TopBar";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

const WINDOW_LABELS: Record<FeedWindow, string> = { "24h": "Today", "7d": "Week", "30d": "Month" };
const AREA_LABELS: Record<AreaFilter, string> = { all: "All", crypto: "Crypto", security: "Security", ai: "AI", other: "Other" };
const MIN_OPTIONS = [2, 3, 4, 5];

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

interface State {
  w: FeedWindow;
  area: AreaFilter;
  min: number;
  sort: FeedSort;
}

function href(state: State, change: Partial<State>): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.w !== "24h") params.set("w", next.w);
  if (next.area !== "all") params.set("area", next.area);
  if (next.min !== 3) params.set("min", String(next.min));
  if (next.sort !== "top") params.set("sort", next.sort);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function FeedPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const state: State = {
    w: pick(sp.w, Object.keys(WINDOWS) as FeedWindow[], "24h"),
    area: pick(sp.area, ["all", "crypto", "security", "ai"] as const, "all"),
    min: Number(pick(sp.min, ["2", "3", "4", "5"] as const, "3")),
    sort: pick(sp.sort, ["top", "latest"] as const, "top"),
  };
  const now = new Date();

  let content: React.ReactNode;
  let statusLine: React.ReactNode = null;
  try {
    const sql = getSql();
    const [items, counts, status] = await Promise.all([
      getFeed(sql, { window: state.w, area: state.area, minSignificance: state.min, sort: state.sort }),
      getAreaCounts(sql, state.w, state.min),
      getStatus(sql),
    ]);

    statusLine = (
      <div className="status">
        <span>{status.lastRunAt ? `Updated ${timeAgo(status.lastRunAt, now)}` : "Waiting for the first run"}</span>
        <span>{status.seen24h} new items in 24h</span>
        {status.pending > 0 && <span>{status.pending} awaiting triage</span>}
        {status.lastRunError && <span className="warn">⚠ last run failed</span>}
        {status.failingSources > 0 && (
          <Link href="/sources" className="warn">
            ⚠ {status.failingSources} source{status.failingSources === 1 ? "" : "s"} failing
          </Link>
        )}
      </div>
    );

    const controls = (
      <div className="controls">
        <div className="control-row">
          <span className="control-label">When</span>
          {(Object.keys(WINDOW_LABELS) as FeedWindow[]).map((w) => (
            <Link key={w} className="chip" href={href(state, { w })} aria-current={state.w === w}>
              {WINDOW_LABELS[w]}
            </Link>
          ))}
        </div>
        <div className="control-row">
          <span className="control-label">Sort</span>
          {(["top", "latest"] as const).map((sort) => (
            <Link key={sort} className="chip" href={href(state, { sort })} aria-current={state.sort === sort}>
              {sort === "top" ? "Top" : "Latest"}
            </Link>
          ))}
        </div>
        <div className="control-row">
          <span className="control-label">Area</span>
          {(["all", "crypto", "security", "ai"] as const).map((area) => (
            <Link key={area} className="chip" href={href(state, { area })} aria-current={state.area === area}>
              {AREA_LABELS[area]} <span className="count">{counts[area] ?? 0}</span>
            </Link>
          ))}
        </div>
        <div className="control-row">
          <span className="control-label">Min</span>
          {MIN_OPTIONS.map((min) => (
            <Link key={min} className="chip" href={href(state, { min })} aria-current={state.min === min}>
              {min}+
            </Link>
          ))}
        </div>
      </div>
    );

    content = (
      <>
        {controls}
        {items.length === 0 ? (
          <div className="empty">
            <strong>{status.lastRunAt ? "Nothing at this level yet" : "No data yet"}</strong>
            {status.lastRunAt
              ? "Try a longer window or a lower minimum significance."
              : "The pipeline runs every 30 minutes; the first items appear after its first run."}
          </div>
        ) : (
          <div className="feed">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} now={now} />
            ))}
          </div>
        )}
      </>
    );
  } catch (err) {
    content = (
      <div className="empty">
        <strong>Can’t reach the database</strong>
        {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }

  return (
    <>
      <TopBar current="feed" />
      <main className="shell">
        {statusLine}
        {content}
      </main>
      <AutoRefresh />
    </>
  );
}
