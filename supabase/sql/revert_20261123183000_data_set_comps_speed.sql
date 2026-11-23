-- Revert of 20261123183000_data_set_comps_speed: puts back the SQL-language data_set_comps_one from 20261123182000.
-- Run before revert_20261123182000_data_set_membership_public_comps.sql.
begin;
set local lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.data_set_comps_one(p_set_id uuid, p_exclude_vehicle uuid, p_basis price_basis_t)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH s AS (SELECT * FROM public.data_sets WHERE id = p_set_id),
  ex AS (SELECT upper(btrim(x.vin)) AS vin FROM public.vehicles x WHERE x.id = p_exclude_vehicle AND nullif(btrim(x.vin), '') IS NOT NULL),
  mv AS (
    SELECT DISTINCT m.vehicle_id FROM public.data_set_members m
      JOIN s ON s.id = m.set_id
      JOIN public.vehicles pv ON pv.id = m.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
     WHERE m.state = 'active' AND m.member_type = 'vehicle' AND s.set_kind <> 'comment_theme'
       AND m.vehicle_id IS DISTINCT FROM p_exclude_vehicle),
  ev_ids AS (
    SELECT ae.id FROM mv JOIN public.auction_events_canonical ae ON ae.vehicle_id = mv.vehicle_id
    UNION
    SELECT c.auction_event_id FROM public.data_set_members m JOIN s ON s.id = m.set_id
      JOIN public.auction_comments c ON c.id = m.member_id
     WHERE s.set_kind = 'comment_theme' AND m.state = 'active' AND m.member_type = 'auction_comment'
       AND c.auction_event_id IS NOT NULL AND m.vehicle_id IS DISTINCT FROM p_exclude_vehicle),
  ev AS (
    SELECT DISTINCT ON (coalesce(ae.canonical_listing_url, rtrim(ae.source_url, '/'), ae.id::text))
           ae.id, ae.vehicle_id, ae.outcome, ae.auction_end_date, ae.currency_code, ae.high_bid,
           (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price
                         WHEN 'net_to_owner' THEN ae.net_to_owner END) AS amt,
           ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
             AND NOT (coalesce(ae.raw_data, '{}'::jsonb) ? 'duplicate_of') AS is_sold
      FROM ev_ids JOIN public.auction_events_canonical ae ON ae.id = ev_ids.id
      JOIN public.vehicles x ON x.id = ae.vehicle_id AND x.is_public IS TRUE AND x.deleted_at IS NULL
     WHERE ae.vehicle_id IS DISTINCT FROM p_exclude_vehicle
       AND NOT EXISTS (SELECT 1 FROM ex WHERE ex.vin = upper(btrim(x.vin)))
     ORDER BY coalesce(ae.canonical_listing_url, rtrim(ae.source_url, '/'), ae.id::text),
              (ae.outcome = 'sold') DESC, ae.auction_end_date DESC NULLS LAST, ae.id),
  priced AS (
    SELECT ev.*, CASE WHEN ev.currency_code IS NULL THEN ev.amt ELSE round(ev.amt * fx.rate, 0) END AS usd,
           ev.currency_code IS NULL AS unconverted,
           extract(year FROM ev.auction_end_date)::int AS yr
      FROM ev LEFT JOIN LATERAL (SELECT f.rate FROM public.fx_usd_rate(ev.currency_code, (ev.auction_end_date AT TIME ZONE 'UTC')::date) f LIMIT 1) fx
        ON ev.currency_code IS NOT NULL
     WHERE ev.is_sold AND ev.amt > 0),
  sold AS (SELECT * FROM priced WHERE usd IS NOT NULL)
  SELECT jsonb_build_object(
    'set_id', s.id, 'set_kind', s.set_kind, 'set_key', s.set_key, 'label', s.label,
    'member_vehicles', (SELECT count(*) FROM mv),
    'listings', (SELECT count(*) FROM ev),
    'price_basis', p_basis::text,
    'sold', (SELECT jsonb_build_object('n', count(*), 'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY usd),
                                       'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY usd),
                                       'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY usd),
                                       'min', min(usd), 'max', max(usd),
                                       'n_currency_unknown', count(*) FILTER (WHERE unconverted)) FROM sold),
    'sold_by_period', (SELECT coalesce(jsonb_agg(jsonb_build_object('period', p.period, 'n', p.n, 'median', p.med) ORDER BY p.period), '[]'::jsonb)
                         FROM (SELECT CASE WHEN yr IS NULL THEN 'unknown' WHEN yr < 2015 THEN 'before_2015'
                                           WHEN yr < 2020 THEN '2015_2019' ELSE yr::text END AS period,
                                      count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY usd) AS med
                                 FROM sold GROUP BY 1) p),
    'by_outcome', (SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', o.outcome, 'n', o.n, 'median_high_bid_not_a_sale', o.hb) ORDER BY o.n DESC), '[]'::jsonb)
                     FROM (SELECT e2.outcome, count(*) AS n,
                                  CASE WHEN e2.outcome <> 'sold'
                                       THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY e2.high_bid) FILTER (WHERE e2.high_bid > 0 AND e2.currency_code IS NOT DISTINCT FROM 'USD') END AS hb
                             FROM (SELECT coalesce(ev.outcome, 'unknown') AS outcome, ev.high_bid, ev.currency_code FROM ev) e2
                            GROUP BY e2.outcome) o))
  FROM s
$function$;

REVOKE ALL ON FUNCTION public.data_set_comps_one(uuid, uuid, price_basis_t) FROM PUBLIC, anon, authenticated;
commit;
