-- actor_profile_read gains the identity kind: a market participant as measures (case ledger 13.11).
--
-- App accounts cannot be ranked yet (one account holds public vehicles); the people who exist in volume are the
-- market's participants, 692,838 Bring a Trailer identities in external_identities. An identity reads as:
--   Selling  auction listings recorded with the identity as seller (vehicle_events; one per listing page, a relist
--            its own listing), sold if any event recorded a sale; sell-through on recorded outcomes; no peer rank
--            until a per-seller fold exists (ranking every seller at read time measured over 10 s on 2026-10-14).
--   Bidding  the bidder profile snapshot (mv_bidder_profiles, a table, newest activity 2026-02-09), each measure
--            ranked among bidders with five or more auctions entered and dated by the snapshot's clock.
--   Talking  attributed auction comments, and seller responses per listed vehicle (responsiveness).
-- The organization kind is unchanged from 20261014001500. Same public projection, no amounts.

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
  e record;
  b record;
  bk record;
  snap timestamptz;
  i_listed int; i_sold int; i_rnm int; i_vehicles int; i_comments int; i_lots int; i_responses int; i_entered int := 0;
BEGIN
  IF p_kind = 'identity' THEN
    -- A market participant (external_identities): what it sells, how it bids, how it talks.
    SELECT id, platform, handle, display_name INTO e FROM public.external_identities WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    -- Selling: the auction listings attributed to this identity as seller (vehicle_events, one listing per
    -- normalized listing URL; a relist is its own listing, as Bring a Trailer counts it). Each listing reads as
    -- sold if any of its events recorded a sale, unsold if it ended without one, open otherwise. Keyed on the
    -- seller recorded per listing, not on vehicles.bat_seller, which holds only a vehicle's latest seller (on
    -- 2026-10-14 that field missed 2 of VivaLasVegasAutos' listings resold later by others). No peer rank until a
    -- per-seller fold exists.
    SELECT count(*), count(*) FILTER (WHERE sold), count(*) FILTER (WHERE NOT sold AND ended), count(DISTINCT vehicle_id)
      INTO i_listed, i_sold, i_rnm, i_vehicles
      FROM (SELECT lower(regexp_replace(regexp_replace(ve.source_url, '[?#].*$', ''), '/+$', '')) AS u,
                   bool_or(ve.event_status = 'sold') AS sold,
                   bool_or(ve.event_status IN ('ended', 'unsold', 'reserve_not_met')) AS ended,
                   min(ve.vehicle_id::text)::uuid AS vehicle_id
              FROM public.vehicle_events ve
             WHERE ve.seller_external_identity_id = e.id AND ve.event_type = 'auction' AND ve.source_url IS NOT NULL
             GROUP BY 1) l;
    items := '[]'::jsonb;
    IF i_listed > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Listings', 'unit', 'listings', 'value', i_listed,
        'method', 'auction listings recorded with this identity as seller, one per listing page; a relist counts as its own listing',
        'coverage', jsonb_build_object('n', i_listed, 'of', i_listed, 'grain', 'listings', 'as_of', v_now), 'rank', NULL);
      items := items || jsonb_build_object(
        'label', 'Vehicles', 'unit', 'vehicles', 'value', i_vehicles,
        'method', 'distinct vehicle records behind those listings',
        'coverage', jsonb_build_object('n', i_vehicles, 'of', i_listed, 'grain', 'listings', 'as_of', v_now), 'rank', NULL);
    END IF;
    IF i_sold + i_rnm > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Sell-through', 'unit', '%', 'value', round(100.0 * i_sold / (i_sold + i_rnm), 1),
        'method', 'sold ÷ (sold + ended unsold) on listings with a recorded outcome; no peer rank until a per-seller fold exists',
        'coverage', jsonb_build_object('n', i_sold + i_rnm, 'of', i_listed, 'grain', 'listings with a recorded outcome', 'as_of', v_now), 'rank', NULL);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', i_sold + i_rnm, 'of', i_listed, 'grain', 'listings with a recorded outcome', 'as_of', v_now),
      'items', items);

    -- Bidding: the bidder profile snapshot (mv_bidder_profiles, a table last built from activity through its newest
    -- last_seen), ranked among bidders with five or more auctions entered.
    items := '[]'::jsonb;
    SELECT max(last_seen) INTO snap FROM public.mv_bidder_profiles;
    SELECT * INTO b FROM public.mv_bidder_profiles WHERE e.platform = 'bat' AND bat_username = e.handle;
    IF FOUND THEN
      i_entered := coalesce(b.auctions_entered, 0);
      SELECT count(*) AS n,
             count(*) FILTER (WHERE c.auctions_entered < b.auctions_entered) AS lt_entered,
             count(*) FILTER (WHERE c.wins < b.wins) AS lt_wins,
             count(*) FILTER (WHERE c.win_rate < b.win_rate) AS lt_rate,
             count(*) FILTER (WHERE c.total_bids::numeric / c.auctions_entered < b.total_bids::numeric / nullif(b.auctions_entered, 0)) AS lt_bpa,
             bool_or(c.bat_username = b.bat_username) AS in_cohort
        INTO bk
        FROM public.mv_bidder_profiles c
       WHERE c.auctions_entered >= 5;
      items := items || jsonb_build_object(
        'label', 'Auctions entered', 'unit', 'auctions', 'value', b.auctions_entered,
        'method', 'auctions the handle bid in, from the bidder profile snapshot',
        'coverage', jsonb_build_object('n', b.auctions_entered, 'of', b.auctions_entered, 'grain', 'auctions entered', 'as_of', snap),
        'rank', CASE WHEN bk.in_cohort AND bk.n >= 2 THEN jsonb_build_object('p', round(100.0 * bk.lt_entered / (bk.n - 1), 1), 'n', bk.n) END);
      items := items || jsonb_build_object(
        'label', 'Wins', 'unit', 'auctions', 'value', b.wins,
        'method', 'auctions the handle won, from the bidder profile snapshot',
        'coverage', jsonb_build_object('n', b.auctions_entered, 'of', b.auctions_entered, 'grain', 'auctions entered', 'as_of', snap),
        'rank', CASE WHEN bk.in_cohort AND bk.n >= 2 THEN jsonb_build_object('p', round(100.0 * bk.lt_wins / (bk.n - 1), 1), 'n', bk.n) END);
      items := items || jsonb_build_object(
        'label', 'Win rate', 'unit', '%', 'value', round(100.0 * b.win_rate, 1),
        'method', 'wins ÷ auctions entered, from the bidder profile snapshot',
        'coverage', jsonb_build_object('n', b.auctions_entered, 'of', b.auctions_entered, 'grain', 'auctions entered', 'as_of', snap),
        'rank', CASE WHEN bk.in_cohort AND bk.n >= 2 THEN jsonb_build_object('p', round(100.0 * bk.lt_rate / (bk.n - 1), 1), 'n', bk.n) END);
      items := items || jsonb_build_object(
        'label', 'Bids per auction', 'unit', 'bids', 'value', round(b.total_bids::numeric / nullif(b.auctions_entered, 0), 1),
        'method', 'bids ÷ auctions entered, from the bidder profile snapshot',
        'coverage', jsonb_build_object('n', b.auctions_entered, 'of', b.auctions_entered, 'grain', 'auctions entered', 'as_of', snap),
        'rank', CASE WHEN bk.in_cohort AND bk.n >= 2 THEN jsonb_build_object('p', round(100.0 * bk.lt_bpa / (bk.n - 1), 1), 'n', bk.n) END);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'bidding', 'title', 'Bidding',
      'coverage', jsonb_build_object('n', i_entered, 'of', i_entered, 'grain', 'auctions entered in the bidder snapshot', 'as_of', snap),
      'items', items);

    -- Talking: the handle's comments on auctions, and how many are its answers to bidders as the seller.
    SELECT count(*), count(DISTINCT vehicle_id), count(*) FILTER (WHERE comment_type = 'seller_response')
      INTO i_comments, i_lots, i_responses
      FROM public.auction_comments WHERE author_external_identity_id = e.id;
    items := '[]'::jsonb;
    IF i_comments > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Comments', 'unit', 'comments', 'value', i_comments,
        'method', 'auction comments attributed to this identity',
        'coverage', jsonb_build_object('n', i_lots, 'of', i_lots, 'grain', 'lots commented on', 'as_of', v_now), 'rank', NULL);
      IF i_listed > 0 THEN
        items := items || jsonb_build_object(
          'label', 'Answers to bidders per listing', 'unit', 'answers', 'value', round(i_responses::numeric / i_listed, 1),
          'method', 'seller responses ÷ listings with this identity as seller',
          'coverage', jsonb_build_object('n', i_responses, 'of', i_comments, 'grain', 'comments that are seller responses', 'as_of', v_now), 'rank', NULL);
      END IF;
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'talking', 'title', 'Talking',
      'coverage', jsonb_build_object('n', i_comments, 'of', i_comments, 'grain', 'attributed comments', 'as_of', v_now),
      'items', items);

    RETURN jsonb_build_object(
      'subject', jsonb_build_object('kind', 'identity', 'id', e.id, 'name', coalesce(nullif(e.display_name, ''), e.handle),
                                    'type', e.platform, 'place', NULL, 'zip', NULL, 'handle', e.handle),
      'viewer', 'anon',
      'read_at', v_now,
      'sections', sections);
  END IF;

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
  'An actor as a kit document of measures. organization: performance with peer ranks, specialization against the market, open books as presence only, vehicles by role. identity: selling, bidding (dated snapshot, ranked) and talking. One public projection for every viewer; no amounts. Case ledger 13.11. 2026-10-14.';
