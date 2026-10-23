-- Price basis as first-class data: hammer, buyer premium, gross (buyer-paid) and net-to-owner are separate typed
-- columns on vehicle_events and auction_events, each with its own source and confidence, derived from a cited,
-- dated platform fee schedule instead of hard-coded rates. Additive: the legacy price columns
-- (vehicle_events.final_price, auction_events.winning_bid) are never written here.
-- Revert: supabase/rollbacks/20261024070000_price_basis_first_class_down.sql

do $$ begin
  create type public.price_basis_t as enum ('hammer','gross_incl_premium','net_to_owner','unknown');
exception when duplicate_object then null; end $$;

-- ─── Fee schedule ────────────────────────────────────────────────────────────
create table if not exists public.platform_fee_schedule (
  id bigserial primary key,
  platform text not null,                       -- vehicle_events.source_platform / auction_events.source slug
  role text not null check (role in ('buyer','seller')),
  fee_kind text not null check (fee_kind in ('percent','flat')),
  rate numeric check (rate is null or (rate >= 0 and rate < 1)),
  min_amount numeric,
  cap_amount numeric,
  flat_amount numeric,
  currency text not null default 'USD',
  published_price_basis public.price_basis_t,   -- buyer rows: what the platform's published result price is
  valid_from timestamptz,                       -- null = since the platform began
  valid_to timestamptz,                         -- exclusive; null = current
  source_url text not null,
  notes text,
  check ((fee_kind = 'percent' and rate is not null) or (fee_kind = 'flat' and flat_amount is not null)),
  check (role = 'seller' or published_price_basis in ('hammer','gross_incl_premium'))
);
create index if not exists platform_fee_schedule_lookup on public.platform_fee_schedule(platform, role, valid_from);
alter table public.platform_fee_schedule enable row level security;
drop policy if exists platform_fee_schedule_read on public.platform_fee_schedule;
create policy platform_fee_schedule_read on public.platform_fee_schedule for select using (true);

insert into public.platform_fee_schedule (platform, role, fee_kind, rate, min_amount, cap_amount, flat_amount, published_price_basis, valid_from, valid_to, source_url, notes)
select * from (values
  ('bat','buyer','percent',0.05,250,5000,null::numeric,'hammer'::public.price_basis_t,null::timestamptz,'2024-01-30 06:00+00'::timestamptz,'https://bringatrailer.com/2024/01/26/bat-site-update-5-buyers-fee-cap-is-7500-as-of-1-29-24/','5% buyer fee, $250 min, $5,000 cap since 2014'),
  ('bat','buyer','percent',0.05,250,7500,null,'hammer',  '2024-01-30 06:00+00',null,'https://bringatrailer.com/policies/','cap raised to $7,500 after auctions closed 2024-01-29 (PT); 10% categories not modelled'),
  ('bat','seller','flat',null,null,null,99,null,null,null,'https://bringatrailer.com/how-bat-works/','$99 listing fee, no seller commission (current schedule; history not verified)'),
  ('cars_and_bids','buyer','percent',0.045,225,4500,null,'hammer',null,'2025-02-26 01:00+00','https://www.theautopian.com/cars-bids-raises-its-buyer-fees-post-layoffs-to-match-bring-a-trailer/','4.5% / $225 min / $4,500 cap until 2025-02-25 5pm PT'),
  ('cars_and_bids','buyer','percent',0.05,250,7500,null,'hammer','2025-02-26 01:00+00',null,'https://carsandbids.com/faq/','5% / $250 min / $7,500 cap'),
  ('pcarmarket','buyer','percent',0.05,500,5000,null,'hammer',null,'2025-06-28 07:00+00','https://www.pcarmarket.com/faq','5% / $500 min / $5,000 cap until auctions closed 2025-06-27'),
  ('pcarmarket','buyer','percent',0.05,500,7500,null,'hammer','2025-06-28 07:00+00',null,'https://www.pcarmarket.com/buyer-agreement','5% / $500 min / $7,500 cap'),
  ('pcarmarket','seller','flat',null,null,null,99,null,null,null,'https://www.pcarmarket.com/faq','$99 vehicle listing fee (current schedule; race cars also pay 5% seller fee, not modelled)'),
  ('mecum','buyer','percent',0.10,null,null,null,'gross_incl_premium',null,null,'https://www.mecum.com/','published results include the 10% buyer premium; hammer = price / 1.10 (Skylar directive 2026-10-23)'),
  ('barrettjackson','buyer','percent',0.10,null,null,null,'gross_incl_premium',null,null,'https://www.barrett-jackson.com/','published results include the 10% buyer premium; hammer = price / 1.10 (Skylar directive 2026-10-23)'),
  ('barrett-jackson','buyer','percent',0.10,null,null,null,'gross_incl_premium',null,null,'https://www.barrett-jackson.com/','alias slug of barrettjackson'),
  ('broad_arrow','buyer','percent',0.12,null,null,null,'gross_incl_premium',null,null,'https://www.broadarrowauctions.com/','published results include the 12% buyer premium; hammer = price / 1.12 (Skylar directive 2026-10-23)')
) v(platform, role, fee_kind, rate, min_amount, cap_amount, flat_amount, published_price_basis, valid_from, valid_to, source_url, notes)
where not exists (select 1 from public.platform_fee_schedule);

-- ─── Typed columns (nullable, no default: metadata-only on big tables) ───────
do $$ declare t text; begin
  foreach t in array array['vehicle_events','auction_events'] loop
    execute format($f$
      alter table public.%1$I
        add column if not exists price_basis public.price_basis_t,
        add column if not exists hammer_price numeric,
        add column if not exists hammer_price_source text,
        add column if not exists hammer_price_confidence text,
        add column if not exists buyer_premium_amount numeric,
        add column if not exists buyer_premium_rate numeric,
        add column if not exists buyer_premium_source text,
        add column if not exists buyer_premium_confidence text,
        add column if not exists gross_price numeric,
        add column if not exists gross_price_source text,
        add column if not exists gross_price_confidence text,
        add column if not exists seller_fee_amount numeric,
        add column if not exists seller_fee_source text,
        add column if not exists seller_fee_confidence text,
        add column if not exists net_to_owner numeric,
        add column if not exists net_to_owner_source text,
        add column if not exists net_to_owner_confidence text,
        add column if not exists price_basis_run_id text
    $f$, t);
    execute format($f$comment on column public.%1$I.price_basis is 'Basis of the legacy price column on this row (hammer | gross_incl_premium | net_to_owner | unknown). NULL = not assessed.'$f$, t);
    execute format($f$comment on column public.%1$I.gross_price is 'Buyer-paid price (hammer + buyer premium). Never mix with hammer_price or net_to_owner in one comp set.'$f$, t);
    execute format($f$comment on column public.%1$I.net_to_owner is 'Hammer minus seller fees, only where the seller fee is known; NULL otherwise.'$f$, t);
  end loop;
end $$;

-- ─── Derivation (calculated from the schedule, cited by schedule id) ─────────
create or replace function public.derive_price_components(p_platform text, p_price numeric, p_at timestamptz)
returns table (price_basis public.price_basis_t, hammer_price numeric, hammer_price_source text, hammer_price_confidence text,
  buyer_premium_amount numeric, buyer_premium_rate numeric, buyer_premium_source text, buyer_premium_confidence text,
  gross_price numeric, gross_price_source text, gross_price_confidence text,
  seller_fee_amount numeric, seller_fee_source text, seller_fee_confidence text,
  net_to_owner numeric, net_to_owner_source text, net_to_owner_confidence text)
language plpgsql stable set search_path = public as $$
declare b platform_fee_schedule; s platform_fee_schedule; v_conf text; v_bsrc text; v_ssrc text;
begin
  if p_price is null or p_price <= 0 then return; end if;
  select * into b from platform_fee_schedule f where f.platform = p_platform and f.role = 'buyer'
    and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
    order by f.valid_from desc nulls last limit 1;
  if not found then
    price_basis := 'unknown'; return next; return;
  end if;
  v_conf := case when p_at is null then 'schedule_current_sale_undated' else 'schedule_dated' end;
  v_bsrc := 'platform_fee_schedule:' || b.id || ' ' || b.source_url;
  price_basis := b.published_price_basis;
  buyer_premium_rate := b.rate; buyer_premium_source := v_bsrc;
  if b.published_price_basis = 'hammer' then
    hammer_price := p_price; hammer_price_source := 'legacy price column (platform publishes hammer)'; hammer_price_confidence := 'reported';
    buyer_premium_amount := round(p_price * b.rate);
    if b.min_amount is not null then buyer_premium_amount := greatest(buyer_premium_amount, b.min_amount); end if;
    if b.cap_amount is not null then buyer_premium_amount := least(buyer_premium_amount, b.cap_amount); end if;
    buyer_premium_confidence := v_conf;
    gross_price := hammer_price + buyer_premium_amount; gross_price_source := v_bsrc; gross_price_confidence := v_conf;
  else
    gross_price := p_price; gross_price_source := 'legacy price column (platform publishes premium-inclusive)'; gross_price_confidence := 'reported';
    hammer_price := round(p_price / (1 + b.rate)); hammer_price_source := v_bsrc;
    hammer_price_confidence := case when b.cap_amount is null and b.min_amount is null then 'derived_from_gross' else 'derived_from_gross_cap_ignored' end;
    buyer_premium_amount := p_price - hammer_price; buyer_premium_confidence := hammer_price_confidence;
  end if;
  select * into s from platform_fee_schedule f where f.platform = p_platform and f.role = 'seller'
    and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
    order by f.valid_from desc nulls last limit 1;
  if found then
    v_ssrc := 'platform_fee_schedule:' || s.id || ' ' || s.source_url;
    seller_fee_amount := case when s.fee_kind = 'flat' then s.flat_amount
      else least(greatest(round(hammer_price * s.rate), coalesce(s.min_amount, 0)), coalesce(s.cap_amount, 'Infinity'::numeric)) end;
    seller_fee_source := v_ssrc; seller_fee_confidence := 'schedule_current_not_dated';
    net_to_owner := hammer_price - seller_fee_amount; net_to_owner_source := v_ssrc;
    net_to_owner_confidence := 'schedule_current_not_dated';
  end if;
  return next;
end $$;

-- ─── Backfill: one call = one batch of at most 500 rows, stamped with a run id ─
create table if not exists public.price_basis_backfill_queue (
  tbl text not null check (tbl in ('vehicle_events','auction_events')),
  id uuid not null,
  run_id text not null,
  done_at timestamptz,
  primary key (tbl, id)
);
create index if not exists price_basis_backfill_queue_todo on public.price_basis_backfill_queue(tbl) where done_at is null;
alter table public.price_basis_backfill_queue enable row level security;

create or replace function public.backfill_price_basis_batch(p_tbl text, p_run_id text, p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'backfill_price_basis_batch: batch size must be 1..500'; end if;
  if p_run_id is null then raise exception 'backfill_price_basis_batch: run_id required'; end if;
  if p_tbl = 'vehicle_events' then
    with q as (select id from price_basis_backfill_queue where tbl = p_tbl and done_at is null limit p_limit for update skip locked),
    u as (
      update vehicle_events e set (price_basis, hammer_price, hammer_price_source, hammer_price_confidence, buyer_premium_amount,
          buyer_premium_rate, buyer_premium_source, buyer_premium_confidence, gross_price, gross_price_source, gross_price_confidence,
          seller_fee_amount, seller_fee_source, seller_fee_confidence, net_to_owner, net_to_owner_source, net_to_owner_confidence, price_basis_run_id)
        = (select d.*, p_run_id from derive_price_components(e.source_platform, e.final_price, coalesce(e.sold_at, e.ended_at)) d)
      from q where e.id = q.id and e.price_basis is null
      returning e.id)
    update price_basis_backfill_queue b set done_at = now() from q where b.tbl = p_tbl and b.id = q.id;
  elsif p_tbl = 'auction_events' then
    with q as (select id from price_basis_backfill_queue where tbl = p_tbl and done_at is null limit p_limit for update skip locked),
    u as (
      update auction_events e set (price_basis, hammer_price, hammer_price_source, hammer_price_confidence, buyer_premium_amount,
          buyer_premium_rate, buyer_premium_source, buyer_premium_confidence, gross_price, gross_price_source, gross_price_confidence,
          seller_fee_amount, seller_fee_source, seller_fee_confidence, net_to_owner, net_to_owner_source, net_to_owner_confidence, price_basis_run_id)
        = (select d.*, p_run_id from derive_price_components(e.source, e.winning_bid, e.auction_end_date) d)
      from q where e.id = q.id and e.price_basis is null
      returning e.id)
    update price_basis_backfill_queue b set done_at = now() from q where b.tbl = p_tbl and b.id = q.id;
  else
    raise exception 'backfill_price_basis_batch: unknown table %', p_tbl;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.backfill_price_basis_batch(text, text, int) from public, anon, authenticated;

-- ─── Comps and graphs take an explicit basis and never mix ───────────────────
-- New overloads with a required leading p_basis. Each reads exactly one typed column (hammer_price | gross_price |
-- net_to_owner); rows without that column are excluded rather than filled from another basis. The legacy
-- signatures are left as they are (callers owned elsewhere migrate to the overloads) and marked deprecated.
CREATE OR REPLACE FUNCTION public.get_comps_scored(p_basis public.price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold'
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ve.source_url,
      ve.source_platform AS source,
      COALESCE(ve.sold_at, ve.ended_at) AS auction_end_date,
      'vehicle_event'::text AS src_type,
      NULL::text AS cur, COALESCE(ve.sold_at, ve.ended_at)::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    JOIN vehicle_events ve ON ve.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ve.event_status = 'sold'
      AND (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) > 0
      AND v.deleted_at IS NULL
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.outcome = 'sold' AND (CASE p_basis WHEN 'hammer' THEN ae2.hammer_price WHEN 'gross_incl_premium' THEN ae2.gross_price WHEN 'net_to_owner' THEN ae2.net_to_owner END) > 0
      )
  ),
  raw_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  -- native amount x sale-date USD rate (fx_usd_rate). NULL currency = legacy row, read as reported.
  conv_cands AS (
    SELECT r.*, r.price AS price_native, fx.rate AS fx_rate, fx.rate_date AS fx_rate_date,
      CASE WHEN r.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE fx.source END AS fx_source,
      CASE WHEN r.cur IS NULL THEN r.price::numeric ELSE round(r.price * fx.rate, 2) END AS price_usd
    FROM raw_cands r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  ),
  all_cands AS (
    SELECT * FROM conv_cands c
    WHERE (c.cur IS NULL OR c.fx_rate IS NOT NULL)   -- foreign amount with no rate: excluded, never read as USD
      AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
      AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price_usd AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.price_native, c.cur, c.fx_rate, c.fx_rate_date, c.fx_source,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50), 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN length(public.model_spelling_key(p_model)) >= 2 AND public.model_spelling_key(c.model) = public.model_spelling_key(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      -- Engine cylinder score
      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      -- Engine config score
      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      -- Transmission score
      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      -- Drivetrain score
      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      -- Mileage score
      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      -- Body style score
      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      -- Trim score
      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1)
    ) AS score_breakdown,
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, p_basis::text
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_combined(p_basis public.price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_year       integer;
  v_year_range integer;
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  -- Compute year and range from min/max
  IF p_year_min IS NOT NULL AND p_year_max IS NOT NULL THEN
    v_year := (p_year_min + p_year_max) / 2;
    v_year_range := GREATEST((p_year_max - p_year_min) / 2, 1);
  ELSIF p_year_min IS NOT NULL THEN
    v_year := p_year_min + 5;
    v_year_range := 5;
  ELSIF p_year_max IS NOT NULL THEN
    v_year := p_year_max - 5;
    v_year_range := 5;
  END IF;

  -- Try to resolve vehicle attributes if we have an exclude_vehicle_id (i.e. the subject)
  IF p_exclude_vehicle_id IS NOT NULL THEN
    SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
    INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
    FROM vehicles v WHERE v.id = p_exclude_vehicle_id;
  END IF;

  RETURN QUERY
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    s.sale_price_native, s.currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, s.price_basis
  FROM get_comps_scored(
    p_basis        := p_basis,
    p_make         := p_make,
    p_model        := p_model,
    p_year         := v_year,
    p_year_range   := COALESCE(v_year_range, 5),
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_min_price    := p_min_price,
    p_max_price    := p_max_price,
    p_exclude_vehicle_id := p_exclude_vehicle_id,
    p_limit        := p_limit
  ) s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_auction_comps(p_basis public.price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold'
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END,
         p_basis::text
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_model_price_history(p_basis public.price_basis_t, p_make text, p_model text, p_limit integer DEFAULT 30, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', v.sale_date,
        'price', v.sale_price,
        'vehicle_id', v.id,
        'year', v.year,
        'model', v.model,
        'platform', v.platform,
        'price_basis', p_basis::text
      ) ORDER BY v.sale_date ASC
    ),
    '[]'::jsonb
  ) INTO result
  FROM (
    SELECT vh.id, vh.year, vh.model, COALESCE(ve.sold_at, ve.ended_at)::date AS sale_date,
           (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) AS sale_price, ve.source_platform AS platform
    FROM vehicles vh
    JOIN vehicle_events ve ON ve.vehicle_id = vh.id
    WHERE vh.is_public
      AND lower(vh.make) = lower(p_make)
      AND (lower(vh.model) = lower(p_model) OR lower(vh.normalized_model) = lower(p_model))
      AND (p_year_min IS NULL OR vh.year >= p_year_min)
      AND (p_year_max IS NULL OR vh.year <= p_year_max)
      AND vh.deleted_at IS NULL
      AND vh.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND ve.event_status = 'sold'
      AND (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) > 0
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL
    ORDER BY COALESCE(ve.sold_at, ve.ended_at) DESC
    LIMIT least(greatest(coalesce(p_limit, 30), 1), 500)
  ) v;

  RETURN result;
END;
$function$;

comment on function public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer) is 'DEPRECATED: mixes price bases. Use get_comps_scored(p_basis, ...).';
comment on function public.get_comps_combined(text,text,integer,integer,numeric,numeric,uuid,integer) is 'DEPRECATED: mixes price bases. Use get_comps_combined(p_basis, ...).';
comment on function public.get_auction_comps(text,text,integer,integer,numeric,numeric,uuid,integer) is 'DEPRECATED: mixes price bases. Use get_auction_comps(p_basis, ...).';
comment on function public.get_model_price_history(text,text,integer,integer,integer) is 'DEPRECATED: mixes price bases. Use get_model_price_history(p_basis, ...).';
grant execute on function public.get_comps_scored(public.price_basis_t,text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer) to anon, authenticated, service_role;
grant execute on function public.get_comps_combined(public.price_basis_t,text,text,integer,integer,numeric,numeric,uuid,integer) to anon, authenticated, service_role;
grant execute on function public.get_auction_comps(public.price_basis_t,text,text,integer,integer,numeric,numeric,uuid,integer) to anon, authenticated, service_role;
grant execute on function public.get_model_price_history(public.price_basis_t,text,text,integer,integer,integer) to anon, authenticated, service_role;
