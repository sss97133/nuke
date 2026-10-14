-- actor_profile_read(kind, id): an actor as a kit document of measures (case ledger 13.11, owner 2026-10-14).
--
-- The owner: an endpoint that shows a name and a list of cars means nothing; what has meaning is performance and
-- relativity. This read returns one document per actor, the same public projection for every viewer, never an
-- amount. Two kinds:
--   organization  a public organization (organizations), its linked Bring a Trailer identities from
--                 organization_external_profiles, its public vehicles by role.
--   identity      a market participant (external_identities), counted with every case variant of its handle
--                 (984 Bring a Trailer handles are split by case on 2026-10-14; one account, one count).
--
-- Sections (kit Section shapes, nuke_frontend/src/kit/types.ts; the phone's twin is ProfileDocument.swift):
--   measures "performance"  Selling. From the lot rows (auction_events, the canonical lot row, its seller keyed to
--                           external_identities by 20261006213000) with the actor's identities as seller: one per
--                           normalized listing page, a relist its own listing; sold if any lot on the page sold,
--                           unsold if it ended without a sale (reserve not met, bid to, no sale). An organization
--                           and its handle read the same number. Not vehicle_events: on 2026-10-14 it credited Viva
--                           with 4 lots Bring a Trailer shows under other sellers and called 5 of Viva's
--                           reserve-not-met lots sold (each checked on the listing page). An organization with no linked identity falls back to
--                           organization_seller_stats (compute-org-seller-stats, listing_activity_v1), ranked among
--                           public selling organizations with five or more recorded outcomes, venues excluded, its
--                           conflicts named and its clock the latest extraction of its inputs. Seller ranks from
--                           listing pages wait for a per-seller fold (ranking every seller at read time took over
--                           10 s on 2026-10-14).
--   measures "bidding"      identity only: the bidder profile snapshot (mv_bidder_profiles, a table whose newest
--                           activity is 2026-02-09), case variants summed, each measure ranked among the 66,929
--                           Bring a Trailer handles with five or more auctions entered and dated by the snapshot.
--                           Handles are public, pseudonymous accounts whose bid and win counts Bring a Trailer
--                           publishes on every member page; a rank adds relativity, never contact details or amounts.
--   measures "talking"      comments by the actor's identities, and answers to bidders on its own listings.
--   measures "specialization" and "open_books"  organization only: its public vehicles by decade and make against
--                           the market's shares (market_pulse counts), and whether sale amounts and acquisition
--                           costs are on record (presence only). Not aggregated at read time for a venue (an
--                           auction house, marketplace or platform) or an organization with more than 5,000 links:
--                           Bring a Trailer's 100,852 linked vehicles took 27 s on 2026-10-14.
--   table "Vehicles by role" organization only, behind the same venue and size guard.
-- organization_seller_stats has row security and no read policy, so the read is SECURITY DEFINER with this fixed
-- projection. Revokes get_org_profile_fast, which returned whole business rows (emails, phones, private
-- organizations) to anyone.
-- Contract: supabase/sql/test_actor_profile_read.sql (CI job actor-profile-read-contract).

-- Autocommit is required: supabase-deploy.yml applies with psql -f, each statement outside a transaction block.
-- The concurrent build follows 20261013110000: refuse on lock waiters, idle transactions or another build, and
-- verify the index is valid with the expected definition after it, so a timed-out build (20261011233715) is never
-- skipped by IF NOT EXISTS on a retry and left for every identity read to scan around.
SET statement_timeout = '120s';
SET lock_timeout = '10s';

DO $preflight$
DECLARE
  target oid := to_regclass('public.external_identities_platform_lower_handle_idx');
  expected constant text := 'CREATE INDEX external_identities_platform_lower_handle_idx ON public.external_identities USING btree (platform, lower(handle))';
BEGIN
  IF EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock')
    OR EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()
      AND state IN ('idle in transaction', 'idle in transaction (aborted)'))
    OR EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()
      AND state = 'active' AND query ~* '\mexternal_identities\M')
    OR EXISTS (SELECT FROM pg_stat_progress_create_index WHERE pid <> pg_backend_pid())
  THEN
    RAISE EXCEPTION 'Identity handle index requires an idle DDL lane without lock waiters, idle transactions or active builds';
  END IF;

  IF target IS NOT NULL AND (
    NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = target AND indrelid = 'public.external_identities'::regclass
      AND indisvalid AND indisready AND indislive)
    OR pg_get_indexdef(target) IS DISTINCT FROM expected
  ) THEN
    RAISE EXCEPTION 'Identity handle index conflict or invalid state; inspect the existing object before retry: %', pg_get_indexdef(target);
  END IF;
END
$preflight$;

-- Case-insensitive handle lookups for the identity variants (692,838 rows). Built concurrently, so writers to
-- external_identities are not blocked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS external_identities_platform_lower_handle_idx
  ON public.external_identities (platform, lower(handle));

DO $verify$
DECLARE
  target oid := to_regclass('public.external_identities_platform_lower_handle_idx');
  expected constant text := 'CREATE INDEX external_identities_platform_lower_handle_idx ON public.external_identities USING btree (platform, lower(handle))';
BEGIN
  IF target IS NULL OR NOT EXISTS (
    SELECT FROM pg_index WHERE indexrelid = target AND indrelid = 'public.external_identities'::regclass
      AND indisvalid AND indisready AND indislive
  ) OR pg_get_indexdef(target) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Identity handle index is not ready/valid with the expected definition after build';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE wait_event_type = 'Lock') THEN
    RAISE EXCEPTION 'Lock waiters observed after identity handle index build; stop and inspect';
  END IF;
END
$verify$;

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
  subject jsonb;
  sections jsonb := '[]'::jsonb;
  items jsonb;
  ids uuid[];
  is_org boolean := p_kind = 'organization';
  venue boolean := false;
  o record; e record; s record; k record; r record;
  -- selling from listing pages
  l_total int := 0; l_sold int := 0; l_unsold int := 0; l_last timestamptz; l_vehicle_ids uuid[];
  -- talking
  t_comments int := 0; t_lots int := 0; t_answers int := 0;
  -- bidding
  b_entered bigint; b_bids bigint; b_wins bigint; b_snap timestamptz;
  -- organization vehicles
  c_links int := 0; c_total int := 0; c_year int := 0; c_make int := 0; c_sold int := 0; c_sold_amt int := 0;
  c_held int := 0; c_held_cost int := 0; c_both int := 0; top_decades jsonb; top_makes jsonb; mkt_n numeric;
BEGIN
  IF p_kind = 'organization' THEN
    SELECT id, business_name, business_type, city, state, zip_code INTO o
      FROM public.organizations WHERE id = p_id AND is_public = true;
    IF NOT FOUND THEN RETURN NULL; END IF;
    venue := coalesce(o.business_type, '') IN ('auction_house', 'marketplace', 'platform');
    SELECT array_agg(DISTINCT ei.id) INTO ids
      FROM public.organization_external_profiles op
      JOIN public.external_identities ei ON ei.platform = 'bat' AND lower(ei.handle) = lower(op.username)
     WHERE op.organization_id = p_id AND op.platform IN ('bringatrailer', 'bat');
    subject := jsonb_build_object('kind', 'organization', 'id', o.id, 'name', o.business_name, 'type', o.business_type,
      'place', nullif(concat_ws(', ', nullif(o.city, ''), nullif(o.state, '')), ''), 'zip', o.zip_code, 'venue', venue,
      'handles', coalesce(array_length(ids, 1), 0));
  ELSIF p_kind = 'identity' THEN
    SELECT id, platform, handle, display_name INTO e FROM public.external_identities WHERE id = p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT array_agg(id) INTO ids FROM public.external_identities WHERE platform = e.platform AND lower(handle) = lower(e.handle);
    subject := jsonb_build_object('kind', 'identity', 'id', e.id, 'name', coalesce(nullif(e.display_name, ''), e.handle),
      'type', e.platform, 'place', NULL, 'zip', NULL, 'handle', e.handle, 'venue', false,
      'handles', coalesce(array_length(ids, 1), 0));
  ELSE
    RETURN NULL;
  END IF;

  -- 1. Selling from the lot rows, for any actor with identities: one per listing page.
  IF ids IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE sold), count(*) FILTER (WHERE NOT sold AND ended), max(last_at)
      INTO l_total, l_sold, l_unsold, l_last
      FROM (SELECT lower(regexp_replace(regexp_replace(ae.source_url, '[?#].*$', ''), '/+$', '')) AS u,
                   bool_or(ae.outcome = 'sold') AS sold,
                   bool_or(ae.outcome IN ('reserve_not_met', 'bid_to', 'no_sale')) AS ended,
                   max(coalesce(ae.scraped_at, ae.updated_at)) AS last_at
              FROM public.auction_events ae
             WHERE ae.seller_external_identity_id = ANY (ids) AND ae.source_url IS NOT NULL
             GROUP BY 1) l;
    -- The vehicle records behind those lots (a duplicate record of one car counts as its own), for answers to bidders.
    SELECT array_agg(DISTINCT ae.vehicle_id) FILTER (WHERE ae.vehicle_id IS NOT NULL) INTO l_vehicle_ids
      FROM public.auction_events ae
     WHERE ae.seller_external_identity_id = ANY (ids) AND ae.source_url IS NOT NULL;
  END IF;

  items := '[]'::jsonb;
  IF l_total > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Listings', 'unit', 'listings', 'value', l_total,
      'method', 'Bring a Trailer lots whose lot row names this actor''s handle as seller, one per listing page; a relist counts as its own listing; live lots count, without an outcome',
      'coverage', jsonb_build_object('n', l_total, 'of', l_total, 'grain', 'listing pages', 'as_of', l_last), 'rank', NULL);
    IF l_sold + l_unsold > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Sell-through', 'unit', '%', 'value', round(100.0 * l_sold / (l_sold + l_unsold), 1),
        'method', 'sold ÷ (sold + ended without a sale: reserve not met, bid to, no sale) on listing pages with a recorded outcome; no peer rank until a per-seller fold exists',
        'coverage', jsonb_build_object('n', l_sold + l_unsold, 'of', l_total, 'grain', 'listings with a recorded outcome', 'as_of', l_last), 'rank', NULL);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', l_sold + l_unsold, 'of', l_total, 'grain', 'listings with a recorded outcome', 'as_of', l_last),
      'items', items);
  ELSIF is_org THEN
    -- Fallback for an organization with no linked identity: the organization's seller-stats fold.
    SELECT * INTO s FROM public.organization_seller_stats WHERE organization_id = p_id;
    IF FOUND AND coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0) > 0 THEN
      SELECT count(*) FILTER (WHERE c.st IS NOT NULL) AS n, count(*) FILTER (WHERE c.st < me.st) AS lt,
             bool_or(c.organization_id = p_id) AS in_cohort,
             count(*) FILTER (WHERE c.st IS NOT NULL AND c.bt IN ('', 'other')) AS untyped
        INTO k
        FROM (SELECT ss.organization_id, coalesce(po.business_type, '') AS bt, ss.total_sold::numeric / nullif(coalesce(ss.total_sold, 0) + coalesce(ss.total_unsold, 0), 0) AS st
                FROM public.organization_seller_stats ss
                JOIN public.organizations po ON po.id = ss.organization_id AND po.is_public = true
                     AND coalesce(po.business_type, '') NOT IN ('auction_house', 'marketplace', 'platform')
               WHERE coalesce(ss.total_sold, 0) + coalesce(ss.total_unsold, 0) >= 5) c
        CROSS JOIN (SELECT s.total_sold::numeric / nullif(coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 0) AS st) me;
      items := items || jsonb_build_object(
        'label', 'Sell-through', 'unit', '%',
        'value', round(100.0 * s.total_sold / (coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0)), 1),
        'method', 'sold ÷ (sold + unsold) on organization-attributed listings with a recorded outcome (listing_activity_v1); '
                  || coalesce(s.evidence_summary->>'outcome_conflicts', '0') || ' outcome and '
                  || coalesce(s.evidence_summary->>'identity_conflicts', '0') || ' identity conflicts in its inputs; '
                  || CASE WHEN k.in_cohort AND k.n >= 2
                          THEN 'ranked among ' || k.n || ' public selling organizations with five or more recorded outcomes, venues excluded; '
                               || k.untyped || ' of the ' || k.n || ' carry no business type, so this is not a dealer-only peer group'
                          ELSE 'not ranked: fewer than five recorded outcomes' END,
        'coverage', jsonb_build_object('n', coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 'of', coalesce(s.total_listings, 0),
                                       'grain', 'listings with a recorded outcome',
                                       'as_of', coalesce(s.evidence_summary->>'latest_input_extracted_at', s.calculated_at::text)),
        'rank', CASE WHEN k.in_cohort AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt / (k.n - 1), 1), 'n', k.n) END);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 'of', coalesce(s.total_listings, 0),
                                     'grain', 'listings with a recorded outcome',
                                     'as_of', coalesce(s.evidence_summary->>'latest_input_extracted_at', s.calculated_at::text)),
      'items', items);
  ELSE
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', 0, 'of', 0, 'grain', 'listings', 'as_of', NULL), 'items', '[]'::jsonb);
  END IF;

  -- 2. Bidding (identity only): the dated snapshot, values without a percentile.
  IF NOT is_org THEN
    items := '[]'::jsonb;
    SELECT max(last_seen) INTO b_snap FROM public.mv_bidder_profiles;
    SELECT sum(auctions_entered), sum(total_bids), sum(wins) INTO b_entered, b_bids, b_wins
      FROM public.mv_bidder_profiles WHERE e.platform = 'bat' AND lower(bat_username) = lower(e.handle);
    IF coalesce(b_entered, 0) > 0 THEN
      SELECT count(*) AS n,
             count(*) FILTER (WHERE c.entered < b_entered) AS lt_entered,
             count(*) FILTER (WHERE c.wins < coalesce(b_wins, 0)) AS lt_wins,
             count(*) FILTER (WHERE c.wins::numeric / c.entered < coalesce(b_wins, 0)::numeric / b_entered) AS lt_rate
        INTO k
        FROM (SELECT sum(auctions_entered) AS entered, sum(wins) AS wins
                FROM public.mv_bidder_profiles GROUP BY lower(bat_username) HAVING sum(auctions_entered) >= 5) c;
      items := items || jsonb_build_object(
        'label', 'Auctions entered', 'unit', 'auctions', 'value', b_entered,
        'method', 'auctions the handle bid in, from the bidder profile snapshot, ranked among handles with five or more',
        'coverage', jsonb_build_object('n', b_entered, 'of', b_entered, 'grain', 'auctions entered', 'as_of', b_snap),
        'rank', CASE WHEN b_entered >= 5 AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_entered / (k.n - 1), 1), 'n', k.n) END);
      items := items || jsonb_build_object(
        'label', 'Wins', 'unit', 'auctions', 'value', coalesce(b_wins, 0),
        'method', 'auctions the handle won, from the bidder profile snapshot, ranked among handles with five or more auctions',
        'coverage', jsonb_build_object('n', b_entered, 'of', b_entered, 'grain', 'auctions entered', 'as_of', b_snap),
        'rank', CASE WHEN b_entered >= 5 AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_wins / (k.n - 1), 1), 'n', k.n) END);
      items := items || jsonb_build_object(
        'label', 'Win rate', 'unit', '%', 'value', round(100.0 * coalesce(b_wins, 0) / b_entered, 1),
        'method', 'wins ÷ auctions entered, from the bidder profile snapshot, ranked among handles with five or more auctions',
        'coverage', jsonb_build_object('n', b_entered, 'of', b_entered, 'grain', 'auctions entered', 'as_of', b_snap),
        'rank', CASE WHEN b_entered >= 5 AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_rate / (k.n - 1), 1), 'n', k.n) END);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'bidding', 'title', 'Bidding',
      'coverage', jsonb_build_object('n', coalesce(b_entered, 0), 'of', coalesce(b_entered, 0), 'grain', 'auctions entered in the bidder snapshot', 'as_of', b_snap),
      'items', items);
  END IF;

  -- 3. Talking: comments by the actor's identities; answers to bidders counted on its own listings only.
  IF ids IS NOT NULL THEN
    SELECT count(*), count(DISTINCT vehicle_id),
           count(*) FILTER (WHERE comment_type = 'seller_response' AND vehicle_id = ANY (coalesce(l_vehicle_ids, '{}'::uuid[])))
      INTO t_comments, t_lots, t_answers
      FROM public.auction_comments WHERE author_external_identity_id = ANY (ids);
    items := '[]'::jsonb;
    IF t_comments > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Comments', 'unit', 'comments', 'value', t_comments,
        'method', 'auction comments attributed to this actor''s handle',
        'coverage', jsonb_build_object('n', t_lots, 'of', t_lots, 'grain', 'lots commented on', 'as_of', v_now), 'rank', NULL);
      IF l_total > 0 THEN
        items := items || jsonb_build_object(
          'label', 'Answers to bidders per listing', 'unit', 'answers', 'value', round(t_answers::numeric / l_total, 1),
          'method', 'seller responses on the actor''s own listed vehicles ÷ its listings',
          'coverage', jsonb_build_object('n', t_answers, 'of', t_comments, 'grain', 'comments that answer bidders on its listings', 'as_of', v_now), 'rank', NULL);
      END IF;
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'talking', 'title', 'Talking',
      'coverage', jsonb_build_object('n', t_comments, 'of', t_comments, 'grain', 'attributed comments', 'as_of', v_now),
      'items', items);
  END IF;

  IF NOT is_org THEN
    RETURN jsonb_build_object('subject', subject, 'viewer', 'anon', 'read_at', v_now, 'sections', sections);
  END IF;

  -- 4. Organization vehicles: specialization, open books, roles. A venue or a very large organization is not
  -- aggregated at read time.
  SELECT count(*) INTO c_links FROM public.organization_vehicles WHERE organization_id = p_id;
  IF venue OR c_links > 5000 THEN
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'specialization', 'title', 'What they handle',
      'coverage', jsonb_build_object('n', 0, 'of', c_links,
                                     'grain', CASE WHEN venue THEN 'vehicle links; a venue lists other sellers'' vehicles, not aggregated'
                                                   ELSE 'vehicle links; more than 5,000, not aggregated at read time' END,
                                     'as_of', v_now),
      'items', '[]'::jsonb);
    RETURN jsonb_build_object('subject', subject, 'viewer', 'anon', 'read_at', v_now, 'sections', sections);
  END IF;

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
  dec AS (SELECT decade, count(*) AS n FROM av WHERE decade IS NOT NULL GROUP BY decade ORDER BY count(*) DESC, decade LIMIT 3),
  mk AS (SELECT make, count(*) AS n FROM av WHERE make IS NOT NULL GROUP BY make ORDER BY count(*) DESC, make LIMIT 3)
  SELECT count(*), count(decade), count(make),
         count(*) FILTER (WHERE sold), count(*) FILTER (WHERE sold AND has_amount),
         count(*) FILTER (WHERE NOT sold), count(*) FILTER (WHERE NOT sold AND has_cost),
         count(*) FILTER (WHERE has_amount AND has_cost),
         (SELECT jsonb_agg(jsonb_build_object('key', decade, 'n', n) ORDER BY n DESC, decade) FROM dec),
         (SELECT jsonb_agg(jsonb_build_object('key', make, 'n', n) ORDER BY n DESC, make) FROM mk)
    INTO c_total, c_year, c_make, c_sold, c_sold_amt, c_held, c_held_cost, c_both, top_decades, top_makes
    FROM av;

  items := '[]'::jsonb;
  IF top_decades IS NOT NULL THEN
    SELECT sum(count) INTO mkt_n FROM public.market_pulse('year', 300) WHERE name ~ '^[0-9]{4}$' AND name::int BETWEEN 1885 AND 2100;
    FOR r IN
      SELECT (d->>'key')::int AS decade, (d->>'n')::int AS n,
             (SELECT sum(count) FROM public.market_pulse('year', 300) m
               WHERE m.name ~ '^[0-9]{4}$' AND (m.name::int / 10) * 10 = (d->>'key')::int) AS mkt
        FROM jsonb_array_elements(top_decades) d
    LOOP
      IF coalesce(r.mkt, 0) > 0 AND coalesce(mkt_n, 0) > 0 THEN
        items := items || jsonb_build_object(
          'label', r.decade::text || 's', 'unit', '× market', 'value', round((r.n::numeric / c_year) / (r.mkt / mkt_n), 1),
          'method', 'share of the organization''s public vehicles from the decade ÷ the decade''s share of public vehicle records (market_pulse year counts)',
          'coverage', jsonb_build_object('n', r.n, 'of', c_year, 'grain', 'vehicles with a year', 'as_of', v_now), 'rank', NULL);
      END IF;
    END LOOP;
  END IF;
  IF top_makes IS NOT NULL THEN
    SELECT sum(count) INTO mkt_n FROM public.market_pulse('make', 400) WHERE lower(btrim(name)) <> 'unresolved';
    FOR r IN
      SELECT d->>'key' AS make, (d->>'n')::int AS n,
             (SELECT sum(count) FROM public.market_pulse('make', 400) m WHERE lower(btrim(m.name)) = d->>'key') AS mkt
        FROM jsonb_array_elements(top_makes) d
    LOOP
      IF coalesce(r.mkt, 0) > 0 AND coalesce(mkt_n, 0) > 0 THEN
        items := items || jsonb_build_object(
          'label', initcap(r.make), 'unit', '× market', 'value', round((r.n::numeric / c_make) / (r.mkt / mkt_n), 1),
          'method', 'share of the organization''s public vehicles of the make ÷ the make''s share of public vehicle records (market_pulse make counts)',
          'coverage', jsonb_build_object('n', r.n, 'of', c_make, 'grain', 'vehicles with a make', 'as_of', v_now), 'rank', NULL);
      END IF;
    END LOOP;
  END IF;
  sections := sections || jsonb_build_object(
    'kind', 'measures', 'stack', 'specialization', 'title', 'What they handle',
    'coverage', jsonb_build_object('n', c_year, 'of', c_total, 'grain', 'public vehicles linked as owner, seller or consigner', 'as_of', v_now),
    'items', items);

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

  RETURN jsonb_build_object('subject', subject, 'viewer', 'anon', 'read_at', v_now, 'sections', sections);
END;
$function$;

REVOKE ALL ON FUNCTION public.actor_profile_read(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actor_profile_read(text, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.actor_profile_read(text, uuid) IS
  'An actor (organization or market identity) as a kit document of measures: selling from its listing pages, bidding (dated snapshot, ranked), talking; for organizations also specialization against the market, open books as presence only and vehicles by role, not aggregated for venues or more than 5,000 links. One public projection; no amounts. Case ledger 13.11. 2026-10-14.';

-- The superseded org reader returned whole business rows (emails, phones, private organizations) to anyone.
DO $$ BEGIN
  IF to_regprocedure('public.get_org_profile_fast(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_org_profile_fast(uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE $c$COMMENT ON FUNCTION public.get_org_profile_fast(uuid) IS 'Superseded by actor_profile_read (2026-10-14) and revoked from PUBLIC, anon and authenticated: it returned whole business rows, contact details included.'$c$;
  END IF;
END $$;

RESET lock_timeout;
RESET statement_timeout;
