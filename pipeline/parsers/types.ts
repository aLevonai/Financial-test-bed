/** One entry as read from a source, before canonicalization. */
export interface ParsedEntry {
  title: string;
  url: string;
  guid?: string;
  publishedAt: Date | null;
  summary: string | null;
  authors: string[];
  extra: Record<string, unknown>;
}
