-- WHY (2026-10-24): two classes of event must not feed comps or valuation.
-- (1) events whose source_platform disagrees with their cited URL host (source_suspect has 'source_platform',
--     set by flag_platform_host_mismatch_v1 / the platform-host trigger) stay out of comps until a cited page
--     resolves them. Resolution is a new price_basis_observation (rule platform_host_resolution_v1); the event
--     row and shadow_sale_prices are never edited.
-- (2) a reversible quarantine (record_quarantine) for rows that are not market data at all: the 14 events and
--     vehicles imported 2026-03-01 by an out-of-band url_scraper batch whose source was epsteingraph.com
--     document pages, then copied into vehicle_events by orphan-backfill-v1. Neither writer is in this repo;
--     no write_receipts exist before 2026-07-21. ingest_blocked_host + triggers block that host at insert.

create table if not exists public.record_quarantine (
  id bigserial primary key,
  tbl text not null check (tbl in ('vehicles','vehicle_events')),
  row_id uuid not null,
  reason text not null,
  run_id text not null,
  prior_is_public boolean,
  quarantined_at timestamptz not null default now(),
  released_at timestamptz,
  released_run text
);
create unique index if not exists record_quarantine_active_uq on public.record_quarantine (tbl, row_id) where released_at is null;
alter table public.record_quarantine enable row level security;

create or replace function public.record_is_quarantined(p_tbl text, p_id uuid)
returns boolean language sql stable as $$
  select exists (select 1 from public.record_quarantine q where q.tbl = p_tbl and q.row_id = p_id and q.released_at is null)
$$;

create index if not exists pbo_platform_resolution_idx on public.price_basis_observation (event_id)
  where rule = 'platform_host_resolution_v1' and superseded_at is null;

create or replace function public.vehicle_event_comp_excluded(p_event_id uuid, p_suspect text[])
returns boolean language sql stable as $$
  select (coalesce('source_platform' = any(p_suspect), false)
          and not exists (select 1 from public.price_basis_observation o
                          where o.event_id = p_event_id and o.tbl = 'vehicle_events'
                            and o.rule = 'platform_host_resolution_v1' and o.superseded_at is null
                            and o.observed_status = 'sold'))
      or public.record_is_quarantined('vehicle_events', p_event_id)
$$;

-- platform the cited page proved, for resolved suspect events (null otherwise); evidence starts 'platform=<key>;'
create or replace function public.event_resolved_platform(p_event_id uuid, p_suspect text[])
returns text language sql stable as $$
  select case when coalesce('source_platform' = any(p_suspect), false) then
    (select substring(o.evidence from '^platform=([a-z_]+);') from public.price_basis_observation o
      where o.event_id = p_event_id and o.tbl = 'vehicle_events' and o.rule = 'platform_host_resolution_v1'
        and o.superseded_at is null order by o.id desc limit 1) end
$$;

-- comps view: same filter (no change to sale_price_basis_v1 or shadow_sale_prices)
create or replace view public.sale_price_basis_v1_comps as
 SELECT s.event_id, s.platform, s.sale_date, b.basis, b.price_usd, s.confidence, s.fee_rule
   FROM sale_price_basis_v1 s
     CROSS JOIN LATERAL ( VALUES ('gross'::text,s.gross_usd), ('hammer'::text,s.hammer_usd), ('net_to_owner'::text,s.net_to_owner_usd)) b(basis, price_usd)
  WHERE b.price_usd IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM vehicle_events e JOIN vehicles v ON v.id = e.vehicle_id
                    WHERE e.id = s.event_id
                      AND (v.listing_kind = 'non_vehicle_item'
                           OR public.vehicle_event_comp_excluded(e.id, e.source_suspect)
                           OR public.record_is_quarantined('vehicles', v.id)));

-- per-vehicle exclusion list for TS valuation readers (advisor loadSaleTruthMap)
create or replace view public.vehicle_event_comp_exclusions as
  select e.id as event_id, e.vehicle_id, 'suspect_platform_unresolved'::text as reason
    from public.vehicle_events e
   where 'source_platform' = any(e.source_suspect) and public.vehicle_event_comp_excluded(e.id, e.source_suspect)
  union all
  select e.id, e.vehicle_id, 'quarantined'::text
    from public.record_quarantine q join public.vehicle_events e on e.id = q.row_id
   where q.tbl = 'vehicle_events' and q.released_at is null;

-- ingest block
create table if not exists public.ingest_blocked_host (
  host text primary key check (host = lower(host)),
  reason text not null,
  run_id text not null,
  added_at timestamptz not null default now()
);
alter table public.ingest_blocked_host enable row level security;
insert into public.ingest_blocked_host (host, reason, run_id)
values ('epsteingraph.com', 'not vehicle market data; personal-records source (quarantine 2026-10-24)', 'epsteingraph_quarantine_20261024')
on conflict (host) do nothing;

create or replace function public.ingest_blocked_host_hit(variadic p_vals text[])
returns text language sql stable as $$
  select b.host from public.ingest_blocked_host b, unnest(p_vals) v
   where v is not null and position(b.host in lower(v)) > 0 limit 1
$$;

create or replace function public.block_ingest_source_trg()
returns trigger language plpgsql as $$
declare h text;
begin
  if TG_TABLE_NAME = 'vehicles' then
    h := public.ingest_blocked_host_hit(NEW.discovery_source, NEW.discovery_url, NEW.listing_url, NEW.platform_url, NEW.source);
  else
    h := public.ingest_blocked_host_hit(NEW.source_platform, NEW.source_url);
  end if;
  if h is not null then
    raise exception 'ingest blocked: source host % is in ingest_blocked_host', h using errcode = 'check_violation';
  end if;
  return NEW;
end $$;

drop trigger if exists vehicles_block_ingest_source on public.vehicles;
create trigger vehicles_block_ingest_source before insert or update of discovery_source, discovery_url, listing_url, platform_url, source
  on public.vehicles for each row execute function public.block_ingest_source_trg();
drop trigger if exists vehicle_events_block_ingest_source on public.vehicle_events;
create trigger vehicle_events_block_ingest_source before insert or update of source_platform, source_url
  on public.vehicle_events for each row execute function public.block_ingest_source_trg();

-- quarantine: events + their vehicles; hides vehicles from public surfaces (is_public=false), prior value kept
create or replace function public.quarantine_records_v1(p_run text, p_event_ids uuid[], p_reason text)
returns jsonb language plpgsql as $$
declare ne int; nv int;
begin
  insert into public.record_quarantine (tbl, row_id, reason, run_id)
  select 'vehicle_events', e.id, p_reason, p_run from public.vehicle_events e
   where e.id = any(p_event_ids) and not public.record_is_quarantined('vehicle_events', e.id);
  get diagnostics ne = row_count;
  insert into public.record_quarantine (tbl, row_id, reason, run_id, prior_is_public)
  select distinct on (v.id) 'vehicles', v.id, p_reason, p_run, v.is_public from public.vehicle_events e join public.vehicles v on v.id = e.vehicle_id
   where e.id = any(p_event_ids) and not public.record_is_quarantined('vehicles', v.id);
  get diagnostics nv = row_count;
  update public.vehicles v set is_public = false from public.record_quarantine q
   where q.tbl = 'vehicles' and q.row_id = v.id and q.run_id = p_run and q.released_at is null and v.is_public;
  return jsonb_build_object('events', ne, 'vehicles', nv);
end $$;

create or replace function public.release_quarantine_v1(p_run text, p_release_run text)
returns jsonb language plpgsql as $$
declare n int;
begin
  update public.vehicles v set is_public = q.prior_is_public from public.record_quarantine q
   where q.tbl = 'vehicles' and q.row_id = v.id and q.run_id = p_run and q.released_at is null and q.prior_is_public is not null;
  update public.record_quarantine set released_at = now(), released_run = p_release_run where run_id = p_run and released_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('released', n);
end $$;

-- resolve suspect-platform events from cited pages. p_pages: [{id, platform, price, date, url, quote}] read from
-- each event's own source_url; plus Barrett-Jackson lots from bj_results_stage_v1_20261024 (their lot API, read_at
-- cited). Accepts only page price = stored final_price and page date within 10 days of sold_at (or sold_at null).
create or replace function public.resolve_platform_host_from_pages_v1(p_run text, p_pages jsonb, p_dry boolean default true)
returns jsonb language plpgsql as $$
declare n_page int; n_bj int;
begin
  drop table if exists _res;
  create temp table _res as
  select e.id, e.final_price, (p->>'platform') plat, (p->>'price')::numeric pp, (p->>'date')::date pd, p->>'url' url, p->>'quote' q, 'page' src
    from jsonb_array_elements(p_pages) p join public.vehicle_events e on e.id = (p->>'id')::uuid
   where 'source_platform' = any(e.source_suspect) and e.source_url = p->>'url'
     and (p->>'price')::numeric = e.final_price
     and (e.sold_at is null or abs((p->>'date')::date - e.sold_at::date) <= 10);
  get diagnostics n_page = row_count;
  insert into _res
  select e.id, e.final_price, 'barrettjackson', s.price_usd, s.run_datetime::date, e.source_url,
         'BJ lot '||s.item_id||' sold '||s.price_usd||' on '||s.run_datetime::date||' (lot API '||s.api_url||', read '||s.read_at::date||')', 'bj_stage'
    from public.vehicle_events e join public.bj_results_stage_v1_20261024 s
      on s.item_id = substring(split_part(e.source_url,'?',1) from '-(\d+)/?$')
   where 'source_platform' = any(e.source_suspect) and e.source_url ilike '%barrett-jackson.com%'
     and e.event_status = 'sold' and s.is_sold and s.price_usd = e.final_price
     and (e.sold_at is null or abs(s.run_datetime::date - e.sold_at::date) <= 10)
     and not exists (select 1 from _res r where r.id = e.id);
  get diagnostics n_bj = row_count;
  if not p_dry then
    insert into public.price_basis_observation (tbl, event_id, kind, stored_price, observed_status, observed_price, observed_on, source_url, evidence, rule, run_id)
    select 'vehicle_events', r.id, 'observed_page_status', r.final_price, 'sold', r.pp, r.pd, r.url,
           'platform='||r.plat||'; cited page shows sale on its own host: '||r.q||'; stored source_platform kept, conflict resolved by this observation',
           'platform_host_resolution_v1', p_run
      from _res r
    on conflict (tbl, event_id, rule) do nothing;
  end if;
  return jsonb_build_object('page', n_page, 'bj_stage', n_bj, 'dry', p_dry);
end $$;

create or replace function public.revert_platform_host_resolution_v1(p_run text)
returns jsonb language plpgsql as $$
declare n int;
begin
  update public.price_basis_observation set superseded_at = now()
   where run_id = p_run and rule = 'platform_host_resolution_v1' and superseded_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('superseded', n);
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
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and not public.record_is_quarantined('vehicles', id)) v
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
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and not public.record_is_quarantined('vehicles', id)) v
    JOIN vehicle_events ve ON ve.vehicle_id = v.id
      AND NOT public.vehicle_event_comp_excluded(ve.id, ve.source_suspect)
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
