-- Tech Radar schema. Lives in its own schema so Supabase's auto-generated REST
-- API (which only exposes `public`) never serves it; the pipeline and the web
-- app connect with a direct Postgres URL instead.
create schema if not exists radar;

create table radar.sources (
  id              text primary key,
  name            text not null,
  kind            text not null,
  url             text not null,
  area            text not null check (area in ('crypto', 'security', 'ai', 'mixed')),
  tier            smallint not null check (tier between 1 and 4),
  enabled         boolean not null default true,
  last_fetched_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  last_item_count integer,
  updated_at      timestamptz not null default now()
);

create table radar.items (
  id              bigint generated always as identity primary key,
  -- Stable identity across sources: arxiv:2505.15917, eprint:2025/1234,
  -- cve:CVE-2025-1234, or url:<normalized url>.
  canonical_id    text not null unique,
  source_id       text not null references radar.sources (id),
  url             text not null,
  title           text not null,
  summary         text,
  authors         text[] not null default '{}',
  published_at    timestamptz,
  first_seen_at   timestamptz not null default now(),
  extra           jsonb not null default '{}'::jsonb,

  triage_status   text not null default 'pending'
                  check (triage_status in ('pending', 'done', 'error', 'skipped')),
  triage_attempts smallint not null default 0,
  triaged_at      timestamptz,
  triage_model    text,
  triage_error    text,
  relevant        boolean,
  area            text check (area in ('crypto', 'security', 'ai', 'other')),
  topics          text[] not null default '{}',
  significance    smallint check (significance between 1 and 5),
  confidence      text check (confidence in ('low', 'medium', 'high')),
  headline        text,
  why_it_matters  text,
  hype_flags      text[] not null default '{}'
);

create index items_pending_idx on radar.items (first_seen_at desc) where triage_status = 'pending';
create index items_feed_idx on radar.items (first_seen_at desc) where relevant;
create index items_source_idx on radar.items (source_id);

-- Every source an item was seen in. More independent sightings = corroboration.
create table radar.sightings (
  item_id       bigint not null references radar.items (id) on delete cascade,
  source_id     text not null references radar.sources (id) on delete cascade,
  url           text not null,
  extra         jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (item_id, source_id)
);

create index sightings_source_idx on radar.sightings (source_id);

create table radar.feedback (
  item_id    bigint primary key references radar.items (id) on delete cascade,
  vote       smallint not null check (vote in (-1, 1)),
  updated_at timestamptz not null default now()
);

create table radar.runs (
  id          bigint generated always as identity primary key,
  command     text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  stats       jsonb not null default '{}'::jsonb,
  error       text
);

create index runs_started_idx on radar.runs (started_at desc);

-- Defense in depth: no API role gets anything, even if the schema is exposed later.
alter table radar.sources   enable row level security;
alter table radar.items     enable row level security;
alter table radar.sightings enable row level security;
alter table radar.feedback  enable row level security;
alter table radar.runs      enable row level security;

revoke all on schema radar from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema radar from anon, authenticated';
  end if;
end $$;
