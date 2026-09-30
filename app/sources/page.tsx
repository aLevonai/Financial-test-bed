import { getSql } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { getSources, type SourceHealth } from "@/lib/queries";
import { TopBar } from "../components/TopBar";

export const dynamic = "force-dynamic";

const TIER_LABELS: Record<number, string> = { 1: "primary", 2: "firehose", 3: "curator" };

function Source({ s, now }: { s: SourceHealth; now: Date }) {
  const state = s.lastError ? "bad" : s.lastOkAt ? "ok" : "never";
  return (
    <div className="source">
      <div className="source-name">
        <span className={`dot ${state}`} aria-label={state} />
        <a href={s.url} target="_blank" rel="noopener noreferrer">
          {s.name}
        </a>
      </div>
      <div className="source-stats">
        {s.relevant7d} notable / {s.items7d} item{s.items7d === 1 ? "" : "s"} · 7d
      </div>
      <div className="source-detail">
        {s.area} · {TIER_LABELS[s.tier] ?? `tier ${s.tier}`} · {s.kind}
      </div>
      <div className="source-detail" style={{ textAlign: "right" }}>
        {s.lastOkAt ? `ok ${timeAgo(s.lastOkAt, now)}` : "never fetched"}
      </div>
      {s.lastError && <div className="source-error">{s.lastError}</div>}
    </div>
  );
}

export default async function SourcesPage() {
  const now = new Date();
  let body: React.ReactNode;
  try {
    const sources = await getSources(getSql());
    const failing = sources.filter((s) => s.lastError).length;
    body = (
      <>
        <p className="page-sub">
          {sources.length} sources · {failing ? `${failing} failing` : "all healthy"} · “notable” = significance 3+
        </p>
        <div className="source-list">
          {sources.map((s) => (
            <Source key={s.id} s={s} now={now} />
          ))}
        </div>
      </>
    );
  } catch (err) {
    body = (
      <div className="empty">
        <strong>Can’t reach the database</strong>
        {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }
  return (
    <>
      <TopBar current="sources" />
      <main className="shell">
        <h1 className="page-title">Sources</h1>
        {body}
      </main>
    </>
  );
}
