import { SIGNIFICANCE_LABELS, timeAgo } from "@/lib/format";
import type { FeedItem } from "@/lib/types";
import { VoteButtons } from "./VoteButtons";

export function ItemCard({ item, now }: { item: FeedItem; now: Date }) {
  const sig = item.significance ?? 1;
  const headline = item.headline || item.title;
  const eventTime = item.publishedAt && item.publishedAt < item.firstSeenAt ? item.publishedAt : item.firstSeenAt;
  const showOriginal = item.headline && item.headline.trim().toLowerCase() !== item.title.trim().toLowerCase();

  return (
    <article className="card" data-sig={sig}>
      <div className="card-meta">
        <span className="sig">
          {sig} · {SIGNIFICANCE_LABELS[sig]}
          {item.confidence === "low" ? " (low confidence)" : ""}
        </span>
        {item.area && item.area !== "other" && (
          <span className="area" data-area={item.area}>
            {item.area}
          </span>
        )}
        {item.topics.length > 0 && <span className="topics">{item.topics.join(" · ")}</span>}
        <time className="when" dateTime={eventTime.toISOString()} title={eventTime.toISOString()}>
          {timeAgo(eventTime, now)}
        </time>
      </div>
      <h2>
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          {headline}
        </a>
      </h2>
      {item.whyItMatters && <p className="why">{item.whyItMatters}</p>}
      {showOriginal && <p className="original">{item.title}</p>}
      {item.hypeFlags.length > 0 && (
        <div className="flags" aria-label="Hype flags">
          {item.hypeFlags.map((f) => (
            <span key={f} className="flag">
              ⚠ {f.replaceAll("-", " ")}
            </span>
          ))}
        </div>
      )}
      <div className="card-foot">
        <span className="src">
          {item.sourceName}
          {item.sightingCount > 1 && <span className="corroborated"> · in {item.sightingCount} sources</span>}
        </span>
        <VoteButtons itemId={item.id} initial={item.vote} />
      </div>
    </article>
  );
}
