import { XMLParser } from "fast-xml-parser";
import { decodeEntities, parseDate, stripHtml, truncate } from "./text";
import type { ParsedEntry } from "./types";

const SUMMARY_MAX = 1500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ["item", "entry", "link", "author", "category", "dc:creator"].includes(name),
});

type Node = unknown;

function text(node: Node): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("#text" in obj) return text(obj["#text"]);
    if ("name" in obj) return text(obj.name);
  }
  return "";
}

function clean(s: string): string {
  return stripHtml(decodeEntities(s));
}

function atomLink(links: Node): string {
  if (!Array.isArray(links)) return text(links);
  const objs = links.filter((l): l is Record<string, string> => typeof l === "object" && l !== null);
  const alt = objs.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? objs[0];
  if (alt?.["@_href"]) return alt["@_href"];
  return text(links[0]);
}

function splitAuthors(raw: string): string[] {
  return raw
    .split(/,\s*|\s+and\s+/)
    .map((a) => clean(a))
    .filter(Boolean);
}

function rssEntry(item: Record<string, Node>): ParsedEntry | null {
  const title = clean(text(item.title));
  const url = text(item.link).trim() || text(item.guid).trim();
  if (!title || !url) return null;
  const rawSummary = text(item.description) || text(item["content:encoded"]);
  const creators = Array.isArray(item["dc:creator"]) ? item["dc:creator"].map(text) : [];
  const authors = creators.length === 1 ? splitAuthors(creators[0]) : creators.map(clean).filter(Boolean);
  if (authors.length === 0 && item.author) authors.push(...(item.author as Node[]).map(text).map(clean).filter(Boolean));
  const extra: Record<string, unknown> = {};
  if (item["arxiv:announce_type"]) extra.announce_type = text(item["arxiv:announce_type"]);
  const categories = Array.isArray(item.category) ? item.category.map(text).filter(Boolean) : [];
  if (categories.length) extra.categories = categories.slice(0, 10);
  return {
    title,
    url,
    guid: text(item.guid) || undefined,
    publishedAt: parseDate(text(item.pubDate) || text(item["dc:date"])),
    summary: rawSummary ? truncate(clean(rawSummary), SUMMARY_MAX) : null,
    authors: authors.slice(0, 20),
    extra,
  };
}

function atomEntry(entry: Record<string, Node>): ParsedEntry | null {
  const title = clean(text(entry.title));
  const url = atomLink(entry.link) || text(entry.id);
  if (!title || !url) return null;
  const rawSummary = text(entry.summary) || text(entry.content);
  const authors = Array.isArray(entry.author) ? entry.author.map(text).map(clean).filter(Boolean) : [];
  return {
    title,
    url,
    guid: text(entry.id) || undefined,
    publishedAt: parseDate(text(entry.published) || text(entry.updated)),
    summary: rawSummary ? truncate(clean(rawSummary), SUMMARY_MAX) : null,
    authors: authors.slice(0, 20),
    extra: {},
  };
}

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom documents. */
export function parseFeed(xml: string): ParsedEntry[] {
  const doc = parser.parse(xml) as Record<string, Record<string, Node>>;
  let raw: { items: Node[]; kind: "rss" | "atom" };
  if (doc.rss) {
    const channel = doc.rss.channel as Record<string, Node>;
    raw = { items: (channel?.item as Node[]) ?? [], kind: "rss" };
  } else if (doc["rdf:RDF"]) {
    raw = { items: (doc["rdf:RDF"].item as Node[]) ?? [], kind: "rss" };
  } else if (doc.feed) {
    raw = { items: (doc.feed.entry as Node[]) ?? [], kind: "atom" };
  } else {
    throw new Error("Unrecognized feed format");
  }
  const toEntry = raw.kind === "rss" ? rssEntry : atomEntry;
  return raw.items
    .map((it) => toEntry(it as Record<string, Node>))
    .filter((e): e is ParsedEntry => e !== null);
}

const ARXIV_PREFIX = /^arXiv:\S+\s+Announce Type:\s*\S+\s*(Abstract:\s*)?/i;

/** arXiv's RSS: drop replacement announcements and the "arXiv:… Announce Type: new Abstract:" preamble. */
export function parseArxivFeed(xml: string): ParsedEntry[] {
  return parseFeed(xml)
    .filter((e) => !String(e.extra.announce_type ?? "").startsWith("replace"))
    .map((e) => ({ ...e, summary: e.summary ? e.summary.replace(ARXIV_PREFIX, "").trim() : null }));
}
