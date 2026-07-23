-- tryon_pipeline — dormant plumbing for on-demand virtual try-on (L'Officiel concierge commerce)
--
-- WHY THESE TABLES (platform-hygiene justification, per .claude/rules/platform-hygiene.md):
--   A user on a boutique product page requests "try it on"; the garment (product packshot)
--   is dressed onto a model by an external engine (Kling). This is asynchronous (submit ->
--   poll -> fetch), so it needs a job ledger, and the output is SYNTHESIS not testimony, so
--   per agent-trust-invariants it gets its OWN table and NEVER mutates the real product row.
--   No existing table covers this (capability preflight CLEAR; no concierge job/result table
--   exists — only concierge_partner_sync_runs, which is IG-specific). These two are the
--   minimum: one job queue, one result store.
--
-- DORMANT: no cron is scheduled here. The poller cron is added at DEPLOY time, only once
--   `tryon-generate` is deployed AND an engine key is funded — scheduling a cron that calls
--   an undeployed function is "scheduling a void" (.claude/rules/production-engineering.md).
--
-- IDENTITY: keyed on the ephemeral device `client_id` (same handle as concierge_inquiries) —
--   there is no durable user yet. Re-key onto real identity when auth lands (v2).

-- ---------------------------------------------------------------------------
-- tryon_jobs — async work ledger (submit -> poll -> fetch), mirrors the
-- next_*_at re-schedule pattern from concierge_partner_connections / instagram-connect.
-- ---------------------------------------------------------------------------
create table if not exists public.tryon_jobs (
  id               uuid primary key default gen_random_uuid(),
  client_id        text,                       -- ephemeral device identity (interim key)
  product_id       uuid references public.concierge_products(id) on delete set null,
  garment_image_url text not null,             -- resolved from concierge_products.media[0]
  model_image_url  text,                        -- null => engine default library model
  engine           text not null default 'kling',
  provider_job_id  text,                        -- external task id (set after /submit)
  status           text not null default 'submitted'
                     check (status in ('submitted','polling','done','error')),
  next_poll_at     timestamptz,                 -- poller drains rows where next_poll_at <= now()
  attempts         integer not null default 0,
  error            text,
  params           jsonb not null default '{}'::jsonb,  -- request echo (prompt, size, etc.)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.tryon_jobs is
  'Async virtual try-on job ledger (concierge commerce). submit->poll->fetch. Dormant until tryon-generate deployed + engine funded.';

create index if not exists tryon_jobs_poll_idx
  on public.tryon_jobs (next_poll_at)
  where status in ('submitted','polling');
create index if not exists tryon_jobs_client_idx on public.tryon_jobs (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- tryon_results — SYNTHESIS output, carries the full source-DNA quartet
-- (source, method, observed_at, trust) exactly like ingest_shopify_catalog.py rows.
-- NEVER written onto a concierge_products row — synthetic content is a distinct entity.
-- ---------------------------------------------------------------------------
create table if not exists public.tryon_results (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid references public.tryon_jobs(id) on delete cascade,
  product_id   uuid references public.concierge_products(id) on delete set null,
  client_id    text,
  -- source-DNA quartet (the numbers-carry-source-DNA invariant)
  source       text not null default 'kling',        -- engine that produced it
  method       text not null default 'virtual_tryon',
  observed_at  timestamptz not null default now(),
  trust        text not null default 'synthetic',     -- lowest tier: this is generated, not observed
  -- provenance + media mirror the concierge_products jsonb contract
  provenance   jsonb not null default '{}'::jsonb,    -- {product_id, model_image_ref, provider_job_id, prompt, engine, engine_version, generated_at}
  media        jsonb not null default '[]'::jsonb,    -- [{url, type:'image', source}]
  storage_path text,                                   -- concierge-media/tryon/<job>/<...>
  cost         jsonb,                                   -- {credits, usd}
  created_at   timestamptz not null default now()
);
comment on table public.tryon_results is
  'Virtual try-on outputs (SYNTHESIS, trust=synthetic). Separate entity; never overwrites the real product row (agent-trust-invariants).';

create index if not exists tryon_results_product_idx on public.tryon_results (product_id, created_at desc);
create index if not exists tryon_results_client_idx  on public.tryon_results (client_id, created_at desc);

-- RLS: writes happen only through the service-role edge function; no public policies.
alter table public.tryon_jobs    enable row level security;
alter table public.tryon_results enable row level security;
