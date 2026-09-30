import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalId, normalizeUrl } from "@/pipeline/canonical";
import { normalizeEntries, parseSource } from "@/pipeline/ingest";
import { parseArxivFeed, parseFeed } from "@/pipeline/parsers/feed";
import { parseHtmlLinks } from "@/pipeline/parsers/htmlLinks";
import { parseCisaKev, parseHfDaily, parseIetfDocuments } from "@/pipeline/parsers/json";
import { SOURCES } from "@/pipeline/sources";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseArxivFeed", () => {
  const entries = parseArxivFeed(fixture("arxiv.xml"));

  it("keeps new and cross-listed papers, drops replacements", () => {
    expect(entries.map((e) => e.url)).toEqual(["https://arxiv.org/abs/2609.01234", "https://arxiv.org/abs/2609.05678"]);
  });

  it("strips the announce preamble and decodes entities", () => {
    expect(entries[0].summary).toBe("We give the first mechanized proof that the X25519MLKEM768 hybrid & its combiner are secure.");
  });

  it("splits the comma-separated creator list", () => {
    expect(entries[0].authors).toEqual(["Alice Adams", "Bob Brown", "Carol Chen"]);
  });

  it("parses the publish date", () => {
    expect(entries[0].publishedAt?.toISOString()).toBe("2026-09-29T04:00:00.000Z");
  });
});

describe("parseFeed", () => {
  it("reads RSS 2.0 with CDATA HTML and repeated dc:creator", () => {
    const [e] = parseFeed(fixture("eprint.xml"));
    expect(e.title).toBe("Improved Quantum Resource Estimates for ECDLP on P-256");
    expect(e.summary).toBe("We reduce the logical qubit count for Shor's algorithm on P-256 by 30%.");
    expect(e.authors).toEqual(["Frank Fox", "Grace Green"]);
    expect(e.extra.categories).toEqual(["Public-key cryptography"]);
  });

  it("reads Atom, preferring the alternate link and stripping scripts", () => {
    const [e] = parseFeed(fixture("atom.xml"));
    expect(e.title).toBe("Exploiting a Kernel Race & Winning");
    expect(e.url).toBe("https://example.blogspot.com/2026/09/race.html?utm_source=feed");
    expect(e.summary).toBe("A deep dive into a race condition.");
    expect(e.authors).toEqual(["Heidi Hill"]);
    expect(e.publishedAt?.toISOString()).toBe("2026-09-29T16:00:00.000Z");
  });

  it("reads RSS 1.0 / RDF", () => {
    const [e] = parseFeed(fixture("rdf.xml"));
    expect(e.title).toBe("RDF Item One");
    expect(e.publishedAt?.toISOString()).toBe("2026-09-27T12:00:00.000Z");
  });

  it("rejects documents that are not feeds", () => {
    expect(() => parseFeed("<html><body>nope</body></html>")).toThrow(/Unrecognized feed format/);
  });
});

describe("JSON sources", () => {
  it("maps CISA KEV entries to NVD links with ransomware context", () => {
    const [e] = parseCisaKev(fixture("kev.json"));
    expect(e.title).toBe("CVE-2026-12345: Example Gateway Authentication Bypass");
    expect(e.url).toBe("https://nvd.nist.gov/vuln/detail/CVE-2026-12345");
    expect(e.summary).toContain("Known to be used in ransomware campaigns.");
    expect(e.publishedAt?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("maps IETF datatracker documents, treating zone-less times as UTC", () => {
    const json = JSON.stringify({
      meta: { total_count: 1 },
      objects: [
        {
          name: "draft-ietf-tls-mlkem",
          title: "ML-KEM Post-Quantum Key\n   Agreement for TLS 1.3",
          abstract: "This memo defines ML-KEM-512, ML-KEM-768, and ML-KEM-1024 as NamedGroups.",
          time: "2026-09-28T10:15:00",
          rev: "05",
        },
      ],
    });
    const [e] = parseIetfDocuments(json);
    expect(e.title).toBe("ML-KEM Post-Quantum Key Agreement for TLS 1.3");
    expect(e.url).toBe("https://datatracker.ietf.org/doc/draft-ietf-tls-mlkem/");
    expect(e.publishedAt?.toISOString()).toBe("2026-09-28T10:15:00.000Z");
    expect(e.extra).toEqual({ draft: "draft-ietf-tls-mlkem", rev: "05" });
  });

  it("maps HF Daily Papers to arXiv links with upvotes", () => {
    const [e] = parseHfDaily(fixture("hf-daily.json"));
    expect(e.url).toBe("https://arxiv.org/abs/2609.05678");
    expect(e.title).toBe("Prompt Injection Attacks on Tool-Using Agents");
    expect(e.extra.hf_upvotes).toBe(87);
  });
});

describe("parseHtmlLinks", () => {
  it("extracts article links with dates and titles from a newsroom page", () => {
    const entries = parseHtmlLinks(fixture("anthropic-news.html"), "https://www.anthropic.com/news", /^\/news\/[a-z0-9-]+$/);
    expect(entries.length).toBe(6);
    const enzyme = entries.find((e) => e.url.endsWith("/news/claude-discovers-novel-enzyme-system"));
    expect(enzyme?.title).toBe("Claude discovers a novel enzyme system with CRISPR-like repeats");
    expect(enzyme?.publishedAt?.toISOString().slice(0, 10)).toBe("2026-09-23");
    expect(entries.every((e) => e.url.startsWith("https://www.anthropic.com/news/"))).toBe(true);
  });

  it("falls back to the slug when a link has no text", () => {
    const [e] = parseHtmlLinks('<a href="/blog/new-eval-results"><img src="x.png"></a>', "https://metr.org/blog/", /^\/blog\/[a-z0-9-]+$/);
    expect(e.title).toBe("New eval results");
    expect(e.url).toBe("https://metr.org/blog/new-eval-results");
  });
});

describe("canonicalId", () => {
  it("unifies arXiv abs/pdf/versioned links and OAI guids", () => {
    expect(canonicalId("https://arxiv.org/abs/2609.01234")).toBe("arxiv:2609.01234");
    expect(canonicalId("https://arxiv.org/pdf/2609.01234v3")).toBe("arxiv:2609.01234");
    expect(canonicalId("https://example.com/x", "oai:arXiv.org:2609.01234v1")).toBe("arxiv:2609.01234");
    expect(canonicalId("http://arxiv.org/abs/hep-th/9901001v2")).toBe("arxiv:hep-th/9901001");
  });

  it("recognizes ePrint and CVE identities", () => {
    expect(canonicalId("https://eprint.iacr.org/2026/1781")).toBe("eprint:2026/1781");
    expect(canonicalId("https://nvd.nist.gov/vuln/detail/cve-2026-12345")).toBe("cve:CVE-2026-12345");
  });

  it("normalizes other URLs", () => {
    expect(normalizeUrl("https://WWW.Example.com/post/?utm_source=x&b=2&a=1#frag")).toBe("example.com/post?a=1&b=2");
    expect(canonicalId("https://example.com/")).toBe("url:example.com");
  });
});

describe("normalizeEntries", () => {
  const kev = SOURCES.find((s) => s.id === "cisa-kev")!;

  it("drops entries older than the source window", () => {
    const items = normalizeEntries(kev, parseSource(kev, fixture("kev.json")), new Date("2026-09-30T00:00:00Z"));
    expect(items.map((i) => i.canonicalId)).toEqual(["cve:CVE-2026-12345"]);
  });

  it("gives arXiv and HF Daily the same identity for the same paper", () => {
    const arxiv = SOURCES.find((s) => s.id === "arxiv-cr")!;
    const hf = SOURCES.find((s) => s.id === "hf-daily")!;
    const now = new Date("2026-09-30T00:00:00Z");
    const a = normalizeEntries(arxiv, parseSource(arxiv, fixture("arxiv.xml")), now);
    const h = normalizeEntries(hf, parseSource(hf, fixture("hf-daily.json")), now);
    expect(a.map((i) => i.canonicalId)).toContain(h[0].canonicalId);
  });
});

describe("source registry", () => {
  it("has unique ids and html-links sources have patterns", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOURCES.filter((s) => s.kind === "html-links")) expect(s.linkPattern).toBeInstanceOf(RegExp);
  });
});
