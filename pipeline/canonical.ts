const ARXIV = /arxiv\.org\/(?:abs|pdf|html)\/((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?/i;
const ARXIV_OAI = /^oai:arXiv\.org:((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?$/i;
const EPRINT = /eprint\.iacr\.org\/(\d{4})\/(\d+)/i;
const CVE = /\b(CVE-\d{4}-\d{4,})\b/i;
const TRACKING_PARAMS = /^(utm_\w+|ref|ref_src|fbclid|gclid|mc_cid|mc_eid)$/i;

export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "";
  return `${host}${path}${query}`;
}

/** A stable identity for the thing an entry is about, shared across sources. */
export function canonicalId(url: string, guid?: string): string {
  const arxiv = ARXIV.exec(url) ?? (guid ? ARXIV_OAI.exec(guid) : null);
  if (arxiv) return `arxiv:${arxiv[1]}`;
  const eprint = EPRINT.exec(url);
  if (eprint) return `eprint:${eprint[1]}/${eprint[2]}`;
  if (/nvd\.nist\.gov\/vuln\/detail\/|cve\.org\/CVERecord/i.test(url)) {
    const cve = CVE.exec(url);
    if (cve) return `cve:${cve[1].toUpperCase()}`;
  }
  return `url:${normalizeUrl(url)}`;
}
