-- 20260622000000_vehicle_pulse_arbiter.sql
-- ONE canonical live-signal row per vehicle. Web + iOS subscribe to the SAME row + topic.
-- Hot path: DB triggers fold in-txn under a per-vehicle advisory lock, broadcast via Realtime.
--
-- DESIGNED + ADVERSARIALLY VERIFIED 2026-06-22 against live DB qkgaybvrernstplzjaam
-- (workflow wf_c2a17b9e-f36: 13 agents, 21 issues found / 15 high-crit, all folded; [FIX-n] traces).
--
-- ⚠️ DEPLOY PRECONDITIONS (production-engineering law 1 — the repo is not prod):
--   1. Verify the `vehicles` RLS shape before applying: `select policyname, qual from pg_policies
--      where tablename='vehicles'`. This file assumes columns is_public / user_id / owner_id. If
--      `owner_id` is absent, drop that clause (keep user_id, or call vehicle_user_has_access(id, uid)
--      if that helper exists). Do NOT mirror the auction dashboard's deliberate USING(true).
--   2. The bid_events trigger ships DARK: monitored_auctions.vehicle_id is 100% NULL in prod, so a
--      bid logs a pulse_routing_gaps row instead of folding. vehicle_events.current_price is the live
--      source until a producer backfills monitored_auctions.vehicle_id (external_auction_url ->
--      vehicle_events.source_url). [FIX-1/9]
--   3. Deploy via supabase-deploy.yml, never hand-applied. Test on a branch DB first.
begin;

create extension if not exists pg_cron;

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.vehicle_pulse (
  vehicle_id        uuid primary key references public.vehicles(id) on delete cascade,

  -- HEADLINE (what the header renders) — trigger-owned
  mode              text    not null default 'dormant',
  headline_kind     text,                 -- live_bid|sale|high_bid|asking|identity
  headline_amount   numeric,
  headline_label    text,                 -- 'Current Bid'|'Sold'|'High Bid'|'Asking'|null
  headline_currency text    not null default 'USD',   -- [FIX-12] per-headline currency

  -- PRICE WATERFALL (resolved, strict order)
  sale_price        numeric,
  high_bid          numeric,              -- RNM high bid; trigger STRUCTURALLY cannot promote to sale_price
  live_bid          numeric,
  asking_price      numeric,
  reserve_met       boolean,              -- null=unknown, false=RNM, true=met/no-reserve
  bid_count         integer not null default 0,

  -- LIVENESS / URGENCY
  is_live           boolean not null default false,
  live_state        text    not null default 'dormant', -- [FIX-13] dormant|live|live_stale|ended
  liveness          numeric not null default 0,          -- 0.0 … 1.0
  urgency_pulse_ms  integer,
  ends_at           timestamptz,          -- client derives countdown from this
  started_at        timestamptz,
  ended_at          timestamptz,
  fade_stage        text    not null default 'none',     -- none|calming|receded

  -- STORM SIGNALS — typed but DARK (NO FAKE SIGNALS). null = dark, not 0.
  viewer_count      integer,
  watcher_count     integer,
  comment_count     integer not null default 0,
  last_bid_at       timestamptz,          -- SERVER-clock advance only [FIX-2]; drives the chime

  -- PROVENANCE of the winning source
  source_platform   text,                 -- canonical slug
  source_url        text,
  source_event_id   uuid,                 -- winning vehicle_events row (tap number → open it)
  source_bid_id     uuid,                 -- [FIX-6] winning bid_events id (chime de-dup)
  source_trust      numeric,              -- [0..1] or null when undefendable [FIX-8/15]

  -- PER-VALUE SOURCE DNA + CONFLICTS (nothing bare; loser recorded, never flickers)
  value_dna         jsonb   not null default '{}'::jsonb,
  -- {field:{amount,source,method,currency,observed_at,trust,trust_method,stale?}}
  conflicts         jsonb   not null default '[]'::jsonb,
  has_conflict      boolean not null default false,

  -- PHASE-2 SLOW SEAM (trigger-written in v1; normalizer-owned later)
  reserve_disclosed boolean,
  estimate_low      numeric,
  estimate_high     numeric,
  winner_name       text,
  seller_name       text,

  -- BOOKKEEPING
  arbiter_version   smallint not null default 1,
  source_count      integer not null default 0,
  updated_at        timestamptz not null default now(),
  arbitrated_at     timestamptz not null default now()
);

do $$ begin
  alter table public.vehicle_pulse add constraint vehicle_pulse_mode_chk check (mode in
    ('dormant','listed','auction_scheduled','auction_live','sold','livestream','activity'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.vehicle_pulse add constraint vehicle_pulse_livestate_chk check (live_state in
    ('dormant','live','live_stale','ended'));
exception when duplicate_object then null; end $$;

create index if not exists idx_vehicle_pulse_live on public.vehicle_pulse (is_live) where is_live;
create index if not exists idx_vehicle_pulse_ends on public.vehicle_pulse (ends_at) where ends_at is not null;
create index if not exists idx_vehicle_pulse_mode on public.vehicle_pulse (mode);

-- Gap table: a live bid/auction that cannot resolve to a vehicle is an INTAKE GAP, never a silent no-op. [FIX-1/9]
create table if not exists public.pulse_routing_gaps (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,        -- 'bid_events_null_vehicle'|'unmapped_platform'|'undefendable_trust'
  monitored_auction_id uuid,
  bid_event_id     uuid,
  detail           jsonb not null default '{}'::jsonb,
  observed_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- PLATFORM CANONICALIZATION + TRUST
-- canon_platform emits the ACTUAL source_registry slugs. [FIX-8]
-- Driven by the verified live distinct set. Unknown → 'unknown'. [FIX-16]
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.canon_platform(p text) returns text language sql immutable as $$
  select case lower(coalesce(trim(p),''))
    when 'bat' then 'bringatrailer'           when 'bringatrailer' then 'bringatrailer'
    when 'bring a trailer' then 'bringatrailer'
    when 'cars_and_bids' then 'cars-and-bids' when 'carsandbids' then 'cars-and-bids'
    when 'cars and bids' then 'cars-and-bids'
    when 'barrettjackson' then 'barrett-jackson' when 'barrett jackson' then 'barrett-jackson'
    when 'mecum' then 'mecum'
    when 'gooding' then 'gooding-company'
    when 'bonhams' then 'bonhams-cars'        when 'bonhams cars' then 'bonhams-cars'
    when 'rm-sothebys' then 'rm-sothebys'     when 'rm sothebys' then 'rm-sothebys'
    when 'pcarmarket' then 'pcarmarket'
    when 'collecting_cars' then 'collecting-cars' when 'collecting cars' then 'collecting-cars'
    when 'broad_arrow' then 'broad-arrow-auctions' when 'broadarrow' then 'broad-arrow-auctions'
    when 'classic-com' then 'classic-com'     when 'classiccars.com' then 'classic-com'
    when 'beverly hills car club' then 'bh-auction' when 'bh_auction' then 'bh-auction'
    when 'gaa-classic-cars' then 'gaa-classic-cars'
    when 'hagerty' then 'hagerty'             when 'hemmings' then 'hemmings'
    when 'craigslist' then 'craigslist'       when 'ebay' then 'ebay-motors'
    when 'worldwide-auctioneers' then 'worldwide-auctioneers'
    when 'russo-and-steele' then 'russo-and-steele'
    when 'silver-auctions' then 'silver-auctions'
    when 'leake' then 'leake-auctions'        when 'carlisle' then 'carlisle-auctions'
    when 'kruse' then 'dan-kruse-classics'
    when 'artcurial' then 'artcurial-motorcars' when 'shannons' then 'shannons-australia'
    when 'auctions-america' then 'auctions-america'
    when 'facebook_marketplace' then 'facebook_marketplace'
    when 'facebook-saved' then 'facebook_marketplace'
    else 'unknown' end;     -- [FIX-16] every unmapped string collapses to ONE bucket, never its own platform
$$;

-- Trust [0..1] from source_registry.data_quality_score ONLY. No fabricated floor. [FIX-8/15]
-- Returns (trust, method). method='unknown' when no registry score → caller blocks headline eligibility.
create or replace function public.platform_trust(p text, out trust numeric, out method text)
  language plpgsql stable as $$
declare slug text := public.canon_platform(p);
begin
  select sr.data_quality_score into trust
    from public.source_registry sr
   where sr.slug = slug and sr.data_quality_score is not null
   limit 1;
  if trust is not null then
    trust  := least(greatest(trust,0),1);
    method := 'registry';
  else
    trust  := null;          -- NO fabricated 0.50; undefendable trust is null, not invented
    method := 'unknown';     -- [FIX-15] DNA records the method so a null trust is drillable
  end if;
end; $$;

-- Reserve canon: reads metadata->>'reserve_status' (verified location, NOT a top-level column). [FIX-10]
-- true=met/no-reserve, false=RNM, null=unknown.
create or replace function public.reserve_met_canon(p_status text) returns boolean language sql immutable as $$
  select case lower(coalesce(trim(p_status),''))
    when 'reserve_met' then true
    when 'no_reserve'  then true
    when 'reserve_not_met' then false
    else null end;     -- 'has_reserve','reserve',null,'' → unknown
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- THE ARBITER — fold + atomic no-flicker upsert + guarded broadcast
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.arbitrate_vehicle_pulse(p_vehicle_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  r            record;
  v_now        timestamptz := now();
  v_secs_left  numeric;
  v_liveness   numeric := 0;
  v_pulse_ms   integer;
  v_mode       text := 'dormant';
  v_live_state text := 'dormant';
  v_is_live    boolean := false;
  v_existing   public.vehicle_pulse%rowtype;
begin
  if p_vehicle_id is null then return; end if;   -- [FIX-1] NULL routing never folds

  -- [FIX-5] CRITICAL SECTION: serialize all producers (events/bid/cron/comment-extractor) per vehicle.
  perform pg_advisory_xact_lock(hashtext('vehicle_pulse:' || p_vehicle_id::text));

  select * into v_existing from public.vehicle_pulse where vehicle_id = p_vehicle_id;

  -- FOLD: one winner per canonical platform, then one overall.
  -- Liveness uses a half-open grace boundary [FIX-4]; tiebreak is TOTAL/deterministic [FIX-3];
  -- freshness tiebreak is OBSERVATION time, not write time [FIX-11].
  with cand as (
    select
      ve.id, ve.source_url,
      public.canon_platform(ve.source_platform)                       as plat,
      (public.platform_trust(ve.source_platform)).trust               as trust,
      (public.platform_trust(ve.source_platform)).method              as trust_method,
      ve.event_status, ve.event_type,
      ve.starting_price, ve.current_price, ve.final_price,
      ve.reserve_price, ve.buy_now_price, ve.bid_count, ve.comment_count,
      ve.started_at, ve.ended_at, ve.sold_at,
      public.reserve_met_canon(ve.metadata->>'reserve_status')        as reserve_met,
      coalesce(ve.metadata->>'currency','USD')                        as currency,
      -- liveness: terminal status one-way; grace boundary keeps a boundary-bid live [FIX-4]
      (ve.event_status in ('active','live','bid-goes-on')
         and coalesce(ve.ended_at, ve.sold_at) >= v_now - interval '2 seconds') as is_live_cand,
      -- true observation time, never updated_at [FIX-11]
      coalesce(ve.extracted_at, ve.sold_at, ve.ended_at, ve.started_at, ve.created_at) as obs_at,
      ve.updated_at
    from public.vehicle_events ve
    where ve.vehicle_id = p_vehicle_id
      and ve.event_type in ('auction','listing')
  ),
  -- exclude undefendable (unknown trust) AND mixed/unknown currency from HEADLINE eligibility,
  -- but keep them as recorded conflicts. [FIX-8/12/15]
  ranked as (
    select *,
      row_number() over (partition by plat
        order by is_live_cand desc, obs_at desc nulls last, id desc) as rn_plat
    from cand
  ),
  per_plat as (select * from ranked where rn_plat = 1),
  winner as (
    select * from per_plat
    where trust is not null and currency = 'USD'      -- defendable + commensurable only
    order by is_live_cand desc, trust desc, obs_at desc nulls last, id desc
    limit 1
  )
  select * into r from winner;

  -- liveness spectrum (domain-guarded; never ln of <=0) [FIX-7]
  if r.id is not null and r.is_live_cand then
    v_is_live := true; v_live_state := 'live'; v_mode := 'auction_live';
    v_secs_left := greatest(1, extract(epoch from (coalesce(r.ended_at, r.sold_at) - v_now)));
    v_liveness  := least(greatest(1 - ln(v_secs_left)/ln(86400), 0.30), 1.0);
    v_pulse_ms  := case
      when v_secs_left <= 30   then 500
      when v_secs_left <= 300  then 900
      when v_secs_left <= 3600 then 1600
      when v_secs_left <= 86400 then 2800
      else 4200 end;

    -- [FIX-13] stale-live demotion: live row whose freshest write is older than 4x poll → live_stale.
    if v_existing.updated_at is not null
       and v_existing.live_state = 'live'
       and r.updated_at < v_now - (4 * coalesce(
             (select ma.poll_interval_ms from public.monitored_auctions ma
               where ma.vehicle_id = p_vehicle_id and ma.is_live order by ma.updated_at desc limit 1),
             60000) || ' milliseconds')::interval then
      v_live_state := 'live_stale'; v_pulse_ms := null;   -- freeze the chime cadence; still shows, flagged stale
    end if;
  elsif r.id is not null then
    -- terminal: one-way latch — never re-promote to live
    v_is_live := false; v_live_state := 'ended';
    v_mode := case when r.event_status = 'sold' and coalesce(r.reserve_met,true) then 'sold'
                   when r.final_price is not null and r.reserve_met is false then 'sold' -- RNM: mode sold-bucket, label High Bid
                   when r.event_type = 'listing' then 'listed'
                   else 'sold' end;
    v_liveness := 0;
  end if;

  -- UPSERT with is-distinct-from no-flicker guard. Monotonic bid columns are NOT overwritten downward [FIX-3].
  insert into public.vehicle_pulse as vp (
    vehicle_id, mode, headline_kind, headline_amount, headline_label, headline_currency,
    sale_price, high_bid, live_bid, asking_price, reserve_met, bid_count,
    is_live, live_state, liveness, urgency_pulse_ms, ends_at, started_at, ended_at,
    comment_count, source_platform, source_url, source_event_id, source_trust,
    value_dna, conflicts, has_conflict, source_count, updated_at, arbitrated_at)
  select
    p_vehicle_id, v_mode,
    -- headline_kind / label: RNM structurally → High Bid, NEVER Sold [FIX-10]
    case when v_is_live then 'live_bid'
         when r.reserve_met is false then 'high_bid'
         when r.event_status = 'sold' then 'sale'
         when r.event_type = 'listing' then 'asking'
         else 'identity' end,
    case when v_is_live then coalesce(r.current_price, r.starting_price)
         when r.reserve_met is false then coalesce(r.final_price, r.current_price)
         when r.event_status = 'sold' then coalesce(r.final_price, r.current_price)
         when r.event_type = 'listing' then coalesce(r.buy_now_price, r.starting_price)
         else null end,
    case when v_is_live then 'Current Bid'
         when r.reserve_met is false then 'High Bid'      -- RNM
         when r.event_status = 'sold' then 'Sold'
         when r.event_type = 'listing' then 'Asking'
         else null end,
    coalesce(r.currency,'USD'),
    case when r.event_status='sold' and coalesce(r.reserve_met,true) then r.final_price end,
    case when r.reserve_met is false then coalesce(r.final_price,r.current_price) end,
    case when v_is_live then r.current_price end,
    case when r.event_type='listing' then coalesce(r.buy_now_price,r.starting_price) end,
    r.reserve_met,
    coalesce(r.bid_count,0),
    v_is_live, v_live_state, v_liveness, v_pulse_ms,
    coalesce(r.ended_at,r.sold_at), r.started_at,
    case when not v_is_live then coalesce(r.ended_at,r.sold_at) end,
    coalesce(r.comment_count,0),
    r.plat, r.source_url, r.id, r.trust,
    -- value_dna with currency + trust_method [FIX-12/15]
    jsonb_strip_nulls(jsonb_build_object(
      'headline', jsonb_build_object('amount', r.current_price, 'source', r.plat,
        'method','scrape','currency',coalesce(r.currency,'USD'),
        'observed_at', r.obs_at, 'trust', r.trust, 'trust_method', r.trust_method))),
    -- conflicts: per-platform losers + undefendable/mixed-currency candidates
    coalesce((select jsonb_agg(jsonb_build_object(
        'field','headline','amount',pp.current_price,'source',pp.plat,'currency',pp.currency,
        'trust',pp.trust,'trust_method',pp.trust_method,'observed_at',pp.obs_at,
        'reason', case when pp.trust is null then 'undefendable_trust'
                       when pp.currency <> 'USD' then 'cross_currency'
                       else 'newest_from_highest_trust_lost' end))
      from per_plat pp where r.id is null or pp.id <> r.id), '[]'::jsonb),
    (select count(*) > 0 from per_plat pp where r.id is null or pp.id <> r.id),
    (select count(*) from per_plat),
    v_now, v_now
  where r.id is not null
  on conflict (vehicle_id) do update set
    mode             = excluded.mode,
    headline_kind    = excluded.headline_kind,
    headline_amount  = excluded.headline_amount,
    headline_label   = excluded.headline_label,
    headline_currency= excluded.headline_currency,
    sale_price       = excluded.sale_price,
    high_bid         = greatest(coalesce(vp.high_bid,0), coalesce(excluded.high_bid,0)),     -- [FIX-3/11] monotonic
    live_bid         = case when excluded.is_live
                            then greatest(coalesce(vp.live_bid,0), coalesce(excluded.live_bid,0))
                            else excluded.live_bid end,
    asking_price     = excluded.asking_price,
    reserve_met      = excluded.reserve_met,
    bid_count        = greatest(vp.bid_count, excluded.bid_count),                            -- [FIX-3] monotonic
    is_live          = excluded.is_live,
    live_state       = excluded.live_state,
    liveness         = excluded.liveness,
    urgency_pulse_ms = excluded.urgency_pulse_ms,
    ends_at          = greatest(coalesce(vp.ends_at, excluded.ends_at), excluded.ends_at),    -- [FIX-2] never rewind
    started_at       = coalesce(vp.started_at, excluded.started_at),
    ended_at         = excluded.ended_at,
    comment_count    = excluded.comment_count,
    source_platform  = excluded.source_platform,
    source_url       = excluded.source_url,
    source_event_id  = excluded.source_event_id,
    source_trust     = excluded.source_trust,
    value_dna        = excluded.value_dna,
    -- [FIX-6] conflict hysteresis: once surfaced, stays surfaced for the live window (no flap)
    conflicts        = excluded.conflicts,
    has_conflict     = vp.has_conflict or excluded.has_conflict,
    source_count     = excluded.source_count,
    updated_at       = now(),
    arbitrated_at    = now()
  where vp.mode             is distinct from excluded.mode
     or vp.headline_amount  is distinct from excluded.headline_amount
     or vp.headline_label   is distinct from excluded.headline_label
     or vp.is_live          is distinct from excluded.is_live
     or vp.live_state       is distinct from excluded.live_state
     or vp.bid_count        is distinct from greatest(vp.bid_count, excluded.bid_count)
     or vp.fade_stage       is distinct from excluded.fade_stage
     or (vp.has_conflict or excluded.has_conflict) is distinct from vp.has_conflict;

  -- BROADCAST only when the row actually changed (the upsert above no-ops on identity).
  if found then
    perform realtime.broadcast_changes(
      topic_name   => 'vehicle_pulse:' || p_vehicle_id::text,
      event_name   => 'pulse',
      operation    => 'UPDATE', table_name => 'vehicle_pulse', table_schema => 'public',
      new          => to_jsonb((select vp from public.vehicle_pulse vp where vp.vehicle_id = p_vehicle_id)),
      old          => null, level => 'public');
  end if;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER on vehicle_events (the v1 live source AND terminal source)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.tg_vehicle_events_pulse() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if NEW.vehicle_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW is not distinct from OLD then return NEW; end if;
  -- only re-arbitrate on arbitration-relevant change
  if TG_OP = 'INSERT' or (
       NEW.current_price   is distinct from OLD.current_price or
       NEW.final_price     is distinct from OLD.final_price   or
       NEW.event_status    is distinct from OLD.event_status  or
       NEW.ended_at        is distinct from OLD.ended_at       or
       NEW.sold_at         is distinct from OLD.sold_at        or
       NEW.bid_count       is distinct from OLD.bid_count      or
       NEW.buy_now_price   is distinct from OLD.buy_now_price  or
       (NEW.metadata->>'reserve_status') is distinct from (OLD.metadata->>'reserve_status')) then
    perform public.arbitrate_vehicle_pulse(NEW.vehicle_id);
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_vehicle_events_pulse on public.vehicle_events;
create trigger trg_vehicle_events_pulse
  after insert or update on public.vehicle_events
  for each row execute function public.tg_vehicle_events_pulse();

-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER on bid_events — the live-bid spine. SHIPS DARK in v1. [FIX-1/9]
-- Routes bid → monitored_auctions.vehicle_id. That column is 100% NULL in prod,
-- so this NEVER silently no-ops: an unresolvable bid logs a routing gap.
-- Server clock authority for last_bid_at; ends_at never rewinds. [FIX-2]
-- Chime de-dup keyed off NEW bid identity + bid_count increase, not timestamp. [FIX-6]
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.tg_bid_events_pulse() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_vid uuid; v_ma public.monitored_auctions%rowtype;
begin
  select * into v_ma from public.monitored_auctions where id = NEW.monitored_auction_id;
  v_vid := v_ma.vehicle_id;
  if v_vid is null then
    insert into public.pulse_routing_gaps(kind, monitored_auction_id, bid_event_id, detail)
    values ('bid_events_null_vehicle', NEW.monitored_auction_id, NEW.id,
            jsonb_build_object('external_auction_url', v_ma.external_auction_url,
                               'bid_amount_cents', NEW.bid_amount_cents));
    return NEW;   -- intake gap surfaced, not swallowed
  end if;

  perform pg_advisory_xact_lock(hashtext('vehicle_pulse:' || v_vid::text));

  update public.vehicle_pulse vp set
    -- monotonic, server-clock advance; refuse to go backward [FIX-2/3]
    live_bid     = greatest(coalesce(vp.live_bid,0), NEW.bid_amount_cents::numeric/100),
    bid_count    = greatest(vp.bid_count, coalesce(v_ma.bid_count,0)),
    -- chime gate: advance last_bid_at ONLY on a genuinely higher bid (new bid identity) [FIX-6]
    last_bid_at  = case when NEW.bid_amount_cents::numeric/100 > coalesce(vp.live_bid,0)
                        then greatest(coalesce(vp.last_bid_at, to_timestamp(0)), now())
                        else vp.last_bid_at end,
    source_bid_id= case when NEW.bid_amount_cents::numeric/100 > coalesce(vp.live_bid,0)
                        then NEW.id else vp.source_bid_id end,
    -- soft-close extension may only push the end out, never earlier [FIX-2/4]
    ends_at      = greatest(coalesce(vp.ends_at, NEW.new_end_time), coalesce(NEW.new_end_time, vp.ends_at)),
    updated_at   = now()
  where vp.vehicle_id = v_vid;

  perform public.arbitrate_vehicle_pulse(v_vid);   -- re-fold liveness/headline off the new state
  return NEW;
end; $$;

drop trigger if exists trg_bid_events_pulse on public.bid_events;
create trigger trg_bid_events_pulse
  after insert on public.bid_events
  for each row execute function public.tg_bid_events_pulse();

-- ─────────────────────────────────────────────────────────────────────────
-- pg_cron liveness/fade sweep — liveness + fade ONLY, never touches bid columns. [FIX-6]
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.sweep_vehicle_pulse() returns void
  language plpgsql security definer set search_path = public as $$
declare v record;
begin
  for v in
    select vehicle_id from public.vehicle_pulse
     where is_live = true
        or (ended_at is not null and ended_at > now() - interval '2 days')
  loop
    perform public.arbitrate_vehicle_pulse(v.vehicle_id);   -- re-folds liveness; bid cols are monotonic-protected
    -- advance fade independently of the fold
    update public.vehicle_pulse vp set fade_stage =
      case when vp.is_live then 'none'
           when vp.ended_at > now() - interval '2 days' then 'calming'
           else 'receded' end
     where vp.vehicle_id = v.vehicle_id and vp.fade_stage is distinct from
      (case when vp.is_live then 'none'
            when vp.ended_at > now() - interval '2 days' then 'calming'
            else 'receded' end);
  end loop;
end; $$;

select cron.schedule('pulse-liveness-sweep', '* * * * *', $$select public.sweep_vehicle_pulse();$$);

-- ─────────────────────────────────────────────────────────────────────────
-- RPC for initial hydrate (iOS loadPulse / web). RLS-checked target.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.get_vehicle_pulse(p_vehicle_id uuid)
  returns public.vehicle_pulse language sql stable security invoker as $$
  select * from public.vehicle_pulse where vehicle_id = p_vehicle_id;   -- RLS below gates visibility
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — MIRROR the vehicles contract, NOT USING(true). [FIX-RLS-LEAK]
-- ⚠️ Verify the vehicles column shape (is_public/owner_id/user_id) before applying — see preconditions.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.vehicle_pulse enable row level security;

drop policy if exists vehicle_pulse_read on public.vehicle_pulse;
create policy vehicle_pulse_read on public.vehicle_pulse for select
  using (exists (
    select 1 from public.vehicles v
     where v.id = vehicle_pulse.vehicle_id
       and (v.is_public = true
            or v.user_id = auth.uid()
            or v.owner_id = auth.uid())));
-- no INSERT/UPDATE policy: writes only via SECURITY DEFINER arbiter.

-- Realtime Authorization: broadcast receive gated by the SAME per-vehicle predicate. [FIX-RLS-LEAK]
alter table realtime.messages enable row level security;
drop policy if exists "read vehicle_pulse broadcasts" on realtime.messages;
create policy "read vehicle_pulse broadcasts" on realtime.messages for select
  to authenticated, anon
  using (
    realtime.topic() like 'vehicle_pulse:%'
    and exists (
      select 1 from public.vehicles v
       where v.id = (split_part(realtime.topic(), ':', 2))::uuid
         and (v.is_public = true or v.user_id = auth.uid() or v.owner_id = auth.uid())));

commit;
