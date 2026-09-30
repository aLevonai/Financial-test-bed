import { parseDate, truncate } from "./text";
import type { ParsedEntry } from "./types";

interface KevVuln {
  cveID?: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  dateAdded?: string;
  shortDescription?: string;
  requiredAction?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
}

/** CISA Known Exploited Vulnerabilities catalog (JSON). */
export function parseCisaKev(json: string): ParsedEntry[] {
  const doc = JSON.parse(json) as { vulnerabilities?: KevVuln[] };
  return (doc.vulnerabilities ?? [])
    .filter((v) => v.cveID)
    .map((v) => {
      const ransomware = v.knownRansomwareCampaignUse === "Known";
      const summary = [v.shortDescription, ransomware ? "Known to be used in ransomware campaigns." : null]
        .filter(Boolean)
        .join(" ");
      return {
        title: `${v.cveID}: ${v.vulnerabilityName ?? `${v.vendorProject ?? ""} ${v.product ?? ""}`.trim()}`,
        url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
        publishedAt: v.dateAdded ? parseDate(`${v.dateAdded}T00:00:00Z`) : null,
        summary: summary ? truncate(summary, 1500) : null,
        authors: [],
        extra: {
          cve: v.cveID,
          vendor: v.vendorProject,
          product: v.product,
          kev_due_date: v.dueDate,
          ransomware,
        },
      };
    });
}

interface HfDailyPaper {
  title?: string;
  publishedAt?: string;
  numComments?: number;
  paper?: {
    id?: string;
    title?: string;
    summary?: string;
    upvotes?: number;
    publishedAt?: string;
    authors?: { name?: string }[];
  };
}

/** Hugging Face Daily Papers (community-curated arXiv papers with upvotes). */
export function parseHfDaily(json: string): ParsedEntry[] {
  const doc = JSON.parse(json) as HfDailyPaper[] | { papers?: HfDailyPaper[] };
  const list = Array.isArray(doc) ? doc : (doc.papers ?? []);
  return list
    .filter((p) => p.paper?.id)
    .map((p) => {
      const paper = p.paper!;
      return {
        title: (paper.title ?? p.title ?? "").replace(/\s+/g, " ").trim(),
        url: `https://arxiv.org/abs/${paper.id}`,
        publishedAt: parseDate(p.publishedAt ?? paper.publishedAt),
        summary: paper.summary ? truncate(paper.summary.replace(/\s+/g, " ").trim(), 1500) : null,
        authors: (paper.authors ?? []).map((a) => a.name ?? "").filter(Boolean).slice(0, 20),
        extra: { hf_upvotes: paper.upvotes ?? 0, hf_comments: p.numComments ?? 0 },
      };
    })
    .filter((e) => e.title);
}
