# Tech Radar

A personal radar for what actually changed in **cryptography**, **security**, and **AI**, ranked by substance rather than hype.

- A pipeline runs every 30 minutes on GitHub Actions. It pulls ~35 sources: IACR ePrint, NIST, IETF, CISA KEV, oss-security, arXiv, Hugging Face Daily Papers, AI lab newsrooms, and expert blogs.
- New items are de-duplicated across sources. When a second source reports the same paper or CVE, that corroboration triggers a re-score.
- A MiniMax model triages each item against [`profile.md`](profile.md) and gives it:
  - a 1–5 significance score and a confidence level
  - a plain headline and a short "why it matters"
  - hype flags where they apply (toy-scale results, benchmark-only gains, vendor-only claims, …)
- A password-protected web app (Next.js on Vercel) shows the feed. It refreshes throughout the day, and it can be installed to your phone's home screen.

See [PLAN.md](PLAN.md) for the design and roadmap.

## Layout

```
app/            Next.js web app (feed, sources health, login)
lib/            Shared DB client, queries, types, auth
pipeline/       Ingestion + triage (run by GitHub Actions)
  sources.ts    ← the source registry; add/remove sources here
  triage/       prompt, output schema, runner
profile.md      ← what you care about; the triage model reads it every run
db/migrations/  Postgres schema (lives in the `radar` schema)
tests/          Unit tests + an end-to-end pipeline test on embedded Postgres
```

## Setup

### 1. Database (Supabase)

The schema is already applied to the `tech-radar` Supabase project. You need its connection string:

1. Go to Supabase Dashboard → **tech-radar** → **Connect**.
2. Copy the **Transaction pooler** URI (port 6543). GitHub's runners have no IPv6, so the direct connection won't work.
3. Replace `[YOUR-PASSWORD]` with the database password. If you don't know it, reset it under **Database → Settings**.

### 2. GitHub secrets (pipeline)

Go to Repo → Settings → Secrets and variables → Actions:

| Name | Kind | Value |
|---|---|---|
| `DATABASE_URL` | secret | the pooler URI from step 1 |
| `MINIMAX_API_KEY` | secret | your MiniMax API key |
| `MINIMAX_BASE_URL` | variable (optional) | default `https://api.minimax.io/v1`; use `https://api.minimaxi.com/v1` for mainland-China keys |
| `MINIMAX_MODEL` | variable (optional) | default `MiniMax-M3` |

Then run it once: **Actions → Pipeline → Run workflow**. Choose `check` first to see which sources parse, then `all`.

### 3. Web app (Vercel)

1. At [vercel.com/new](https://vercel.com/new), import this repository. The defaults are fine; it's a standard Next.js app.
2. Add these environment variables:
   - `DATABASE_URL`: same pooler URI as in step 1
   - `APP_PASSWORD`: at least 8 characters; this is your login
3. Deploy. On your phone, open the URL and choose **Add to Home Screen**.

Functions run in Frankfurt (`vercel.json`), next to the database in `eu-central-1`.

## Local development

```bash
npm install
cp .env.example .env.local           # fill in values
npm run pipeline -- check            # fetch + parse every source, no DB
npm run pipeline -- check --source iacr-eprint
npm run pipeline -- all              # ingest + triage + prune (needs DATABASE_URL, MINIMAX_API_KEY)
npm run dev                          # web app on http://localhost:3000
npm test                             # unit + embedded-Postgres integration tests
npm run typecheck
```

## Tuning

- **What matters to you:** edit `profile.md`. It takes effect on the next run.
- **Sources:** edit `pipeline/sources.ts`. Newsrooms without feeds use `html-links` with a path pattern.
- **Scoring rubric and calibration examples:** `pipeline/triage/prompt.ts`.
- **Source health:** the Sources page in the app shows failures and how many notable items each source contributed.
