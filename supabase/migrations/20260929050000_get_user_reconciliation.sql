-- ============================================================================
-- get_user_reconciliation(p_user_id): one user's reconciliation breaks and books chain,
-- computed live from the records. Owner-only.
-- ============================================================================
--
-- WHY (2026-09-28/29): Skylar ruled that truth-and-reconciliation starts from the user, not
-- one car ("user first, skylar's data"), and that his profile is where the breaks show. The
-- break report existed only as a read-only draft query (session 871512de, breaks.sql v0:
-- 419 breaks, 51 errors on 2026-09-29). This function is that query, corrected, plus the
-- books chain he asked to see as steps (bank feeds -> QuickBooks review -> Nuke books ->
-- receipts -> cars with return per documented hour).
--
-- What it returns: one row per break class or books step, with a count, what it was
-- counted against, where the number comes from (source), when that source was last
-- written (as_of), plain-words notes and up to five example records. Nothing is stored:
-- it is a read over the records (SCHEMA_LAW §4: a view-shaped read; a function only
-- because it needs the caller's identity).
--
-- Corrections to v0, each measured on Skylar's account 2026-09-29:
--   * a lot counted once: auction_events holds some BaT lots twice (with and without a
--     trailing slash; 1985 Suburban b5a0c58a: 18 bids and a 0-bid twin), and v0 read the
--     empty twin. Lots are keyed on the URL without the slash and summed per vehicle, so a
--     car sold on two lots (Hot Rod 21ee373f: 51 + 11 bids) reconciles.
--   * "sold" is vehicles.canonical_outcome (the canonical-columns trigger's sale rule), so a
--     car with sale_status 'sold' and no auction_outcome is not flagged as an ask.
--   * photo count compares with what the image_count trigger counts (not duplicates, not
--     superseded), so only real drift shows.
--   * zero-minute work sessions are dropped as a break: documentation and inspection days
--     are zero by design (intent gate); documented hours come from photo bursts
--     (compute_active_minutes_burst_total, the method get_vehicle_documented_investment uses).
--   * VIN twins are back (v0 dropped them for want of an index; idx_vehicles_vin_upper
--     serves them). Short pre-1981 serials count as twins only with the same make.
--   * merged and deleted vehicle rows are left out.
--
-- Books chain sources: parent_company (the QuickBooks connection, owner_user_id; tokens
-- are never read), qb_transactions (lines pulled by quickbooks-connect), receipts and the
-- decisions receipts:reconcile records in receipts.raw_json.scope_history. Bank-feed status
-- and the QuickBooks "For review" queue are not readable through the QuickBooks API, so
-- those two steps say unknown rather than carry a number.
--
-- Access: SECURITY DEFINER so it can read across the tables it reconciles, gated inside:
-- rows only when auth.uid() is the subject user, or the caller holds the service role.
-- EXECUTE is revoked from PUBLIC and anon (anon gets a permission error, not rows);
-- another signed-in user gets zero rows.
--
-- Speed (Skylar's account, 2026-09-29, BaT loader running): vehicles section 8.0 s cold /
-- 0.32 s warm, account 5.4 s cold / 0.24 s warm, books 0.9 s. Cold reads are heap pages of
-- vehicle_images; together they come close to the 15 s API limit, so p_section lets the panel
-- fetch the three sections in parallel, each within its own limit.
--
-- Live verification after CI applies (read-only):
--   as anon (REST, anon key): POST /rest/v1/rpc/get_user_reconciliation -> 401/42501
--   set local role authenticated + claims sub=<other user>: 0 rows
--   set local role authenticated + claims sub=<subject>: rows, runtime < 3 s
--   service role with p_user_id: rows

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_user_reconciliation(p_user_id uuid DEFAULT NULL, p_section text DEFAULT NULL)
RETURNS TABLE (
  section  text,        -- 'vehicles' | 'account' | 'books' (p_section picks one; null = all)
  item     text,        -- stable key of the break class or books step
  label    text,        -- plain words
  severity text,        -- breaks: 'error' | 'warn'; books: 'ok' | 'warn' | 'blocked' | 'unknown'
  n        bigint,      -- how many (null = unknown)
  of_n     bigint,      -- counted against (vehicles checked, receipts held, ...)
  source   text,        -- where the number comes from
  as_of    timestamptz, -- when that source was last written or observed
  note     text,
  examples jsonb,       -- up to 5 records (vehicle_id, vehicle, rel, note) or per-car detail
  ord      int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := coalesce(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL
     OR NOT (auth.uid() IS NOT DISTINCT FROM v_uid OR coalesce(auth.role(), '') = 'service_role') THEN
    RETURN;
  END IF;

  IF p_section IS NULL OR p_section = 'vehicles' THEN
  -- <Q1> breaks per vehicle
  RETURN QUERY
  WITH mine AS (
    SELECT s.vehicle_id, min(s.pr) AS pr FROM (
      SELECT o.vehicle_id, 1 AS pr FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid AND o.is_current
      UNION ALL SELECT ov.vehicle_id, 1 FROM ownership_verifications ov WHERE ov.user_id = v_uid AND ov.status = 'approved'
      UNION ALL SELECT o.vehicle_id, 2 FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid AND o.is_current IS NOT TRUE
      UNION ALL SELECT d.vehicle_id, 2 FROM discovered_vehicles d
                WHERE d.user_id = v_uid AND d.is_active AND d.relationship_type = 'previously_owned'
      UNION ALL SELECT c.vehicle_id, 3 FROM vehicle_contributors c WHERE c.user_id = v_uid
      UNION ALL SELECT DISTINCT i.vehicle_id, 6 FROM vehicle_images i WHERE i.user_id = v_uid AND i.vehicle_id IS NOT NULL
    ) s WHERE s.vehicle_id IS NOT NULL GROUP BY s.vehicle_id
  ),
  handles AS (
    SELECT coalesce(array_agg(DISTINCT lower(x.handle)), '{}') AS h FROM external_identities x
    WHERE x.platform = 'bat' AND (x.claimed_by_user_id = v_uid OR x.user_id = v_uid)
  ),
  v AS (
    SELECT ve.id, concat_ws(' ', ve.year, ve.make, ve.model) AS name, ve.vin, ve.make,
           ve.bat_auction_url, ve.bat_seller, ve.sale_price, ve.sold_price, ve.bat_sold_price, ve.winning_bid,
           ve.asking_price, ve.canonical_outcome, ve.canonical_sold_price, ve.image_count,
           ve.provenance_metadata -> 'content_source' AS content_source, m.pr,
           -- the sale rule the canonical-columns trigger applies today; the stored canonical_outcome can predate it
           vehicle_sale_basis(ve.sale_status, ve.auction_outcome, ve.canonical_platform, ve.listing_url, ve.discovery_url,
                              ve.sale_price::numeric, ve.notes, ve.import_metadata, ve.created_at) AS basis,
           CASE m.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously owned' WHEN 3 THEN 'contributor'
                     ELSE 'your photos only' END AS rel
    FROM mine m JOIN vehicles ve ON ve.id = m.vehicle_id
    WHERE ve.status IS DISTINCT FROM 'deleted' AND ve.status IS DISTINCT FROM 'merged'
  ),
  lots AS (   -- one row per BaT lot; the same lot can sit in auction_events with and without a trailing slash
    SELECT e.vehicle_id, regexp_replace(lower(e.source_url), '/+$', '') AS lot,
           max(e.total_bids) AS bids, max(e.comments_count) AS comments, max(e.auction_end_date) AS ended,
           max(e.seller_name) AS seller
    FROM auction_events e
    WHERE e.vehicle_id IN (SELECT id FROM v) AND e.source = 'bat' AND e.source_url IS NOT NULL
    GROUP BY 1, 2
  ),
  ae AS (
    SELECT l.vehicle_id, count(*) AS lots, sum(l.bids) AS bids, sum(l.comments) AS comments,
           (array_agg(l.seller ORDER BY l.ended DESC NULLS LAST) FILTER (WHERE l.seller IS NOT NULL))[1] AS seller
    FROM lots l GROUP BY 1
  ),
  ac AS (
    SELECT c.vehicle_id, count(*) FILTER (WHERE c.comment_type = 'bid') AS bids, count(*) AS entries
    FROM auction_comments c WHERE c.vehicle_id IN (SELECT id FROM v) GROUP BY 1
  ),
  bb AS (SELECT b.vehicle_id, count(*) AS n FROM bat_bids b WHERE b.vehicle_id IN (SELECT id FROM v) GROUP BY 1),
  vi AS (
    SELECT i.vehicle_id,
           count(*) FILTER (WHERE i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE) AS held,
           count(*) FILTER (WHERE i.is_superseded IS NOT TRUE
                              AND (coalesce(i.is_external, false) OR i.image_url LIKE '%bringatrailer.com%')) AS hotlinked,
           count(*) FILTER (WHERE i.is_superseded IS NOT TRUE AND i.file_hash IS NULL
                              AND NOT coalesce(i.is_external, false)) AS hashless
    FROM vehicle_images i WHERE i.vehicle_id IN (SELECT id FROM v) GROUP BY 1
  ),
  vv AS (
    SELECT DISTINCT ON (x.vehicle_id) x.vehicle_id, x.estimated_value, x.valuation_date
    FROM vehicle_valuations x WHERE x.vehicle_id IN (SELECT id FROM v)
    ORDER BY x.vehicle_id, x.valuation_date DESC NULLS LAST
  ),
  lot_keys AS (
    SELECT DISTINCT regexp_replace(lower(v.bat_auction_url), '/+$', '') AS k FROM v WHERE v.bat_auction_url IS NOT NULL
  ),
  lot_twins AS (
    SELECT regexp_replace(lower(x.bat_auction_url), '/+$', '') AS k, count(*) AS n
    FROM vehicles x
    WHERE x.bat_auction_url = ANY (ARRAY(SELECT k FROM lot_keys UNION ALL SELECT k || '/' FROM lot_keys
                                         UNION ALL SELECT v.bat_auction_url FROM v WHERE v.bat_auction_url IS NOT NULL))
      AND x.status IS DISTINCT FROM 'merged' AND x.status IS DISTINCT FROM 'deleted'
    GROUP BY 1
  ),
  facts AS (
    SELECT v.id, v.name, v.rel, v.pr, f.*
    FROM v
    CROSS JOIN handles h
    LEFT JOIN ae ON ae.vehicle_id = v.id
    LEFT JOIN ac ON ac.vehicle_id = v.id
    LEFT JOIN bb ON bb.vehicle_id = v.id
    LEFT JOIN vi ON vi.vehicle_id = v.id
    LEFT JOIN vv ON vv.vehicle_id = v.id
    LEFT JOIN lot_twins lt ON lt.k = regexp_replace(lower(v.bat_auction_url), '/+$', '')
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM vehicles x
      WHERE v.vin IS NOT NULL AND length(v.vin) >= 6
        AND upper(x.vin) = upper(v.vin) AND x.vin IS NOT NULL AND x.deleted_at IS NULL
        AND x.id <> v.id AND x.status IS DISTINCT FROM 'merged' AND x.status IS DISTINCT FROM 'deleted'
        AND (length(v.vin) = 17 OR lower(x.make) IS NOT DISTINCT FROM lower(v.make))
    ) vt
    CROSS JOIN LATERAL (VALUES
      ('sale / ask stored as sale', 'Sale price on a car with no recorded sale', 'error',
       'vehicles.sale_price vs vehicle_sale_basis (a status must say money moved)',
       v.basis IS NULL AND v.sale_price IS NOT NULL,
       format('sale_price %s with no sale status%s', v.sale_price,
              CASE WHEN v.asking_price = v.sale_price THEN '; it equals the asking price' ELSE '' END), 10),

      ('sale / stale outcome', 'Marked sold, but the sale rule finds no sale', 'error',
       'vehicles.canonical_outcome vs vehicle_sale_basis',
       v.canonical_outcome = 'sold' AND v.basis IS NULL,
       format('canonical outcome sold at %s, written before the current sale rule', v.canonical_sold_price), 11),

      ('sale / columns disagree', 'Sale columns disagree on a sold car', 'error',
       'vehicles sale columns vs canonical_sold_price',
       v.basis IS NOT NULL AND (
            (v.sale_price IS NOT NULL AND v.sale_price <> v.canonical_sold_price)
         OR (v.sold_price IS NOT NULL AND v.sold_price <> v.canonical_sold_price)
         OR (v.bat_sold_price IS NOT NULL AND v.bat_sold_price <> v.canonical_sold_price)
         OR (v.winning_bid IS NOT NULL AND v.winning_bid <> v.canonical_sold_price)),
       concat_ws(' · ', 'canonical ' || v.canonical_sold_price, 'sale_price ' || v.sale_price, 'sold_price ' || v.sold_price,
                 'bat_sold_price ' || v.bat_sold_price, 'winning_bid ' || v.winning_bid), 12),

      ('identity / lot twins', 'More than one vehicle row on one BaT lot', 'error',
       'vehicles.bat_auction_url',
       coalesce(lt.n, 1) > 1,
       format('%s vehicle rows point at %s', lt.n, v.bat_auction_url), 13),

      ('identity / VIN twins', 'Another vehicle row carries the same VIN', 'error',
       'vehicles.vin',
       vt.n > 0,
       format('%s other row(s) with VIN %s', vt.n, v.vin), 14),

      ('auction / seller', 'Seller on the row does not match the lot page', 'error',
       'vehicles.bat_seller vs auction_events.seller_name',
       (ae.seller IS NOT NULL AND v.bat_seller IS NOT NULL AND lower(ae.seller) <> lower(v.bat_seller))
         OR (ae.seller IS NULL AND v.bat_seller IS NOT NULL AND v.rel = 'owner' AND NOT (lower(v.bat_seller) = ANY (h.h))),
       CASE WHEN ae.seller IS NOT NULL THEN format('row says %s, lot page says %s', v.bat_seller, ae.seller)
            ELSE format('seller %s is not one of your handles', v.bat_seller) END, 15),

      ('auction / bids', 'Bid rows held do not match the lot page', 'error',
       'auction_events.total_bids vs auction_comments (type bid)',
       ae.bids IS NOT NULL AND coalesce(ac.bids, 0) <> ae.bids,
       format('lot page %s bids on %s lot(s) · bid rows held %s', ae.bids, ae.lots, coalesce(ac.bids, 0)), 16),

      ('auction / comments', 'Comment rows held do not match the lot page', 'error',
       'auction_events.comments_count vs auction_comments',
       ae.comments IS NOT NULL AND coalesce(ac.entries, 0) <> ae.comments,
       format('lot page %s entries · rows held %s', ae.comments, coalesce(ac.entries, 0)), 17),

      ('auction / bids table', 'Bids table does not match the bid rows', 'error',
       'bat_bids vs auction_comments (type bid)',
       coalesce(ac.bids, 0) > 0 AND coalesce(bb.n, 0) <> ac.bids,
       format('bid rows %s · bids table %s%s', ac.bids, coalesce(bb.n, 0),
              CASE WHEN coalesce(bb.n, 0) = 0 THEN ' (bat_bids needs a bat_listings row the lot loader does not write)' ELSE '' END), 18),

      ('valuation / sold', 'Latest valuation far from the hammer price', 'error',
       'vehicle_valuations vs canonical_sold_price',
       v.basis IS NOT NULL AND vv.estimated_value IS NOT NULL AND v.canonical_sold_price > 0
         AND abs(vv.estimated_value - v.canonical_sold_price) / v.canonical_sold_price > 0.25,
       format('valuation %s from %s vs hammer %s', vv.estimated_value, vv.valuation_date::date, v.canonical_sold_price), 19),

      ('provenance / content source', 'Sold under your handle, credited to someone else', 'warn',
       'vehicles.provenance_metadata.content_source vs auction_events.seller_name',
       v.rel = 'owner' AND v.content_source ->> 'entity_type' = 'organization'
         AND ae.seller IS NOT NULL AND lower(ae.seller) = ANY (h.h),
       format('lot seller %s, row credits %s', ae.seller, v.content_source ->> 'entity'), 30),

      ('identity / no VIN', 'No VIN on record', 'warn',
       'vehicles.vin',
       v.vin IS NULL OR btrim(v.vin) = '',
       'no VIN', 31),

      ('photos / hashless', 'Photos with no content hash', 'warn',
       'vehicle_images.file_hash',
       coalesce(vi.hashless, 0) > 0,
       format('%s photos without a hash', vi.hashless), 32),

      ('photos / count drift', 'Photo count on the row does not match the photos held', 'warn',
       'vehicles.image_count vs vehicle_images',
       coalesce(v.image_count, 0) <> coalesce(vi.held, 0),
       format('row says %s, photos held %s', coalesce(v.image_count, 0), coalesce(vi.held, 0)), 33),

      ('photos / hotlinked', 'Lot photos linked to BaT, not held', 'warn',
       'vehicle_images.is_external',
       coalesce(vi.hotlinked, 0) > 0,
       format('%s photos are links with no bytes or hash held', vi.hotlinked), 34)
    ) AS f(item, label, severity, source, is_break, note, ord)
  )
  SELECT 'vehicles'::text, f.item, f.label, f.severity,
         count(*) FILTER (WHERE f.is_break), count(*), 'from ' || f.source, now(),
         NULL::text,
         to_jsonb((array_agg(jsonb_build_object('vehicle_id', f.id, 'vehicle', f.name, 'rel', f.rel, 'note', f.note)
                             ORDER BY f.pr, f.name) FILTER (WHERE f.is_break))[1:5]),
         f.ord
  FROM facts f
  GROUP BY f.item, f.label, f.severity, f.source, f.ord;
  -- </Q1>
  END IF;

  IF p_section IS NULL OR p_section = 'account' THEN
  -- <Q2> breaks at the account level (one pass over the user's photos)
  RETURN QUERY
  WITH imgs AS (
    SELECT i.vehicle_id, count(*) AS photos,
           count(*) FILTER (WHERE i.file_hash IS NULL AND NOT coalesce(i.is_external, false)) AS hashless,
           max(i.taken_at) AS newest
    FROM vehicle_images i WHERE i.user_id = v_uid AND i.is_superseded IS NOT TRUE
    GROUP BY 1
  ),
  p AS (
    SELECT coalesce(sum(m.photos), 0)::bigint AS total,
           coalesce(sum(m.photos) FILTER (WHERE m.vehicle_id IS NULL), 0)::bigint AS unfiled,
           coalesce(sum(m.hashless), 0)::bigint AS hashless,
           max(m.newest) AS newest,
           count(*) FILTER (WHERE m.vehicle_id IS NOT NULL) AS vehicles
    FROM imgs m
  ),
  linked AS (
    SELECT o.vehicle_id FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid
    UNION SELECT ov.vehicle_id FROM ownership_verifications ov WHERE ov.user_id = v_uid AND ov.status = 'approved'
    UNION SELECT d.vehicle_id FROM discovered_vehicles d WHERE d.user_id = v_uid AND d.is_active
    UNION SELECT c.vehicle_id FROM vehicle_contributors c WHERE c.user_id = v_uid
  ),
  photo_only AS (
    SELECT m.vehicle_id, m.photos FROM imgs m
    WHERE m.vehicle_id IS NOT NULL AND m.vehicle_id NOT IN (SELECT vehicle_id FROM linked WHERE vehicle_id IS NOT NULL)
  ),
  owner_rows AS (
    SELECT x.id, concat_ws(' ', x.year, x.make, x.model) AS name, x.status,
           x.id IN (SELECT vehicle_id FROM linked WHERE vehicle_id IS NOT NULL) AS has_record
    FROM vehicles x
    WHERE x.owner_id = v_uid AND x.status IS DISTINCT FROM 'merged' AND x.status IS DISTINCT FROM 'deleted'
  ),
  c AS (SELECT max(u.contribution_date) AS last FROM user_contributions u WHERE u.user_id = v_uid)
  SELECT 'account', 'photos / on no vehicle', 'Your photos on no vehicle', 'warn',
         p.unfiled, p.total, 'from vehicle_images (vehicle_id empty)', now(), NULL::text, NULL::jsonb, 40
  FROM p
  UNION ALL
  SELECT 'account', 'photos / hashless (all)', 'Your photos with no content hash', 'warn',
         p.hashless, p.total, 'from vehicle_images.file_hash', now(), NULL, NULL, 41
  FROM p
  UNION ALL
  SELECT 'account', 'photos / newest', 'Days since your newest photo', 'warn',
         CASE WHEN p.newest IS NULL THEN NULL ELSE (current_date - p.newest::date)::bigint END, NULL,
         'from vehicle_images.taken_at', p.newest, 'newest photo taken ' || to_char(p.newest, 'YYYY-MM-DD'), NULL, 42
  FROM p
  UNION ALL
  SELECT 'account', 'vehicles / photo-only', 'Vehicles with your photos but no ownership, contributor or discovery link to you', 'warn',
         (SELECT count(*) FROM photo_only), (SELECT p.vehicles FROM p),
         'from vehicle_images vs vehicle_ownerships, ownership_verifications, discovered_vehicles, vehicle_contributors', now(),
         NULL,
         (SELECT to_jsonb((array_agg(jsonb_build_object('vehicle_id', po.vehicle_id,
                    'vehicle', (SELECT concat_ws(' ', x.year, x.make, x.model) FROM vehicles x WHERE x.id = po.vehicle_id),
                    'note', po.photos || ' of your photos') ORDER BY po.photos DESC))[1:5]) FROM photo_only po),
         43
  UNION ALL
  SELECT 'account', 'ownership / owner_id without record', 'Rows naming you owner with no ownership record', 'warn',
         count(*) FILTER (WHERE NOT o.has_record), count(*),
         'from vehicles.owner_id vs vehicle_ownerships, ownership_verifications, discovered_vehicles, vehicle_contributors', now(),
         NULL,
         to_jsonb((array_agg(jsonb_build_object('vehicle_id', o.id, 'vehicle', o.name, 'note', 'status ' || coalesce(o.status, 'none'))
                             ORDER BY o.name) FILTER (WHERE NOT o.has_record))[1:5]),
         44
  FROM owner_rows o
  UNION ALL
  SELECT 'account', 'ledger / contributions', 'Days since the contribution ledger was written', 'warn',
         CASE WHEN c.last IS NULL THEN NULL ELSE (current_date - c.last::date)::bigint END, NULL,
         'from user_contributions.contribution_date', c.last::timestamptz,
         'last written ' || to_char(c.last, 'YYYY-MM-DD'), NULL, 45
  FROM c;
  -- </Q2>
  END IF;

  IF p_section IS NULL OR p_section = 'books' THEN
  -- <Q3> books chain
  RETURN QUERY
  WITH qb AS (
    SELECT pc.quickbooks_connected_at AS connected_at FROM parent_company pc
    WHERE pc.owner_user_id = v_uid AND pc.quickbooks_realm_id IS NOT NULL
    ORDER BY pc.quickbooks_connected_at DESC NULLS LAST LIMIT 1
  ),
  lines AS (
    SELECT count(*) AS n, count(t.vehicle_id) AS on_vehicle, min(t.date) AS first_line, max(t.date) AS last_line,
           greatest(max(t.created_at), max(t.updated_at)) AS last_pull
    FROM qb_transactions t WHERE EXISTS (SELECT 1 FROM qb)
  ),
  rc AS (
    SELECT r.id,
           (SELECT h FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.raw_json -> 'scope_history') = 'array'
                                                    THEN r.raw_json -> 'scope_history' END) WITH ORDINALITY AS x(h, i)
             WHERE h ->> 'reason' LIKE 'reconcile-v1%' ORDER BY x.i DESC LIMIT 1) AS d
    FROM receipts r
    WHERE r.user_id = v_uid AND r.is_superseded IS NOT TRUE AND r.is_active IS NOT FALSE
  ),
  rs AS (
    SELECT count(*) AS held, count(rc.d) AS decided,
           count(*) FILTER (WHERE rc.d IS NOT NULL AND rc.d ->> 'reason' NOT LIKE '%"unresolved":[]%') AS missing,
           max(CASE WHEN rc.d ->> 'at' ~ '^\d{4}-\d{2}-\d{2}' THEN (rc.d ->> 'at')::timestamptz END) AS last_decided
    FROM rc
  ),
  sold AS (
    SELECT ve.id, concat_ws(' ', ve.year, ve.make, ve.model) AS name, ve.canonical_sold_price AS sold_usd,
           (SELECT o.source_url FROM vehicle_observations o
             WHERE o.vehicle_id = ve.id AND o.kind = 'sale_result' AND o.is_superseded IS NOT TRUE AND o.source_url IS NOT NULL
             ORDER BY o.observed_at DESC LIMIT 1) AS sold_source,
           ve.purchase_price
    FROM vehicles ve
    WHERE vehicle_sale_basis(ve.sale_status, ve.auction_outcome, ve.canonical_platform, ve.listing_url, ve.discovery_url,
                             ve.sale_price::numeric, ve.notes, ve.import_metadata, ve.created_at) IS NOT NULL
      AND ve.status IS DISTINCT FROM 'merged' AND ve.status IS DISTINCT FROM 'deleted'
      AND ve.id IN (
        SELECT o.vehicle_id FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid
        UNION SELECT ov.vehicle_id FROM ownership_verifications ov WHERE ov.user_id = v_uid AND ov.status = 'approved'
        UNION SELECT d.vehicle_id FROM discovered_vehicles d
              WHERE d.user_id = v_uid AND d.is_active AND d.relationship_type = 'previously_owned')
  ),
  cars AS (
    SELECT s.*, round(compute_active_minutes_burst_total(s.id, 30) / 60.0, 1) AS hours,
           -- a purchase counts only when a live sale_result names this user as the buyer; vehicles.purchase_price has no source
           (SELECT CASE WHEN p.t ~ '^[0-9]+(\.[0-9]+)?$' THEN p.t::numeric END
              FROM vehicle_observations o
             CROSS JOIN LATERAL (SELECT coalesce(o.structured_data ->> 'sale_price_usd', o.structured_data ->> 'sale_price') AS t) p
             WHERE o.vehicle_id = s.id AND o.kind = 'sale_result' AND o.is_superseded IS NOT TRUE
               AND (o.structured_data ->> 'buyer_user_id' = v_uid::text
                    OR lower(o.structured_data ->> 'buyer_handle') IN (
                         SELECT lower(x.handle) FROM external_identities x
                          WHERE x.claimed_by_user_id = v_uid OR x.user_id = v_uid))
             ORDER BY o.observed_at DESC LIMIT 1) AS purchase_usd
    FROM sold s
  )
  SELECT 'books', 'books / bank feeds', 'Bank feeds into QuickBooks', 'unknown',
         NULL::bigint, NULL::bigint, 'QuickBooks Banking screen (not readable through the QuickBooks API)', qb.connected_at,
         'QuickBooks connected ' || to_char(qb.connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
           || '. Which bank feeds are connected or broken is shown only inside QuickBooks.', NULL::jsonb, 1
  FROM qb
  UNION ALL
  SELECT 'books', 'books / quickbooks review', 'Waiting in QuickBooks "For review"', 'unknown',
         NULL, NULL, 'QuickBooks Banking screen (not readable through the QuickBooks API)', NULL,
         'Bank items reach Nuke only after they are posted in QuickBooks.', NULL, 2
  FROM qb
  UNION ALL
  SELECT 'books', 'books / nuke books', 'Books lines in Nuke', CASE WHEN l.last_pull < now() - interval '7 days' THEN 'warn' ELSE 'ok' END,
         l.n, NULL, 'from QuickBooks pull ' || to_char(l.last_pull AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z (qb_transactions)',
         l.last_pull,
         format('lines dated %s to %s; %s of %s name a vehicle', l.first_line, l.last_line, l.on_vehicle, l.n), NULL, 3
  FROM lines l WHERE l.n > 0
  UNION ALL
  SELECT 'books', 'books / receipts', 'Receipts through receipts:reconcile', CASE WHEN rs.missing > 0 OR rs.decided < rs.held THEN 'warn' ELSE 'ok' END,
         rs.decided, rs.held, 'from receipts and receipts:reconcile decisions (receipts.raw_json.scope_history)', rs.last_decided,
         format('%s still missing evidence (who paid, or no matching books line); %s not yet run', rs.missing, rs.held - rs.decided),
         NULL, 4
  FROM rs WHERE rs.held > 0
  UNION ALL
  SELECT 'books', 'books / cars', 'Sold cars with a return per documented hour',
         CASE WHEN count(*) FILTER (WHERE c.purchase_usd IS NOT NULL AND c.hours > 0) = count(*) THEN 'ok' ELSE 'blocked' END,
         count(*) FILTER (WHERE c.purchase_usd IS NOT NULL AND c.hours > 0), count(*),
         'from sale records, sourced purchases and photo bursts (compute_active_minutes_burst_total)', now(),
         'Return per hour = (sale - purchase) / documented hours. It needs a sourced purchase price; vehicles.purchase_price carries no source.',
         jsonb_agg(jsonb_build_object(
           'vehicle_id', c.id, 'vehicle', c.name, 'sold_usd', c.sold_usd,
           'sold_source', coalesce(c.sold_source, 'vehicles.canonical_sold_price'),
           'hours', c.hours, 'purchase_usd', c.purchase_usd,
           'purchase_on_row_unsourced', CASE WHEN c.purchase_usd IS NULL THEN c.purchase_price END,
           'return_per_hour', CASE WHEN c.purchase_usd IS NOT NULL AND c.hours > 0
                                   THEN round((c.sold_usd - c.purchase_usd) / c.hours, 2) END,
           'blocked_on', CASE WHEN c.purchase_usd IS NULL THEN 'purchase price has no source'
                              WHEN c.hours = 0 THEN 'no documented hours' END)
           ORDER BY c.sold_usd DESC NULLS LAST),
         5
  FROM cars c HAVING count(*) > 0;
  -- </Q3>
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_user_reconciliation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_reconciliation(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_reconciliation(uuid, text) IS
  'One user''s reconciliation breaks (per vehicle and account) and books chain, computed live. Rows only for the subject user (auth.uid()) or the service role; anon has no EXECUTE. Read-only. Migration 20260929050000.';
