-- The owner-period fold skips what has no parent: lots whose vehicle no longer exists, identities that are not in external_identities.
--
-- The first real apply chunk failed and rolled back (23503, vehicle_ownerships_vehicle_id_fkey): auction_events.vehicle_id has
-- no foreign key, so sold lots can point at vehicles that were merged or deleted, and the dry run never inserts, so it could
-- not see it. Now:
--   * ownership_fold_plan reads only lots of vehicles that exist in public.vehicles, and treats a seller or winner id that is
--     not in public.external_identities as unkeyed (the same as a lot that names nobody), so no period can name a missing parent.
--     It also returns kind 'skip' rows (vehicle_missing per lot with its outcome; identity_missing per side with the id),
--     reported by the writer and never stored.
--   * fold_vehicle_ownership_periods takes FOR KEY SHARE locks on the parents it is about to reference, inserts only periods
--     whose vehicle and identity still exist, and reports lots_skipped_missing_vehicle, sold_lots_skipped_missing_vehicle,
--     vehicles_skipped_missing_vehicle, lots_with_missing_identity and identities_missing beside the existing counts.
--     The fold reports orphans instead of writing a flag row (a repair of the lots goes through the sanctioned writers).
-- Cloned from the live definitions, 2026-10-20: ownership_fold_plan md5 0a33490f (prefix),
-- fold_vehicle_ownership_periods md5 9c701628 (prefix). Function replacements only: same signatures,
-- same result columns, grants kept; no table lock.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

CREATE OR REPLACE FUNCTION public.ownership_fold_plan(p_vehicle_ids uuid[])
 RETURNS TABLE (
   kind text, vehicle_id uuid, owner_identity_id uuid, fold_key text,
   start_at timestamptz, end_at timestamptz, start_unknown boolean, end_unknown boolean, is_current boolean,
   start_clock_source text, end_clock_source text, acquired_via_lot_id uuid, disposed_via_lot_id uuid,
   chain_flag text, chain_peer_lot_id uuid, sale_confirmation text, listed_via_lot_id uuid, fold_hash text,
   flag_reason text, flag_lot_id uuid, flag_detail jsonb)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $$
WITH raw AS (
  SELECT a.id AS lot_id, a.vehicle_id, a.outcome, (a.outcome = 'sold') AS is_sold,
         coalesce(lower(substring(a.source_url from 'bringatrailer\.com/listing/([^/?#]+)')),
                  a.source || ':' || coalesce(a.source_url, a.id::text)) AS lot_key,
         coalesce(a.auction_end_date, ve.sold_at, ve.ended_at) AS clock,
         CASE WHEN a.auction_end_date IS NOT NULL THEN 'auction_events.auction_end_date'
              WHEN ve.sold_at IS NOT NULL THEN 'vehicle_events.sold_at'
              WHEN ve.ended_at IS NOT NULL THEN 'vehicle_events.ended_at' END AS clock_source,
         public.ownership_fold_party(es.id) AS seller,
         public.ownership_fold_party(ew.id) AS winner,
         a.seller_external_identity_id AS seller_ref, a.winning_bidder_external_identity_id AS winner_ref
    FROM public.auction_events a
    -- only vehicles that exist (auction_events.vehicle_id has no foreign key: a merged or deleted vehicle leaves lots behind)
    JOIN public.vehicles pv ON pv.id = a.vehicle_id
    -- an identity id that is not in external_identities is an unkeyed party, never an owner
    LEFT JOIN public.external_identities es ON es.id = a.seller_external_identity_id
    LEFT JOIN public.external_identities ew ON ew.id = a.winning_bidder_external_identity_id
    LEFT JOIN LATERAL (
      SELECT v.sold_at, v.ended_at FROM public.vehicle_events v
       WHERE a.auction_end_date IS NULL AND a.source_url IS NOT NULL AND v.source_url = a.source_url
       ORDER BY v.sold_at NULLS LAST, v.ended_at NULLS LAST, v.id LIMIT 1) ve ON true
   WHERE a.vehicle_id = ANY (p_vehicle_ids)
), ranked AS (
  -- one lot recorded twice: the sold copy first, then the earliest
  SELECT r.*, row_number() OVER w AS dup_rn,
         first_value(r.is_sold) OVER w AS first_sold, first_value(r.seller) OVER w AS first_seller,
         first_value(r.winner) OVER w AS first_winner, first_value(r.lot_id) OVER w AS kept_lot
    FROM raw r
  WINDOW w AS (PARTITION BY r.vehicle_id, r.lot_key ORDER BY (NOT r.is_sold), r.clock NULLS LAST, r.lot_id)
), kept AS (
  SELECT k.*, count(*) OVER tc AS same_clock_lots, count(*) FILTER (WHERE k.is_sold) OVER tc AS same_clock_sold
    FROM ranked k WHERE k.dup_rn = 1
  WINDOW tc AS (PARTITION BY k.vehicle_id, k.clock)
), blocks AS (
  SELECT k.vehicle_id, 'duplicate_lot_conflict'::text AS reason, k.lot_id, jsonb_build_object('lot_key', k.lot_key, 'kept_lot', k.kept_lot) AS detail
    FROM ranked k WHERE k.dup_rn > 1 AND k.is_sold AND k.first_sold
     AND (k.seller IS DISTINCT FROM k.first_seller OR k.winner IS DISTINCT FROM k.first_winner)
  UNION ALL
  SELECT k.vehicle_id, 'no_event_clock', k.lot_id, jsonb_build_object('lot_key', k.lot_key) FROM kept k WHERE k.is_sold AND k.clock IS NULL
  UNION ALL
  SELECT k.vehicle_id, 'same_clock', k.lot_id, jsonb_build_object('lot_key', k.lot_key)
    FROM kept k WHERE k.is_sold AND k.clock IS NOT NULL AND k.same_clock_sold > 1
), blocked AS (SELECT DISTINCT b.vehicle_id FROM blocks b),
unordered AS (
  -- an unsold lot with no clock, or on the clock of another lot, cannot be placed: listed, not used as evidence
  SELECT k.vehicle_id, k.lot_id, k.lot_key, k.outcome, (k.clock IS NULL) AS undated
    FROM kept k WHERE NOT k.is_sold AND (k.clock IS NULL OR k.same_clock_lots > 1)
), ok AS (
  SELECT k.* FROM kept k
   WHERE NOT EXISTS (SELECT 1 FROM blocked b WHERE b.vehicle_id = k.vehicle_id)
     AND NOT (NOT k.is_sold AND (k.clock IS NULL OR k.same_clock_lots > 1))
), seq AS (
  -- every ordered lot, sold or not: the next listing is the evidence about what the sale did
  SELECT o.*, lead(o.lot_id) OVER v AS nxt_lot, lead(o.seller) OVER v AS nxt_seller
    FROM ok o
  WINDOW v AS (PARTITION BY o.vehicle_id ORDER BY o.clock, o.lot_id)
), judged AS (
  SELECT s.*,
         -- the same seller lists the vehicle again: the recorded sale did not hand it on
         coalesce(s.is_sold AND s.seller IS NOT NULL AND s.nxt_seller = s.seller AND s.seller IS DISTINCT FROM s.winner, false) AS denied,
         -- the winner lists it next: the sale is confirmed
         coalesce(s.is_sold AND s.winner IS NOT NULL AND s.nxt_seller = s.winner, false) AS confirmed_by_next
    FROM seq s
), sold_seq AS (
  SELECT j.*, row_number() OVER (PARTITION BY j.vehicle_id ORDER BY j.clock, j.lot_id) AS ns FROM judged j WHERE j.is_sold
), eff AS (
  -- the sales that handed the vehicle on, in order
  SELECT d.*, row_number() OVER v AS n,
         lag(d.lot_id) OVER v AS prev_lot, lag(d.winner) OVER v AS prev_winner,
         lead(d.lot_id) OVER v AS next_lot, lead(d.seller) OVER v AS next_seller,
         lead(d.clock) OVER v AS next_clock, lead(d.clock_source) OVER v AS next_clock_source
    FROM sold_seq d WHERE NOT d.denied
  WINDOW v AS (PARTITION BY d.vehicle_id ORDER BY d.clock, d.lot_id)
), last_eff AS (
  SELECT DISTINCT ON (e.vehicle_id) e.vehicle_id, e.lot_id, e.winner, e.ns FROM eff e ORDER BY e.vehicle_id, e.n DESC
), held_open AS (
  -- after the last sale that handed the vehicle on, a seller relisted it: that seller holds it now
  SELECT DISTINCT ON (d.vehicle_id) d.vehicle_id, d.lot_id, d.seller, le.lot_id AS le_lot, le.winner AS le_winner
    FROM sold_seq d LEFT JOIN last_eff le ON le.vehicle_id = d.vehicle_id
   WHERE d.denied AND d.ns > coalesce(le.ns, 0) AND le.winner IS DISTINCT FROM d.seller
   ORDER BY d.vehicle_id, d.ns DESC
), periods AS (
  -- the winner of an effective sale holds from its clock, until the next effective sale when its seller is the same identity
  SELECT s.vehicle_id, s.winner AS owner, 'acq:' || s.lot_id AS fold_key,
         s.clock AS start_at,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_clock END AS end_at,
         false AS start_unknown,
         ((s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner) OR h.lot_id IS NOT NULL) AS end_unknown,
         (s.next_lot IS NULL AND h.lot_id IS NULL) AS is_current,
         s.clock_source AS start_clock_source,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_clock_source END AS end_clock_source,
         s.lot_id AS acquired_via_lot_id,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_lot END AS disposed_via_lot_id,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner
              THEN CASE WHEN s.next_seller IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END
              WHEN h.lot_id IS NOT NULL THEN 'handover_unobserved' END AS chain_flag,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner THEN s.next_lot
              WHEN h.lot_id IS NOT NULL THEN h.lot_id END AS chain_peer_lot_id,
         CASE WHEN s.confirmed_by_next OR (s.next_lot IS NOT NULL AND s.next_seller = s.winner)
              THEN 'confirmed_next_lot' ELSE 'recorded' END AS sale_confirmation,
         NULL::uuid AS listed_via_lot_id
    FROM eff s LEFT JOIN held_open h ON h.vehicle_id = s.vehicle_id AND s.next_lot IS NULL
   WHERE s.winner IS NOT NULL
  UNION ALL
  -- the seller of an effective sale held until its clock; its start is unknown unless it is the previous winner (already a period)
  SELECT s.vehicle_id, s.seller, 'sell:' || s.lot_id,
         NULL::timestamptz, s.clock, true, false, false,
         NULL::text, s.clock_source, NULL::uuid, s.lot_id,
         CASE WHEN s.n > 1 THEN CASE WHEN s.prev_winner IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END END,
         CASE WHEN s.n > 1 THEN s.prev_lot END, NULL::text, NULL::uuid
    FROM eff s WHERE s.seller IS NOT NULL AND (s.n = 1 OR s.prev_winner IS DISTINCT FROM s.seller)
  UNION ALL
  -- a seller who relisted after a sale that did not hand the vehicle on, with no effective sale after it
  SELECT h.vehicle_id, h.seller, 'held:' || h.lot_id,
         NULL::timestamptz, NULL::timestamptz, true, false, true,
         NULL::text, NULL::text, NULL::uuid, NULL::uuid,
         CASE WHEN h.le_lot IS NULL THEN NULL WHEN h.le_winner IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END,
         h.le_lot, NULL::text, h.lot_id
    FROM held_open h
), flags AS (
  SELECT k.vehicle_id, 'duplicate_lot'::text AS reason, k.lot_id, jsonb_build_object('lot_key', k.lot_key, 'kept_lot', k.kept_lot) AS detail
    FROM ranked k WHERE k.dup_rn > 1 AND k.is_sold AND k.first_sold
     AND k.seller IS NOT DISTINCT FROM k.first_seller AND k.winner IS NOT DISTINCT FROM k.first_winner
  UNION ALL SELECT b.vehicle_id, b.reason, b.lot_id, b.detail FROM blocks b
  UNION ALL
  SELECT j.vehicle_id, 'seller_is_winner', j.lot_id, jsonb_build_object('lot_key', j.lot_key)
    FROM judged j WHERE j.is_sold AND j.seller IS NOT NULL AND j.seller = j.winner
  UNION ALL
  SELECT j.vehicle_id, 'relist_same_seller', j.lot_id, jsonb_build_object('lot_key', j.lot_key, 'next_lot', j.nxt_lot)
    FROM judged j WHERE j.denied
  UNION ALL
  SELECT u.vehicle_id, 'unsold_lot_unordered', u.lot_id, jsonb_build_object('lot_key', u.lot_key, 'outcome', u.outcome, 'undated', u.undated)
    FROM unordered u
), skips AS (
  -- reported, never written: lots left behind by a vehicle that no longer exists, and identity ids that are not in external_identities
  SELECT a.vehicle_id, 'vehicle_missing'::text AS reason, a.id AS lot_id, jsonb_build_object('outcome', a.outcome) AS detail
    FROM public.auction_events a
   WHERE a.vehicle_id = ANY (p_vehicle_ids) AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = a.vehicle_id)
  UNION ALL
  SELECT r.vehicle_id, 'identity_missing', r.lot_id, jsonb_build_object('side', 'seller', 'identity', r.seller_ref)
    FROM raw r WHERE r.seller_ref IS NOT NULL AND r.seller IS NULL
  UNION ALL
  SELECT r.vehicle_id, 'identity_missing', r.lot_id, jsonb_build_object('side', 'winner', 'identity', r.winner_ref)
    FROM raw r WHERE r.winner_ref IS NOT NULL AND r.winner IS NULL
), clocked AS (
  SELECT k.vehicle_id, k.lot_id, k.clock, k.seller,
         lag(k.lot_id) OVER c AS p_lot, lag(k.is_sold) OVER c AS p_sold, lag(k.winner) OVER c AS p_winner,
         lag(k.seller) OVER c AS p_seller, lag(k.clock) OVER c AS p_clock
    FROM kept k WHERE k.clock IS NOT NULL
  WINDOW c AS (PARTITION BY k.vehicle_id ORDER BY k.clock, k.lot_id)
), links AS (
  -- how each lot relates to the lot before it, for every lot of every candidate vehicle: reported, never stored
  SELECT c.vehicle_id, c.lot_id,
         CASE WHEN c.p_lot IS NULL THEN 'first'
              WHEN c.p_clock = c.clock THEN 'date_error'
              WHEN NOT c.p_sold THEN 'prev_not_sold'
              WHEN c.p_winner IS NULL OR c.seller IS NULL THEN 'unkeyed'
              WHEN c.seller = c.p_winner THEN 'continuity'
              WHEN c.seller = c.p_seller THEN 'relist_same_seller'
              ELSE 'break' END AS state
    FROM clocked c
  UNION ALL
  SELECT k.vehicle_id, k.lot_id, 'undated' FROM kept k WHERE k.clock IS NULL
)
SELECT 'period'::text, p.vehicle_id, p.owner, p.fold_key, p.start_at, p.end_at, p.start_unknown, p.end_unknown, p.is_current,
       p.start_clock_source, p.end_clock_source, p.acquired_via_lot_id, p.disposed_via_lot_id, p.chain_flag, p.chain_peer_lot_id,
       p.sale_confirmation, p.listed_via_lot_id,
       md5(concat_ws('|', p.vehicle_id, p.owner, p.fold_key,
                     coalesce(extract(epoch FROM p.start_at)::text, '-'), coalesce(extract(epoch FROM p.end_at)::text, '-'),
                     p.start_unknown, p.end_unknown, p.is_current,
                     coalesce(p.start_clock_source, '-'), coalesce(p.end_clock_source, '-'),
                     coalesce(p.acquired_via_lot_id::text, '-'), coalesce(p.disposed_via_lot_id::text, '-'),
                     coalesce(p.chain_flag, '-'), coalesce(p.chain_peer_lot_id::text, '-'),
                     coalesce(p.sale_confirmation, '-'), coalesce(p.listed_via_lot_id::text, '-'))),
       NULL::text, NULL::uuid, NULL::jsonb
  FROM periods p
UNION ALL
SELECT 'flag', f.vehicle_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       f.reason, f.lot_id, f.detail
  FROM flags f
UNION ALL
SELECT 'skip', k.vehicle_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       k.reason, k.lot_id, k.detail
  FROM skips k
UNION ALL
SELECT 'link', l.vehicle_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       l.state, l.lot_id, NULL
  FROM links l
$$;
COMMENT ON FUNCTION public.ownership_fold_plan(uuid[]) IS
  'The owner periods, flags, lot links and skips the lots of the given vehicles support: pure and read-only, computed from auction_events of any outcome (clock fallback vehicle_events.sold_at/ended_at) for vehicles that exist, with identity ids missing from external_identities read as unkeyed. A sold lot is a recorded sale, not a completed transfer: when the next listing is by the same seller (relist_same_seller) the sale did not hand the vehicle on and no winner period starts; when the next listing is by the winner the sale is confirmed. Rows of kind period carry the columns of a vehicle_ownerships fold row; kind flag carries what the fold refused to guess or declined to fold; kind link classifies every lot against the lot before it (first, continuity, break, relist_same_seller, prev_not_sold, unkeyed, undated, date_error) and is only ever reported; kind skip lists lots of missing vehicles and missing identities and is only ever reported. fold_vehicle_ownership_periods applies it.';

CREATE OR REPLACE FUNCTION public.fold_vehicle_ownership_periods(
  p_after uuid DEFAULT NULL, p_limit integer DEFAULT 400, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ids uuid[];
  v_last uuid;
  v_now timestamptz := clock_timestamp();
  v_periods integer; v_insert integer; v_super integer; v_unchanged integer;
  v_flags jsonb; v_chain jsonb; v_unknown jsonb; v_links jsonb; v_conf jsonb; v_blocked integer; v_with_periods integer;
  v_skip_lots integer; v_skip_sold integer; v_skip_vehicles integer; v_ident_lots integer; v_ident_ids integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 2000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 2000';
  END IF;
  IF p_apply AND NOT pg_try_advisory_xact_lock(hashtext('fold_vehicle_ownership_periods')) THEN
    RETURN jsonb_build_object('applied', false, 'skipped', 'another fold run holds the lock', 'next_after', p_after);
  END IF;

  -- The next p_limit vehicles after the cursor that have a sold lot naming a seller or a winner.
  SELECT array_agg(t.vehicle_id ORDER BY t.vehicle_id) INTO v_ids FROM (
    SELECT a.vehicle_id FROM public.auction_events a
     WHERE a.vehicle_id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
       AND a.outcome = 'sold'
       AND (a.seller_external_identity_id IS NOT NULL OR a.winning_bidder_external_identity_id IS NOT NULL)
     GROUP BY a.vehicle_id ORDER BY a.vehicle_id LIMIT p_limit) t;
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('applied', p_apply, 'done', true, 'vehicles', 0, 'next_after', p_after);
  END IF;
  v_last := v_ids[array_upper(v_ids, 1)];

  DROP TABLE IF EXISTS _fold_plan;
  CREATE TEMP TABLE _fold_plan ON COMMIT DROP AS SELECT * FROM public.ownership_fold_plan(v_ids);
  DROP TABLE IF EXISTS _fold_live;
  CREATE TEMP TABLE _fold_live ON COMMIT DROP AS
    SELECT o.id, o.vehicle_id, o.fold_key, o.fold_hash FROM public.vehicle_ownerships o
     WHERE o.basis = 'auction_sale' AND o.superseded_at IS NULL AND o.vehicle_id = ANY (v_ids);

  SELECT count(*), count(DISTINCT p.vehicle_id) INTO v_periods, v_with_periods FROM _fold_plan p WHERE p.kind = 'period';
  SELECT count(*) INTO v_insert FROM _fold_plan p WHERE p.kind = 'period'
     AND NOT EXISTS (SELECT 1 FROM _fold_live l WHERE l.vehicle_id = p.vehicle_id AND l.fold_key = p.fold_key AND l.fold_hash = p.fold_hash);
  SELECT count(*) INTO v_super FROM _fold_live l
   WHERE NOT EXISTS (SELECT 1 FROM _fold_plan p WHERE p.kind = 'period' AND p.vehicle_id = l.vehicle_id AND p.fold_key = l.fold_key AND p.fold_hash = l.fold_hash);
  v_unchanged := v_periods - v_insert;
  SELECT coalesce(jsonb_object_agg(f.flag_reason, f.n), '{}'::jsonb) INTO v_flags
    FROM (SELECT flag_reason, count(*) AS n FROM _fold_plan WHERE kind = 'flag' GROUP BY 1) f;
  SELECT coalesce(jsonb_object_agg(f.flag_reason, f.n), '{}'::jsonb) INTO v_links
    FROM (SELECT flag_reason, count(*) AS n FROM _fold_plan WHERE kind = 'link' GROUP BY 1) f;
  SELECT coalesce(jsonb_object_agg(c.chain_flag, c.n), '{}'::jsonb) INTO v_chain
    FROM (SELECT chain_flag, count(*) AS n FROM _fold_plan WHERE kind = 'period' AND chain_flag IS NOT NULL GROUP BY 1) c;
  SELECT coalesce(jsonb_object_agg(c.sale_confirmation, c.n), '{}'::jsonb) INTO v_conf
    FROM (SELECT sale_confirmation, count(*) AS n FROM _fold_plan WHERE kind = 'period' AND sale_confirmation IS NOT NULL GROUP BY 1) c;
  SELECT jsonb_build_object('start_unknown', count(*) FILTER (WHERE start_unknown), 'end_unknown', count(*) FILTER (WHERE end_unknown),
                            'current', count(*) FILTER (WHERE is_current), 'held_by_relisting_seller', count(*) FILTER (WHERE fold_key LIKE 'held:%'))
    INTO v_unknown FROM _fold_plan WHERE kind = 'period';
  SELECT count(DISTINCT vehicle_id) INTO v_blocked FROM _fold_plan
   WHERE kind = 'flag' AND flag_reason IN ('duplicate_lot_conflict', 'no_event_clock', 'same_clock');

  SELECT count(*), count(*) FILTER (WHERE flag_detail ->> 'outcome' = 'sold'), count(DISTINCT vehicle_id)
    INTO v_skip_lots, v_skip_sold, v_skip_vehicles FROM _fold_plan WHERE kind = 'skip' AND flag_reason = 'vehicle_missing';
  SELECT count(DISTINCT flag_lot_id), count(DISTINCT flag_detail ->> 'identity') INTO v_ident_lots, v_ident_ids
    FROM _fold_plan WHERE kind = 'skip' AND flag_reason = 'identity_missing';

  IF p_apply THEN
    -- the parents exist now and stay while the rows are written (the same lock a foreign key check takes)
    PERFORM 1 FROM public.vehicles WHERE id = ANY (v_ids) ORDER BY id FOR KEY SHARE;
    PERFORM 1 FROM public.external_identities
     WHERE id IN (SELECT owner_identity_id FROM _fold_plan WHERE kind = 'period') ORDER BY id FOR KEY SHARE;
    -- 1. supersede what the plan no longer derives as written (the row is kept)
    UPDATE public.vehicle_ownerships o
       SET superseded_at = v_now, is_current = false,
           superseded_reason = CASE WHEN EXISTS (SELECT 1 FROM _fold_plan p WHERE p.kind = 'period' AND p.vehicle_id = l.vehicle_id AND p.fold_key = l.fold_key)
                                    THEN 'inputs_changed' ELSE 'no_longer_derived' END
      FROM _fold_live l
     WHERE o.id = l.id
       AND NOT EXISTS (SELECT 1 FROM _fold_plan p WHERE p.kind = 'period' AND p.vehicle_id = l.vehicle_id AND p.fold_key = l.fold_key AND p.fold_hash = l.fold_hash);
    -- 2. insert the periods that are new or changed
    INSERT INTO public.vehicle_ownerships (
      vehicle_id, owner_identity_id, role, is_current, start_date, end_date, proof_event_id, ownership_type, authority_score,
      basis, fold_key, fold_hash, start_unknown, end_unknown, start_at, end_at, start_clock_source, end_clock_source,
      acquired_via_lot_id, disposed_via_lot_id, chain_flag, chain_peer_lot_id, sale_confirmation, listed_via_lot_id, fold_run_at)
    SELECT p.vehicle_id, p.owner_identity_id, 'owner', p.is_current,
           (p.start_at AT TIME ZONE 'UTC')::date, (p.end_at AT TIME ZONE 'UTC')::date,
           coalesce(p.acquired_via_lot_id, p.disposed_via_lot_id, p.listed_via_lot_id), 'claimed_unverified', 20,
           'auction_sale', p.fold_key, p.fold_hash, p.start_unknown, p.end_unknown, p.start_at, p.end_at,
           p.start_clock_source, p.end_clock_source, p.acquired_via_lot_id, p.disposed_via_lot_id,
           p.chain_flag, p.chain_peer_lot_id, p.sale_confirmation, p.listed_via_lot_id, v_now
      FROM _fold_plan p
     WHERE p.kind = 'period'
       AND EXISTS (SELECT 1 FROM public.vehicles pv WHERE pv.id = p.vehicle_id)
       AND EXISTS (SELECT 1 FROM public.external_identities pi WHERE pi.id = p.owner_identity_id)
       AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships e
                        WHERE e.vehicle_id = p.vehicle_id AND e.fold_key = p.fold_key AND e.basis = 'auction_sale'
                          AND e.superseded_at IS NULL AND e.fold_hash = p.fold_hash);
    -- 3. point each superseded row at its replacement
    UPDATE public.vehicle_ownerships o SET superseded_by = n.id
      FROM public.vehicle_ownerships n
     WHERE o.vehicle_id = ANY (v_ids) AND o.basis = 'auction_sale' AND o.superseded_at = v_now AND o.superseded_by IS NULL
       AND n.vehicle_id = o.vehicle_id AND n.fold_key = o.fold_key AND n.basis = 'auction_sale' AND n.superseded_at IS NULL;
    -- 4. flags: resolve the ones no longer raised, open the new ones
    UPDATE public.ownership_fold_flags f SET resolved_at = v_now
     WHERE f.vehicle_id = ANY (v_ids) AND f.resolved_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM _fold_plan p WHERE p.kind = 'flag' AND p.vehicle_id = f.vehicle_id
                          AND p.flag_reason = f.reason AND p.flag_lot_id IS NOT DISTINCT FROM f.auction_event_id);
    INSERT INTO public.ownership_fold_flags (vehicle_id, auction_event_id, reason, detail, created_at)
    SELECT p.vehicle_id, p.flag_lot_id, p.flag_reason, p.flag_detail, v_now FROM _fold_plan p
     WHERE p.kind = 'flag'
       AND NOT EXISTS (SELECT 1 FROM public.ownership_fold_flags f WHERE f.vehicle_id = p.vehicle_id AND f.resolved_at IS NULL
                          AND f.reason = p.flag_reason AND f.auction_event_id IS NOT DISTINCT FROM p.flag_lot_id);
  END IF;

  RETURN jsonb_build_object(
    'applied', p_apply, 'done', false, 'vehicles', array_length(v_ids, 1), 'next_after', v_last,
    'periods', v_periods, 'vehicles_with_periods', v_with_periods, 'vehicles_not_folded', v_blocked,
    'would_insert', v_insert, 'would_supersede', v_super, 'unchanged', v_unchanged,
    'periods_by_state', v_unknown, 'chain_flags', v_chain, 'sale_confirmation', v_conf, 'flags', v_flags, 'link_states', v_links,
    'lots_skipped_missing_vehicle', v_skip_lots, 'sold_lots_skipped_missing_vehicle', v_skip_sold,
    'vehicles_skipped_missing_vehicle', v_skip_vehicles, 'lots_with_missing_identity', v_ident_lots, 'identities_missing', v_ident_ids);
END;
$function$;
COMMENT ON FUNCTION public.fold_vehicle_ownership_periods(uuid, integer, boolean) IS
  'The only writer of identity-keyed owner periods. Reads the next p_limit vehicles after p_after that have a sold lot naming a party, computes ownership_fold_plan, and with p_apply supersedes changed or dropped periods (rows kept), inserts new ones and opens or resolves flags, in one transaction under an advisory lock. Parents are locked FOR KEY SHARE before the insert and a period whose vehicle or identity is gone is not written. Without p_apply it only reports the counts, including how every lot links to the lot before it and how many lots were skipped for a missing vehicle or identity. Returns next_after for the following call; done is true past the last vehicle. Idempotent: unchanged periods are not rewritten.';

COMMIT;
