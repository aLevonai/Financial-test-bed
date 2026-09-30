# Tech Radar: plan

## Goal

Keep track of what actually changes in **cryptography** (especially post-quantum), **cybersecurity**, and **AI**: big lab announcements, influential papers, and real events rather than the hype cycle. The radar should answer one question: *what changed that I'd regret not knowing in six months?*

## Principles

1. **Read the primary source, not the coverage.** Every item traces back to the paper, advisory, standard, or model card.
2. **Count independent sources, not volume.** The same paper or CVE reported by several independent sources counts as corroboration, and it triggers a re-score.
3. **Use time as a filter.** Hype fades; real work picks up citations, implementations, and follow-ups. Re-scoring at +7 and +30 days is on the roadmap.
4. **Flag hype explicitly.** Each item can carry hype flags: toy-scale, extrapolated claim, benchmark-only, vendor claim, unreproduced, and similar.

## Decisions

| Area | Choice | Why |
|---|---|---|
| Interface | Password-protected web app, installable on the phone | Check in any time; data refreshes all day |
| Pipeline cadence | Every 30 min (GitHub Actions cron) | Free and unlimited for a public repo |
| LLM | MiniMax (`MiniMax-M3`, OpenAI-compatible API) | Existing key; ~$0.30 / $1.20 per M tokens, so continuous triage costs ~$10–25/month |
| Storage | Supabase Postgres, project `tech-radar` (eu-central-1), schema `radar` | Not exposed through Supabase's REST API; RLS on as a backstop |
| Hosting | Vercel (Next.js 16), region fra1 | Next to the database |
| Language | TypeScript throughout | Pipeline and app share DB code and types |
| Emphasis | PQC & standards, AI × security, frontier labs & policy | Encoded in `profile.md` |

## Sources (initial ~40, in `pipeline/sources.ts`)

- **Primary:**
  - Crypto: IACR ePrint, IETF (CFRG, PQUIP, TLS, LAMPS), NIST
  - Security: CISA KEV and advisories, oss-security, Project Zero, Google Security, MSRC
  - AI: OpenAI, Anthropic, DeepMind, Google Research, Microsoft Research, Mistral, DeepSeek, Qwen, xAI, UK AISI, METR
- **Firehose:** arXiv cs.CR and cs.LG/CL/AI, Hugging Face Daily Papers (upvotes are a signal)
- **Curators:**
  - Crypto and security: Matthew Green, Filippo Valsorda, Soatok, Cloudflare Research/PQ, Schneier, Trail of Bits, Krebs, The Record
  - AI: Simon Willison, Import AI, Interconnects, Zvi, Latent Space, Epoch AI, Hugging Face blog

Some URLs are best guesses. The Sources page shows which ones fail, so they can be fixed or dropped after the first runs.

## Pipeline

```
sources ─▶ parse (RSS/Atom/RDF, arXiv, KEV JSON, HF JSON, newsroom links)
        ─▶ canonical id (arxiv:…, eprint:…, cve:…, url:…) ─▶ upsert item + sighting
        ─▶ triage pending items in batches of 12 with MiniMax
           (profile + anchored 1–5 rubric + calibration cases + hype-flag list)
        ─▶ feed ranked by significance, corroboration, recency
```

- A newsroom's back catalogue is seeded as "already seen" on its first fetch, so old posts don't flood the feed.
- A new sighting from a different source re-queues an already-triaged item, so corroboration can raise its score.
- Items that fail triage are retried up to 3 times. Anything still pending after 7 days is skipped.
- Pruning: items below significance 3 are dropped after 30 days, unless you voted on them or a source still lists them.

## Roadmap

| Phase | Status | Scope |
|---|---|---|
| 0: Foundation | ✅ | Schema, source registry, fetchers/parsers, dedupe, scheduled pipeline, tests |
| 1: Triage + feed | ✅ | MiniMax triage, web feed (Today/Week/Month, area, min significance, top/latest), votes, source health, PWA |
| 1.5: Tune | next | Measure real volumes and source failures; fix broken URLs; calibrate the prompt on real output; make votes influence triage (few-shot from 👍/👎) |
| 2: Stories & signals | | Cluster items about the same event (embeddings + shared IDs); Hacker News and Bluesky expert-list signals; GitHub stars; backtest on a past month; recall check against curator newsletters |
| 3: Time as a filter | | Deep analysis of top stories (read the primary source); +7d/+30d re-scoring; weekly "what actually mattered" view; trackers (PQC migration, frontier releases, quantum resource estimates); push alerts for level-5 events |
| 4: Ask | | Search and "what's the latest on X?" answered from the archive |

## Risks

- **Scrapers break silently.** Covered by source-health tracking on the Sources page.
- **Prompt injection from fetched text.** The triage model has no tools, items are passed as JSON data, and the prompt says to ignore instructions inside them. Output is schema-validated and clamped.
- **Idle schedules.** GitHub pauses scheduled workflows after 60 idle days in public repos; the workflow re-enables itself on each run.
- **Supabase free tier.** Pruning keeps the database small; the pipeline's regular writes keep the project active.
- **Judge bias toward flashy claims.** Countered by base rates in the rubric, calibration cases, confidence levels, and (later) delayed re-scoring.
