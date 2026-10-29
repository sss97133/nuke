-- WHY (2026-10-24): 119 suspect-platform events stored as sold cite a BaT page whose own banner says "Bid to"
-- (no sale). event_status alone could not say "auction ended at a high bid without a sale", so high bids landed
-- as sale prices. This adds a typed, cited sale_outcome and a separate high_bid on vehicle_events. Comps use
-- only sold outcomes for the sale-price basis; high bids are exposed separately and labelled.
-- Cited values are never overwritten: a page outcome that contradicts a stored 'sold' adds an observation
-- (rule bat_sale_outcome_v1) and flags final_price in source_suspect; event_status/final_price stay as stored.

do $$ begin
  create type public.sale_outcome_t as enum ('sold','bid_to','no_sale','withdrawn','unknown');
exception when duplicate_object then null; end $$;

alter table public.vehicle_events
  add column if not exists sale_outcome public.sale_outcome_t,
  add column if not exists sale_outcome_source_url text,
  add column if not exists sale_outcome_evidence text,
  add column if not exists sale_outcome_run_id text,
  add column if not exists sale_outcome_observed_at timestamptz,
  add column if not exists high_bid numeric;

alter table public.vehicle_events drop constraint if exists vehicle_events_sale_outcome_cited;
alter table public.vehicle_events add constraint vehicle_events_sale_outcome_cited
  check (sale_outcome is null or sale_outcome = 'unknown' or (sale_outcome_source_url is not null and sale_outcome_evidence is not null)) not valid;
alter table public.vehicle_events drop constraint if exists vehicle_events_high_bid_positive;
alter table public.vehicle_events add constraint vehicle_events_high_bid_positive check (high_bid is null or high_bid > 0) not valid;

create index if not exists vehicle_events_high_bid_idx on public.vehicle_events (id) where high_bid is not null;

-- comps predicate: sold outcomes only (null = legacy, untyped; still subject to the other filters)
create or replace function public.vehicle_event_comp_excluded(p_event_id uuid, p_suspect text[], p_outcome public.sale_outcome_t)
returns boolean language sql stable as $$
  select coalesce(p_outcome is not null and p_outcome <> 'sold', false)
      or public.vehicle_event_comp_excluded(p_event_id, p_suspect)
$$;

create or replace view public.sale_price_basis_v1_comps as
 SELECT s.event_id, s.platform, s.sale_date, b.basis, b.price_usd, s.confidence, s.fee_rule
   FROM sale_price_basis_v1 s
     CROSS JOIN LATERAL ( VALUES ('gross'::text,s.gross_usd), ('hammer'::text,s.hammer_usd), ('net_to_owner'::text,s.net_to_owner_usd)) b(basis, price_usd)
  WHERE b.price_usd IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM vehicle_events e JOIN vehicles v ON v.id = e.vehicle_id
                    WHERE e.id = s.event_id
                      AND (v.listing_kind = 'non_vehicle_item'
                           OR public.vehicle_event_comp_excluded(e.id, e.source_suspect, e.sale_outcome)
                           OR public.record_is_quarantined('vehicles', v.id)));

create or replace view public.vehicle_event_comp_exclusions as
  select e.id as event_id, e.vehicle_id, 'suspect_platform_unresolved'::text as reason
    from public.vehicle_events e
   where 'source_platform' = any(e.source_suspect) and public.vehicle_event_comp_excluded(e.id, e.source_suspect)
  union all
  select e.id, e.vehicle_id, 'quarantined'::text
    from public.record_quarantine q join public.vehicle_events e on e.id = q.row_id
   where q.tbl = 'vehicle_events' and q.released_at is null
  union all
  select e.id, e.vehicle_id, 'sale_outcome_'||e.sale_outcome::text
    from public.vehicle_events e
   where e.sale_outcome is not null and e.sale_outcome not in ('sold','unknown');

-- high bids: a separate, labelled signal (never a sale price)
create or replace view public.vehicle_event_high_bids with (security_invoker = true) as
  select e.id as event_id, e.vehicle_id, e.source_platform, e.source_url, e.high_bid,
         coalesce(e.ended_at, e.sold_at) as ended_at, e.sale_outcome, e.sale_outcome_source_url,
         'high_bid_not_sale'::text as signal_label
    from public.vehicle_events e
   where e.high_bid is not null and e.sale_outcome in ('bid_to','no_sale','withdrawn');

create or replace function public.get_high_bid_signals(p_make text, p_model text default null, p_year int default null,
                                                       p_year_range int default 5, p_limit int default 20)
returns table(event_id uuid, vehicle_id uuid, yr int, mk text, mdl text, high_bid numeric, ended_at timestamptz,
              platform text, listing_url text, outcome text, signal_label text)
language sql stable security definer set statement_timeout to '10s' as $$
  with h as materialized (
    select e.id as event_id, e.vehicle_id, e.high_bid, coalesce(e.ended_at, e.sold_at) as ended_at, e.source_platform,
           e.source_url, e.sale_outcome, 'high_bid_not_sale'::text as signal_label
      from public.vehicle_events e
     where e.high_bid is not null and e.sale_outcome in ('bid_to','no_sale','withdrawn'))
  select h.event_id, v.id, v.year, v.make, v.model, h.high_bid, h.ended_at, h.source_platform, h.source_url,
         h.sale_outcome::text, h.signal_label
    from h join public.vehicles v on v.id = h.vehicle_id
   where lower(v.make) = lower(p_make) and v.deleted_at is null
     and not public.record_is_quarantined('vehicles', v.id)
     and (p_model is null or lower(v.model) like '%'||lower(p_model)||'%')
     and (p_year is null or v.year between p_year - least(greatest(coalesce(p_year_range,5),0),50) and p_year + least(greatest(coalesce(p_year_range,5),0),50))
   order by h.ended_at desc nulls last
   limit least(greatest(coalesce(p_limit,20),1),200)
$$;

create table if not exists public.bak_sale_outcome_v1 (
  event_id uuid not null, run_id text not null,
  prior_source_suspect text[], prior_source_suspect_at timestamptz, prior_sale_outcome public.sale_outcome_t, prior_sale_outcome_source_url text,
  prior_sale_outcome_evidence text, prior_sale_outcome_run_id text, prior_sale_outcome_observed_at timestamptz,
  prior_high_bid numeric, backed_up_at timestamptz not null default now(),
  primary key (event_id, run_id)
);
alter table public.bak_sale_outcome_v1 enable row level security;

-- p_pages: [{id, url, kind: sold|bid_to|withdrawn, amount, date, quote}] read from each event's own source_url.
-- Fills only empty outcome/high_bid fields; a stored 'sold' contradicted by the page is flagged, not rewritten.
create or replace function public.apply_sale_outcome_from_pages_v1(p_run text, p_pages jsonb, p_dry boolean default true)
returns jsonb language plpgsql as $$
declare n_typed int; n_conf int; n_obs int; n_flag int; n_prior int;
begin
  drop table if exists _so;
  create temp table _so as
  select e.id, e.event_status, e.final_price, e.source_suspect, e.sale_outcome cur_outcome,
         (p->>'kind')::public.sale_outcome_t kind, nullif(p->>'amount','')::numeric amount, nullif(p->>'date','')::date pdate,
         p->>'url' url, p->>'quote' quote
    from jsonb_array_elements(p_pages) p join public.vehicle_events e on e.id = (p->>'id')::uuid
    join public.vehicles v on v.id = e.vehicle_id   -- events whose vehicle row is gone are left alone
   where e.source_url = p->>'url' and e.source_url like '%bringatrailer.com%' and p->>'kind' in ('sold','bid_to','withdrawn');
  select count(*) filter (where cur_outcome is not null and cur_outcome <> kind) into n_prior from _so;
  if p_dry then
    return jsonb_build_object('dry', true, 'rows', (select count(*) from _so),
      'by_kind', (select jsonb_object_agg(k, n) from (select kind::text k, count(*) n from _so group by 1) x),
      'conflict_with_sold', (select count(*) from _so where event_status = 'sold' and kind <> 'sold'),
      'sold_price_differs', (select count(*) from _so where kind = 'sold' and amount is distinct from final_price),
      'existing_outcome_differs', n_prior);
  end if;
  insert into public.bak_sale_outcome_v1 (event_id, run_id, prior_source_suspect, prior_source_suspect_at, prior_sale_outcome, prior_sale_outcome_source_url,
         prior_sale_outcome_evidence, prior_sale_outcome_run_id, prior_sale_outcome_observed_at, prior_high_bid)
  select e.id, p_run, e.source_suspect, e.source_suspect_at, e.sale_outcome, e.sale_outcome_source_url, e.sale_outcome_evidence,
         e.sale_outcome_run_id, e.sale_outcome_observed_at, e.high_bid
    from public.vehicle_events e join _so s on s.id = e.id
  on conflict do nothing;
  -- type the outcome where none is recorded yet (never replaces an existing cited outcome)
  -- one statement per row (a second update of a row written in this transaction re-runs its FK check)
  update public.vehicle_events e set
      sale_outcome = coalesce(e.sale_outcome, s.kind),
      sale_outcome_source_url = case when e.sale_outcome is null then s.url else e.sale_outcome_source_url end,
      sale_outcome_evidence = case when e.sale_outcome is null then 'BaT page banner: '||coalesce(s.quote, s.kind::text)||coalesce(' on '||s.pdate, '') else e.sale_outcome_evidence end,
      sale_outcome_run_id = case when e.sale_outcome is null then p_run else e.sale_outcome_run_id end,
      sale_outcome_observed_at = case when e.sale_outcome is null then now() else e.sale_outcome_observed_at end,
      high_bid = case when e.sale_outcome is null and s.kind in ('bid_to','withdrawn') and e.high_bid is null then s.amount else e.high_bid end,
      source_suspect = case when s.kind <> 'sold' and e.event_status = 'sold' and not coalesce('final_price' = any(e.source_suspect), false)
                            then array_append(coalesce(e.source_suspect, '{}'), 'final_price') else e.source_suspect end,
      source_suspect_at = case when s.kind <> 'sold' and e.event_status = 'sold' then coalesce(e.source_suspect_at, now()) else e.source_suspect_at end
    from _so s where s.id = e.id
     and (e.sale_outcome is null or (s.kind <> 'sold' and e.event_status = 'sold' and not coalesce('final_price' = any(e.source_suspect), false)));
  select count(*) into n_typed from public.vehicle_events where sale_outcome_run_id = p_run;
  -- stored sold vs page no-sale (or a prior outcome that disagrees): observation + flag, nothing overwritten
  insert into public.price_basis_observation (tbl, event_id, kind, stored_price, observed_status, observed_price, observed_on, source_url, evidence, rule, run_id)
  select 'vehicle_events', s.id, 'observed_page_status', coalesce(s.final_price, 0), 'unsold', s.amount, s.pdate, s.url,
         'BaT page banner says '||coalesce(s.quote, s.kind::text)||' (no sale); stored event_status '||coalesce(s.event_status,'null')
           ||', final_price '||coalesce(s.final_price::text,'null')||' kept; final_price flagged suspect',
         'bat_sale_outcome_v1', p_run
    from _so s where s.kind <> 'sold' and (s.event_status = 'sold' or s.cur_outcome = 'sold')
  on conflict (tbl, event_id, rule) do nothing;
  get diagnostics n_obs = row_count;
  select count(*) into n_flag from _so s join public.vehicle_events e on e.id = s.id where s.kind <> 'sold' and 'final_price' = any(e.source_suspect);
  select count(*) into n_conf from _so where event_status = 'sold' and kind <> 'sold';
  return jsonb_build_object('dry', false, 'rows', (select count(*) from _so), 'typed', n_typed, 'conflicts', n_conf,
                            'observations', n_obs, 'flagged_final_price', n_flag, 'existing_outcome_differs', n_prior);
end $$;

create or replace function public.revert_sale_outcome_v1(p_run text)
returns jsonb language plpgsql as $$
declare n int; m int;
begin
  update public.vehicle_events e set
      source_suspect = b.prior_source_suspect, source_suspect_at = b.prior_source_suspect_at, sale_outcome = b.prior_sale_outcome,
      sale_outcome_source_url = b.prior_sale_outcome_source_url, sale_outcome_evidence = b.prior_sale_outcome_evidence,
      sale_outcome_run_id = b.prior_sale_outcome_run_id, sale_outcome_observed_at = b.prior_sale_outcome_observed_at,
      high_bid = b.prior_high_bid
    from public.bak_sale_outcome_v1 b where b.event_id = e.id and b.run_id = p_run;
  get diagnostics n = row_count;
  update public.price_basis_observation set superseded_at = now()
   where run_id = p_run and rule = 'bat_sale_outcome_v1' and superseded_at is null;
  get diagnostics m = row_count;
  return jsonb_build_object('restored', n, 'observations_superseded', m);
end $$;

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
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
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))) v
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
      COALESCE(public.event_resolved_platform(ve.id, ve.source_suspect), ve.source_platform) AS source,
      COALESCE(ve.sold_at, ve.ended_at) AS auction_end_date,
      'vehicle_event'::text AS src_type,
      NULL::text AS cur, COALESCE(ve.sold_at, ve.ended_at)::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))) v
    JOIN vehicle_events ve ON ve.vehicle_id = v.id
      AND NOT coalesce(ve.sale_outcome is not null and ve.sale_outcome <> 'sold', false)
      AND (ve.source_suspect is null OR NOT public.vehicle_event_comp_excluded(ve.id, ve.source_suspect))
      AND ve.id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicle_events' and q.released_at is null))
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ve.event_status = 'sold'
      AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted'
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
