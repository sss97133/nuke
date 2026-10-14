-- actor_profile_read(kind, id): an actor as a kit document of measures (case ledger 13.11, owner 2026-10-14).
--
-- The owner: an endpoint that shows a name and a list of cars means nothing; what has meaning is performance and
-- relativity. This read returns one document per actor, for every viewer the same public projection: counts,
-- shares and percentile ranks with their methods, populations and clocks, never an amount. Organizations now;
-- people next (a kind this version does not read returns NULL).
--
-- Sections (kit Section shapes, nuke_frontend/src/kit/types.ts; the phone's twin is ProfileDocument.swift):
--   measures "performance"     from organization_seller_stats (compute-org-seller-stats, contract
--                               listing_activity_v1): sell-through on known outcomes, listings, bids, comments and
--                               views per listing, each ranked among public organizations with five or more known
--                               outcomes (percent rank, 0 to 100; clients show it only at RANK_FLOOR 5 or more).
--   measures "specialization"  the organization's public vehicles (owner, sold_by, consigner links) by decade and
--                               make against the market's shares (market_pulse year and make counts, the nightly
--                               views the Pulse lens reads): a concentration ratio, 2.0 = twice the market's share.
--   measures "open_books"      of sold vehicles, the share whose record carries a sale amount; of held vehicles,
--                               the share carrying an acquisition cost; the vehicles carrying both (whose ROI is
--                               computable). Presence only: no amount leaves this function.
--   table    "Vehicles by role" link counts by relationship and status.
-- organization_seller_stats has row security and no read policy, so the read is SECURITY DEFINER with this fixed
-- projection, for public organizations and public, undeleted vehicles only. Supersedes get_org_profile_fast
-- (no repo callers; it returns the whole business row).
-- Contract: supabase/sql/test_actor_profile_read.sql (CI job actor-profile-read-contract).

set lock_timeout = '5s';
set statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.actor_profile_read(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
DECLARE
  v_now timestamptz := now();
  o record;
  s record;
  k record;
  r record;
  sections jsonb := '[]'::jsonb;
  items jsonb;
  c_with_year int; c_with_make int; c_total int; c_sold int; c_sold_amt int; c_held int; c_held_cost int; c_both int; c_links int;
BEGIN
  IF p_kind IS DISTINCT FROM 'organization' THEN
    RETURN NULL;
  END IF;
  SELECT id, business_name, business_type, city, state, zip_code INTO o
    FROM public.organizations WHERE id = p_id AND is_public = true;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 1. Performance.
  SELECT * INTO s FROM public.organization_seller_stats WHERE organization_id = p_id;
  IF FOUND THEN
    SELECT
      count(*) FILTER (WHERE c.st IS NOT NULL) AS n_st, count(*) FILTER (WHERE c.st < me.st) AS lt_st,
      count(*) FILTER (WHERE c.bids IS NOT NULL) AS n_bids, count(*) FILTER (WHERE c.bids < me.bids) AS lt_bids,
      count(*) FILTER (WHERE c.comments IS NOT NULL) AS n_comments, count(*) FILTER (WHERE c.comments < me.comments) AS lt_comments,
      count(*) FILTER (WHERE c.views IS NOT NULL) AS n_views, count(*) FILTER (WHERE c.views < me.views) AS lt_views,
      count(*) FILTER (WHERE c.volume IS NOT NULL) AS n_volume, count(*) FILTER (WHERE c.volume < me.volume) AS lt_volume,
      bool_or(c.organization_id = p_id) AS in_cohort
    INTO k
    FROM (SELECT organization_id,
                 total_sold::numeric / nullif(coalesce(total_sold, 0) + coalesce(total_unsold, 0), 0) AS st,
                 avg_bid_count AS bids, avg_comment_count AS comments, avg_view_count AS views,
                 total_listings::numeric AS volume
            FROM public.organization_seller_stats ss
           WHERE coalesce(total_sold, 0) + coalesce(total_unsold, 0) >= 5
             AND EXISTS (SELECT 1 FROM public.organizations po WHERE po.id = ss.organization_id AND po.is_public = true)) c
    CROSS JOIN (SELECT s.total_sold::numeric / nullif(coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 0) AS st,
                       s.avg_bid_count AS bids, s.avg_comment_count AS comments, s.avg_view_count AS views,
                       s.total_listings::numeric AS volume) me;

    items := '[]'::jsonb;
    IF coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0) > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Sell-through', 'unit', '%',
        'value', round(100.0 * s.total_sold / (coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0)), 1),
        'method', 'sold ÷ (sold + unsold) on attributed listings with a recorded outcome; ' || coalesce((s.evidence_summary->>'outcome_conflicts'), '0') || ' listings carry conflicting outcomes',
        'coverage', jsonb_build_object('n', coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 'of', coalesce(s.total_listings, 0), 'grain', 'listings with a recorded outcome', 'as_of', s.calculated_at),
        'rank', CASE WHEN k.in_cohort AND k.n_st >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_st / (k.n_st - 1), 1), 'n', k.n_st) END);
    END IF;
    IF s.total_listings IS NOT NULL THEN
      items := items || jsonb_build_object(
        'label', 'Listings', 'unit', 'listings', 'value', s.total_listings,
        'method', 'auction listings attributed to the organization in retained public sources',
        'coverage', jsonb_build_object('n', s.total_listings, 'of', s.total_listings, 'grain', 'attributed listings', 'as_of', s.calculated_at),
        'rank', CASE WHEN k.in_cohort AND k.n_volume >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_volume / (k.n_volume - 1), 1), 'n', k.n_volume) END);
    END IF;
    IF s.avg_bid_count IS NOT NULL THEN
      items := items || jsonb_build_object(
        'label', 'Bids per listing', 'unit', 'bids', 'value', round(s.avg_bid_count, 1),
        'method', 'mean of the highest retained bid counter per listing, known values only',
        'coverage', jsonb_build_object('n', s.total_listings, 'of', s.total_listings, 'grain', 'attributed listings', 'as_of', s.calculated_at),
        'rank', CASE WHEN k.in_cohort AND k.n_bids >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_bids / (k.n_bids - 1), 1), 'n', k.n_bids) END);
    END IF;
    IF s.avg_comment_count IS NOT NULL THEN
      items := items || jsonb_build_object(
        'label', 'Comments per listing', 'unit', 'comments', 'value', round(s.avg_comment_count, 1),
        'method', 'mean of the highest retained comment counter per listing, known values only',
        'coverage', jsonb_build_object('n', s.total_listings, 'of', s.total_listings, 'grain', 'attributed listings', 'as_of', s.calculated_at),
        'rank', CASE WHEN k.in_cohort AND k.n_comments >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_comments / (k.n_comments - 1), 1), 'n', k.n_comments) END);
    END IF;
    IF s.avg_view_count IS NOT NULL THEN
      items := items || jsonb_build_object(
        'label', 'Views per listing', 'unit', 'views', 'value', round(s.avg_view_count, 0),
        'method', 'mean of the highest retained view counter per listing, known values only',
        'coverage', jsonb_build_object('n', s.total_listings, 'of', s.total_listings, 'grain', 'attributed listings', 'as_of', s.calculated_at),
        'rank', CASE WHEN k.in_cohort AND k.n_views >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_views / (k.n_views - 1), 1), 'n', k.n_views) END);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 'of', coalesce(s.total_listings, 0), 'grain', 'listings with a recorded outcome', 'as_of', s.calculated_at),
      'items', items);
  ELSE
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', 0, 'of', 0, 'grain', 'attributed listings', 'as_of', NULL),
      'items', '[]'::jsonb);
  END IF;

  -- The organization's public vehicles (owner, sold_by, consigner links): one row per vehicle, sold if any link says so.
  -- The same set is a CTE in each query below; a STABLE function runs read-only and cannot stage it in a table.
  WITH av AS (
      SELECT ve.id,
             CASE WHEN ve.year BETWEEN 1885 AND 2100 THEN (ve.year / 10) * 10 END AS decade,
             nullif(lower(btrim(ve.make)), '') AS make,
             bool_or(ov.relationship_type = 'sold_by' OR ov.status IN ('sold', 'past')) AS sold,
             (coalesce(ve.sale_price, 0) > 0 OR coalesce(ve.sold_price, 0) > 0 OR coalesce(ve.bat_sold_price, 0) > 0) AS has_amount,
             coalesce(ve.purchase_price, 0) > 0 AS has_cost
        FROM public.organization_vehicles ov
        JOIN public.vehicles ve ON ve.id = ov.vehicle_id
       WHERE ov.organization_id = p_id
         AND ov.relationship_type IN ('owner', 'sold_by', 'consigner')
         AND ve.is_public = true AND ve.deleted_at IS NULL
       GROUP BY ve.id, ve.year, ve.make, ve.sale_price, ve.sold_price, ve.bat_sold_price, ve.purchase_price)
  SELECT count(*), count(decade), count(make),
         count(*) FILTER (WHERE sold), count(*) FILTER (WHERE sold AND has_amount),
         count(*) FILTER (WHERE NOT sold), count(*) FILTER (WHERE NOT sold AND has_cost),
         count(*) FILTER (WHERE has_amount AND has_cost)
    INTO c_total, c_with_year, c_with_make, c_sold, c_sold_amt, c_held, c_held_cost, c_both
    FROM av;

  -- 2. Specialization: the three largest decades and makes, each against the market's share.
  items := '[]'::jsonb;
  FOR r IN
    WITH av AS (
      SELECT ve.id,
             CASE WHEN ve.year BETWEEN 1885 AND 2100 THEN (ve.year / 10) * 10 END AS decade,
             nullif(lower(btrim(ve.make)), '') AS make,
             bool_or(ov.relationship_type = 'sold_by' OR ov.status IN ('sold', 'past')) AS sold,
             (coalesce(ve.sale_price, 0) > 0 OR coalesce(ve.sold_price, 0) > 0 OR coalesce(ve.bat_sold_price, 0) > 0) AS has_amount,
             coalesce(ve.purchase_price, 0) > 0 AS has_cost
        FROM public.organization_vehicles ov
        JOIN public.vehicles ve ON ve.id = ov.vehicle_id
       WHERE ov.organization_id = p_id
         AND ov.relationship_type IN ('owner', 'sold_by', 'consigner')
         AND ve.is_public = true AND ve.deleted_at IS NULL
       GROUP BY ve.id, ve.year, ve.make, ve.sale_price, ve.sold_price, ve.bat_sold_price, ve.purchase_price),
         mine AS (SELECT decade, count(*) AS n FROM av WHERE decade IS NOT NULL GROUP BY decade),
         mkt AS (SELECT (y / 10) * 10 AS decade, sum(cnt) AS n
                   FROM (SELECT CASE WHEN name ~ '^[0-9]{4}$' THEN name::int END AS y, count AS cnt
                           FROM public.market_pulse('year', 300)) t
                  WHERE y BETWEEN 1885 AND 2100 GROUP BY 1),
         tot AS (SELECT (SELECT sum(n) FROM mine) AS mine_n, (SELECT sum(n) FROM mkt) AS mkt_n)
    SELECT mine.decade, mine.n, (mine.n::numeric / tot.mine_n) / nullif(mkt.n::numeric / tot.mkt_n, 0) AS ratio
      FROM mine JOIN mkt USING (decade) CROSS JOIN tot
     ORDER BY mine.n DESC, mine.decade LIMIT 3
  LOOP
    items := items || jsonb_build_object(
      'label', r.decade::text || 's', 'unit', '× market', 'value', round(r.ratio, 1),
      'method', 'share of the organization''s public vehicles from the decade ÷ the decade''s share of public vehicle records (market_pulse year counts)',
      'coverage', jsonb_build_object('n', r.n, 'of', c_with_year, 'grain', 'vehicles with a year', 'as_of', v_now),
      'rank', NULL);
  END LOOP;
  FOR r IN
    WITH av AS (
      SELECT ve.id,
             CASE WHEN ve.year BETWEEN 1885 AND 2100 THEN (ve.year / 10) * 10 END AS decade,
             nullif(lower(btrim(ve.make)), '') AS make,
             bool_or(ov.relationship_type = 'sold_by' OR ov.status IN ('sold', 'past')) AS sold,
             (coalesce(ve.sale_price, 0) > 0 OR coalesce(ve.sold_price, 0) > 0 OR coalesce(ve.bat_sold_price, 0) > 0) AS has_amount,
             coalesce(ve.purchase_price, 0) > 0 AS has_cost
        FROM public.organization_vehicles ov
        JOIN public.vehicles ve ON ve.id = ov.vehicle_id
       WHERE ov.organization_id = p_id
         AND ov.relationship_type IN ('owner', 'sold_by', 'consigner')
         AND ve.is_public = true AND ve.deleted_at IS NULL
       GROUP BY ve.id, ve.year, ve.make, ve.sale_price, ve.sold_price, ve.bat_sold_price, ve.purchase_price),
         mine AS (SELECT make, count(*) AS n FROM av WHERE make IS NOT NULL GROUP BY make),
         mkt AS (SELECT lower(btrim(name)) AS make, sum(count) AS n FROM public.market_pulse('make', 400)
                  WHERE lower(btrim(name)) <> 'unresolved' GROUP BY 1),
         tot AS (SELECT (SELECT sum(n) FROM mine) AS mine_n, (SELECT sum(n) FROM mkt) AS mkt_n)
    SELECT mine.make, mine.n, (mine.n::numeric / tot.mine_n) / nullif(mkt.n::numeric / tot.mkt_n, 0) AS ratio
      FROM mine JOIN mkt USING (make) CROSS JOIN tot
     ORDER BY mine.n DESC, mine.make LIMIT 3
  LOOP
    items := items || jsonb_build_object(
      'label', initcap(r.make), 'unit', '× market', 'value', round(r.ratio, 1),
      'method', 'share of the organization''s public vehicles of the make ÷ the make''s share of public vehicle records (market_pulse make counts)',
      'coverage', jsonb_build_object('n', r.n, 'of', c_with_make, 'grain', 'vehicles with a make', 'as_of', v_now),
      'rank', NULL);
  END LOOP;
  sections := sections || jsonb_build_object(
    'kind', 'measures', 'stack', 'specialization', 'title', 'What they handle',
    'coverage', jsonb_build_object('n', c_with_year, 'of', c_total, 'grain', 'public vehicles linked as owner, seller or consigner', 'as_of', v_now),
    'items', items);

  -- 3. Open books: whether the record carries the money, never the money itself.
  items := '[]'::jsonb;
  IF c_sold > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Sales with a recorded amount', 'unit', '%', 'value', round(100.0 * c_sold_amt / c_sold, 1),
      'method', 'sold vehicles whose record carries a sale amount (sale, sold or auction result price); amounts are not shown',
      'coverage', jsonb_build_object('n', c_sold_amt, 'of', c_sold, 'grain', 'sold vehicles', 'as_of', v_now), 'rank', NULL);
  END IF;
  IF c_held > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Holdings with a recorded cost', 'unit', '%', 'value', round(100.0 * c_held_cost / c_held, 1),
      'method', 'held vehicles whose record carries an acquisition cost; amounts are not shown',
      'coverage', jsonb_build_object('n', c_held_cost, 'of', c_held, 'grain', 'held vehicles', 'as_of', v_now), 'rank', NULL);
  END IF;
  IF c_total > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Return computable', 'unit', 'vehicles', 'value', c_both,
      'method', 'vehicles whose record carries both an acquisition cost and a sale amount',
      'coverage', jsonb_build_object('n', c_both, 'of', c_total, 'grain', 'public vehicles', 'as_of', v_now), 'rank', NULL);
  END IF;
  sections := sections || jsonb_build_object(
    'kind', 'measures', 'stack', 'open_books', 'title', 'Open books',
    'coverage', jsonb_build_object('n', c_sold_amt + c_held_cost, 'of', c_total, 'grain', 'public vehicles with money recorded', 'as_of', v_now),
    'items', items);

  -- 4. Vehicles by role.
  SELECT coalesce(jsonb_agg(jsonb_build_array(
           jsonb_build_object('value', t.role, 'source', jsonb_build_object('kind', 'legacy', 'label', 'organization_vehicles'), 'observed_at', NULL, 'trust', 1),
           jsonb_build_object('value', t.active, 'source', jsonb_build_object('kind', 'legacy', 'label', 'organization_vehicles'), 'observed_at', NULL, 'trust', 1),
           jsonb_build_object('value', t.other, 'source', jsonb_build_object('kind', 'legacy', 'label', 'organization_vehicles'), 'observed_at', NULL, 'trust', 1))
           ORDER BY t.active + t.other DESC, t.role), '[]'::jsonb),
         coalesce(sum(t.active + t.other), 0)
    INTO items, c_links
    FROM (SELECT ov.relationship_type AS role,
                 count(*) FILTER (WHERE ov.status = 'active') AS active,
                 count(*) FILTER (WHERE ov.status IS DISTINCT FROM 'active') AS other
            FROM public.organization_vehicles ov
            JOIN public.vehicles ve ON ve.id = ov.vehicle_id AND ve.is_public = true AND ve.deleted_at IS NULL
           WHERE ov.organization_id = p_id
           GROUP BY ov.relationship_type) t;
  sections := sections || jsonb_build_object(
    'kind', 'table', 'title', 'Vehicles by role',
    'coverage', jsonb_build_object('n', c_links, 'of', c_links, 'grain', 'links to public vehicles', 'as_of', v_now),
    'columns', jsonb_build_array('Role', 'Active', 'Past or sold'),
    'rows', items);

  RETURN jsonb_build_object(
    'subject', jsonb_build_object('kind', 'organization', 'id', o.id, 'name', o.business_name, 'type', o.business_type,
                                  'place', nullif(concat_ws(', ', nullif(o.city, ''), nullif(o.state, '')), ''), 'zip', o.zip_code),
    'viewer', 'anon',
    'read_at', v_now,
    'sections', sections);
END;
$function$;

REVOKE ALL ON FUNCTION public.actor_profile_read(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actor_profile_read(text, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.actor_profile_read(text, uuid) IS
  'An actor (organization now; people next) as a kit document of measures: performance with peer ranks, specialization against the market, open books as presence only, vehicles by role. One public projection for every viewer; no amounts. Case ledger 13.11. 2026-10-14.';
DO $$ BEGIN
  IF to_regprocedure('public.get_org_profile_fast(uuid)') IS NOT NULL THEN
    EXECUTE $c$COMMENT ON FUNCTION public.get_org_profile_fast(uuid) IS 'Superseded by actor_profile_read (2026-10-14). No repo callers; returns the whole business row. Revoke after confirming no live callers.'$c$;
  END IF;
END $$;
