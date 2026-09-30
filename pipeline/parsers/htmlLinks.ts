import { decodeEntities, parseDate } from "./text";
import type { ParsedEntry } from "./types";

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i;
const LABEL = /\b(?:aria-label|title)\s*=\s*"([^"]*)"/i;
const DATE_LIKE =
  /^(?:[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4}|\d{4}-\d{2}-\d{2})$/;

function segments(innerHtml: string): string[] {
  return innerHtml
    .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi, "\n")
    .split(/<[^>]+>/)
    .map((s) => decodeEntities(s).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function titleFromSlug(pathname: string): string {
  const slug = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * For newsrooms without a feed: collect links whose path matches `pattern`,
 * taking the longest text segment inside the link as the title and any
 * date-looking segment as the publish date.
 */
export function parseHtmlLinks(html: string, pageUrl: string, pattern: RegExp): ParsedEntry[] {
  const byUrl = new Map<string, ParsedEntry>();
  for (const match of html.matchAll(ANCHOR)) {
    const attrs = match[1];
    const hrefMatch = HREF.exec(attrs);
    const href = hrefMatch?.[2] ?? hrefMatch?.[3];
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(decodeEntities(href), pageUrl);
    } catch {
      continue;
    }
    if (!pattern.test(url.pathname)) continue;
    url.hash = "";
    const parts = segments(match[2]);
    let publishedAt: Date | null = null;
    const textParts: string[] = [];
    for (const part of parts) {
      if (!publishedAt && DATE_LIKE.test(part)) {
        const d = parseDate(/^\d{4}-/.test(part) ? `${part}T00:00:00Z` : `${part} UTC`);
        if (d) {
          publishedAt = d;
          continue;
        }
      }
      textParts.push(part);
    }
    const label = LABEL.exec(attrs)?.[1];
    const title =
      textParts.sort((a, b) => b.length - a.length)[0] ?? (label ? decodeEntities(label) : titleFromSlug(url.pathname));
    const key = url.toString();
    const existing = byUrl.get(key);
    if (existing && existing.title.length >= title.length && (existing.publishedAt || !publishedAt)) continue;
    byUrl.set(key, {
      title,
      url: key,
      publishedAt: publishedAt ?? existing?.publishedAt ?? null,
      summary: null,
      authors: [],
      extra: {},
    });
  }
  return [...byUrl.values()].filter((e) => e.title);
}
