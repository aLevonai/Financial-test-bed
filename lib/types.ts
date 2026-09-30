export const AREAS = ["crypto", "security", "ai", "other"] as const;
export type Area = (typeof AREAS)[number];

export type SourceArea = "crypto" | "security" | "ai" | "mixed";

export const CONFIDENCE = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const HYPE_FLAGS = [
  "toy-scale",
  "extrapolated-claim",
  "benchmark-only",
  "no-paper-or-code",
  "vendor-claim",
  "unreproduced",
  "single-source",
  "rehash",
  "clickbait-headline",
] as const;
export type HypeFlag = (typeof HYPE_FLAGS)[number];

export interface FeedItem {
  id: number;
  url: string;
  title: string;
  headline: string | null;
  whyItMatters: string | null;
  area: Area | null;
  topics: string[];
  significance: number | null;
  confidence: Confidence | null;
  hypeFlags: string[];
  sourceName: string;
  publishedAt: Date | null;
  firstSeenAt: Date;
  sightingCount: number;
  vote: -1 | 1 | null;
}
