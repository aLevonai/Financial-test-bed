import type { SourceArea } from "@/lib/types";

export type SourceKind = "feed" | "arxiv" | "cisa-kev" | "hf-daily" | "ietf-docs" | "html-links";

/**
 * Tier 1 = primary source (labs, standards bodies, advisories)
 * Tier 2 = firehose, filtered hard (arXiv, HF Daily Papers)
 * Tier 3 = curator / expert commentary
 */
export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  url: string;
  area: SourceArea;
  tier: 1 | 2 | 3;
  /** Ignore entries published longer ago than this. Default 7. */
  maxAgeDays?: number;
  /** html-links only: which link paths count as articles. */
  linkPattern?: RegExp;
  enabled?: boolean;
}

/** Drafts of an IETF/IRTF group updated in the last two weeks (the API doesn't allow ordering by time). */
const ietfDrafts = (group: string) => {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `https://datatracker.ietf.org/api/v1/doc/document/?format=json&type=draft&group__acronym=${group}&time__gte=${since}&limit=50`;
};

export const SOURCES: SourceDef[] = [
  // ── Cryptography ────────────────────────────────────────────────
  { id: "iacr-eprint", name: "IACR ePrint", kind: "feed", url: "https://eprint.iacr.org/rss/rss.xml", area: "crypto", tier: 1 },
  { id: "ietf-cfrg", name: "IETF CFRG drafts", kind: "ietf-docs", url: ietfDrafts("cfrg"), area: "crypto", tier: 1 },
  { id: "ietf-pquip", name: "IETF PQUIP drafts", kind: "ietf-docs", url: ietfDrafts("pquip"), area: "crypto", tier: 1 },
  { id: "ietf-tls", name: "IETF TLS drafts", kind: "ietf-docs", url: ietfDrafts("tls"), area: "crypto", tier: 1 },
  { id: "ietf-lamps", name: "IETF LAMPS drafts", kind: "ietf-docs", url: ietfDrafts("lamps"), area: "crypto", tier: 1 },
  { id: "rfc-editor", name: "New RFCs", kind: "feed", url: "https://www.rfc-editor.org/rfcrss.xml", area: "mixed", tier: 1, maxAgeDays: 45 }, // RFCs are dated by month
  { id: "nist-csrc", name: "NIST CSRC News", kind: "html-links", url: "https://csrc.nist.gov/news", linkPattern: /^\/News\/\d{4}\/[A-Za-z0-9-]+$/i, area: "crypto", tier: 1 },
  { id: "nist-news", name: "NIST News", kind: "feed", url: "https://www.nist.gov/news-events/news/rss.xml", area: "mixed", tier: 1 },
  { id: "cloudflare-pq", name: "Cloudflare: Post-Quantum", kind: "feed", url: "https://blog.cloudflare.com/tag/post-quantum/rss/", area: "crypto", tier: 3 },
  { id: "cloudflare-research", name: "Cloudflare Research", kind: "feed", url: "https://blog.cloudflare.com/tag/research/rss/", area: "mixed", tier: 3 },
  { id: "matthew-green", name: "Matthew Green", kind: "feed", url: "https://blog.cryptographyengineering.com/feed/", area: "crypto", tier: 3 },
  { id: "filippo", name: "Filippo Valsorda", kind: "feed", url: "https://words.filippo.io/rss/", area: "crypto", tier: 3 },
  { id: "soatok", name: "Soatok", kind: "feed", url: "https://soatok.blog/feed/", area: "crypto", tier: 3 },

  // ── Security ────────────────────────────────────────────────────
  { id: "cisa-kev", name: "CISA KEV", kind: "cisa-kev", url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", area: "security", tier: 1, maxAgeDays: 14 },
  { id: "cisa-advisories", name: "CISA Advisories", kind: "feed", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", area: "security", tier: 1 },
  { id: "oss-security", name: "oss-security", kind: "feed", url: "https://seclists.org/rss/oss-sec.rss", area: "security", tier: 1 },
  { id: "project-zero", name: "Project Zero", kind: "feed", url: "https://googleprojectzero.blogspot.com/feeds/posts/default", area: "security", tier: 1 },
  { id: "google-security", name: "Google Security Blog", kind: "feed", url: "https://security.googleblog.com/feeds/posts/default", area: "security", tier: 1 },
  { id: "msrc", name: "Microsoft Security Response Center", kind: "feed", url: "https://msrc.microsoft.com/blog/feed", area: "security", tier: 1, enabled: false }, // 403 from GitHub runners (bot protection)
  { id: "arxiv-cr", name: "arXiv cs.CR", kind: "arxiv", url: "https://rss.arxiv.org/rss/cs.CR", area: "security", tier: 2 },
  { id: "schneier", name: "Schneier on Security", kind: "feed", url: "https://www.schneier.com/feed/atom/", area: "security", tier: 3 },
  { id: "trail-of-bits", name: "Trail of Bits", kind: "feed", url: "https://blog.trailofbits.com/feed/", area: "security", tier: 3 },
  { id: "krebs", name: "Krebs on Security", kind: "feed", url: "https://krebsonsecurity.com/feed/", area: "security", tier: 3 },
  { id: "the-record", name: "The Record", kind: "feed", url: "https://therecord.media/feed", area: "security", tier: 3 },

  // ── AI: labs and institutes ─────────────────────────────────────
  { id: "openai", name: "OpenAI", kind: "feed", url: "https://openai.com/news/rss.xml", area: "ai", tier: 1 },
  { id: "anthropic", name: "Anthropic", kind: "html-links", url: "https://www.anthropic.com/news", linkPattern: /^\/news\/[a-z0-9-]+$/, area: "ai", tier: 1 },
  { id: "deepmind", name: "Google DeepMind", kind: "feed", url: "https://deepmind.google/blog/rss.xml", area: "ai", tier: 1 },
  { id: "google-research", name: "Google Research", kind: "feed", url: "https://research.google/blog/rss/", area: "ai", tier: 1 },
  { id: "microsoft-research", name: "Microsoft Research", kind: "feed", url: "https://www.microsoft.com/en-us/research/feed/", area: "ai", tier: 1, enabled: false }, // 403 from GitHub runners (bot protection)
  { id: "mistral", name: "Mistral AI", kind: "html-links", url: "https://mistral.ai/news", linkPattern: /^\/news\/[a-z0-9-]+\/?$/, area: "ai", tier: 1 },
  { id: "deepseek", name: "DeepSeek", kind: "html-links", url: "https://api-docs.deepseek.com/", linkPattern: /^\/news\/news\d+$/, area: "ai", tier: 1, enabled: false }, // docs sidebar only exposes a generic "News" link
  { id: "qwen", name: "Qwen", kind: "feed", url: "https://qwenlm.github.io/blog/index.xml", area: "ai", tier: 1 },
  { id: "xai", name: "xAI", kind: "html-links", url: "https://x.ai/news", linkPattern: /^\/news\/[a-z0-9-]+\/?$/, area: "ai", tier: 1, enabled: false }, // 403 from GitHub runners (bot protection)
  { id: "uk-aisi", name: "UK AI Security Institute", kind: "html-links", url: "https://www.aisi.gov.uk/blog", linkPattern: /^\/blog\/[a-z0-9-]+\/?$/, area: "ai", tier: 1 },
  { id: "metr", name: "METR", kind: "html-links", url: "https://metr.org/blog/", linkPattern: /^\/blog\/[a-z0-9-]+\/?$/, area: "ai", tier: 1 },

  // ── AI: papers ──────────────────────────────────────────────────
  { id: "arxiv-ai", name: "arXiv cs.LG/CL/AI", kind: "arxiv", url: "https://rss.arxiv.org/rss/cs.LG+cs.CL+cs.AI", area: "ai", tier: 2 },
  { id: "hf-daily", name: "Hugging Face Daily Papers", kind: "hf-daily", url: "https://huggingface.co/api/daily_papers", area: "ai", tier: 2 },

  // ── AI: curators ────────────────────────────────────────────────
  { id: "simon-willison", name: "Simon Willison", kind: "feed", url: "https://simonwillison.net/atom/entries/", area: "ai", tier: 3 },
  { id: "import-ai", name: "Import AI", kind: "feed", url: "https://importai.substack.com/feed", area: "ai", tier: 3, enabled: false }, // 403 from GitHub runners (bot protection)
  { id: "interconnects", name: "Interconnects", kind: "feed", url: "https://www.interconnects.ai/feed", area: "ai", tier: 3 },
  { id: "zvi", name: "Don't Worry About the Vase", kind: "feed", url: "https://thezvi.substack.com/feed", area: "ai", tier: 3, enabled: false }, // 403 from GitHub runners (bot protection)
  { id: "latent-space", name: "Latent Space", kind: "feed", url: "https://www.latent.space/feed", area: "ai", tier: 3 },
  { id: "epoch", name: "Epoch AI", kind: "feed", url: "https://epochai.substack.com/feed", area: "ai", tier: 3, enabled: false }, // 403 from GitHub runners (bot protection)
  { id: "hf-blog", name: "Hugging Face Blog", kind: "feed", url: "https://huggingface.co/blog/feed.xml", area: "ai", tier: 3 },
];
