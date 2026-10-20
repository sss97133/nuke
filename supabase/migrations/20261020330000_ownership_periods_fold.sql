-- Owner periods folded from completed sales: vehicle_ownerships gains identity-keyed periods, with a pure plan, a
-- resumable superseding writer, and a flag table for what the fold refuses to guess.
--
-- Measured 2026-10-20 (live reads, bounded):
--   * vehicle_ownerships: 13 rows, no working writer, keyed only by owner_profile_id (a user). Its two sync triggers name
--     ON CONFLICT (vehicle_id, owner_profile_id), which has no unique index, and from_owner_id, which ownership_transfers
--     does not have; both swallow their error. Every reader filters owner_profile_id = a user, except
--     v_vehicle_ownership_status (LEFT JOIN on the current row, role owner) and the vehicle ownership popup (reads every
--     row of a vehicle).
--   * auction_events sold lots: BaT 195,650. Seller identity is keyed on 191,906, winner identity on 192,306; 47,872 of
--     the BaT sold lots have no auction_end_date, and vehicle_events.sold_at (same source_url) agrees with
--     auction_end_date within a day on 381 of 383 sampled lots, so it is the declared fallback clock.
--   * external_identities: 2 of them are claimed by a user (claim_confidence 1 and 100).
--   * ownership_transfers.sale_date is the lot end time or, for backfilled lots, the row write time (77,125 of 185,189
--     in_progress rows have a sale_date inside the last 30 days). It is not an event clock; the fold reads the lots.
--
-- Decision: extend vehicle_ownerships (same grain, one row per owner period) instead of minting a periods table.
--   * owner_profile_id becomes nullable; owner_identity_id (FK external_identities) is added; exactly one is set.
--   * A fold row is keyed by the identity the lot named. A user who claimed the identity is read through
--     v_vehicle_owner_periods (resolved_profile_id), so the profile-keyed readers (garage, reconciliation, possession,
--     ownership rights) never see an unverified auction period as the user's own holding.
--   * Rows are never deleted: a re-run supersedes (superseded_at, superseded_by, superseded_reason) and keeps the prior row.
--   * Cloned from the live definitions, 2026-10-20: set_single_current_owner() md5 63b70426, v_vehicle_ownership_status
--     md5 a699bc63. The trigger no longer lets an identity-keyed row end a user's current ownership, and the status view
--     no longer joins identity-keyed rows.
--
-- What the fold does (ownership_fold_plan, pure and read-only; fold_vehicle_ownership_periods, the only writer):
--   For each vehicle it orders the sold lots by event clock (auction_end_date, else vehicle_events.sold_at/ended_at).
--   The winner of lot N holds from lot N's clock; the seller of lot N held until it. When the next lot's seller is the
--   previous winner the periods join; when it is a different identity both periods are kept, the earlier one's end is
--   unknown, and both carry chain_flag handover_unobserved with the neighbouring lot (the join point for a bridge
--   between two handles of one party: ownership_fold_party()). A first seller, or a seller who was not the previous
--   winner, has start_unknown. A vehicle with a lot that has no clock, two lots on one clock, or one lot recorded twice
--   with different parties is not folded at all and gets a flag row instead. Lots that are not sold are never read.
--
-- Not done here: no backfill (scripts/data/fold-ownership-periods.mjs runs it in id chunks), no edge-function edit.
-- The transfer status change is at the end: a new enum value and an unrun relabel function.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

-- New enum values are usable only once committed, so they are added before the transaction below.
DO $$ BEGIN
  IF to_regtype('public.transfer_status') IS NOT NULL THEN
    ALTER TYPE public.transfer_status ADD VALUE IF NOT EXISTS 'recorded_unconfirmed' AFTER 'stalled';
  END IF;
  IF to_regtype('public.milestone_status') IS NOT NULL THEN
    ALTER TYPE public.milestone_status ADD VALUE IF NOT EXISTS 'not_observable' AFTER 'overdue';
  END IF;
END $$;

BEGIN;

-- 1. vehicle_ownerships holds identity-keyed periods ---------------------------------------------------------------

ALTER TABLE public.vehicle_ownerships
  ALTER COLUMN owner_profile_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS owner_identity_id uuid REFERENCES public.external_identities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS basis text,
  ADD COLUMN IF NOT EXISTS fold_key text,
  ADD COLUMN IF NOT EXISTS fold_hash text,
  ADD COLUMN IF NOT EXISTS start_unknown boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS end_unknown boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_at timestamptz,
  ADD COLUMN IF NOT EXISTS start_clock_source text,
  ADD COLUMN IF NOT EXISTS end_clock_source text,
  ADD COLUMN IF NOT EXISTS acquired_via_lot_id uuid,
  ADD COLUMN IF NOT EXISTS disposed_via_lot_id uuid,
  ADD COLUMN IF NOT EXISTS chain_flag text,
  ADD COLUMN IF NOT EXISTS chain_peer_lot_id uuid,
  ADD COLUMN IF NOT EXISTS fold_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.vehicle_ownerships(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_ownerships_one_owner_key') THEN
    ALTER TABLE public.vehicle_ownerships ADD CONSTRAINT vehicle_ownerships_one_owner_key
      CHECK (num_nonnulls(owner_profile_id, owner_identity_id) = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_ownerships_fold_shape') THEN
    ALTER TABLE public.vehicle_ownerships ADD CONSTRAINT vehicle_ownerships_fold_shape CHECK (
      (basis IS NULL) = (owner_identity_id IS NULL)
      AND (basis IS NULL OR basis IN ('auction_sale'))
      AND (basis IS NULL OR (fold_key IS NOT NULL AND fold_hash IS NOT NULL))
      AND (NOT start_unknown OR (start_at IS NULL AND start_date IS NULL))
      AND (basis IS NULL OR start_unknown OR start_at IS NOT NULL)
      AND (NOT end_unknown OR (end_at IS NULL AND end_date IS NULL))
      AND (chain_flag IS NULL OR chain_flag IN ('handover_unobserved', 'party_unkeyed'))
      AND (superseded_by IS NULL OR superseded_at IS NOT NULL)
      AND (superseded_at IS NULL OR NOT is_current));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_ownerships_fold_key
  ON public.vehicle_ownerships (vehicle_id, fold_key) WHERE basis IS NOT NULL AND superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_ownerships_fold_current
  ON public.vehicle_ownerships (vehicle_id) WHERE basis IS NOT NULL AND is_current AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_ownerships_identity
  ON public.vehicle_ownerships (owner_identity_id) WHERE owner_identity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_ownerships_acquired_lot
  ON public.vehicle_ownerships (acquired_via_lot_id) WHERE acquired_via_lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_ownerships_disposed_lot
  ON public.vehicle_ownerships (disposed_via_lot_id) WHERE disposed_via_lot_id IS NOT NULL;

-- A signed-in user who uploaded a vehicle can write that vehicle's user-keyed ownership rows (existing policies).
-- Fold rows are derived and written only by fold_vehicle_ownership_periods; the restrictive policies keep them out of reach.
DROP POLICY IF EXISTS vehicle_ownerships_fold_rows_insert_guard ON public.vehicle_ownerships;
CREATE POLICY vehicle_ownerships_fold_rows_insert_guard ON public.vehicle_ownerships AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (owner_identity_id IS NULL AND basis IS NULL);
DROP POLICY IF EXISTS vehicle_ownerships_fold_rows_update_guard ON public.vehicle_ownerships;
CREATE POLICY vehicle_ownerships_fold_rows_update_guard ON public.vehicle_ownerships AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (owner_identity_id IS NULL AND basis IS NULL)
  WITH CHECK (owner_identity_id IS NULL AND basis IS NULL);

COMMENT ON COLUMN public.vehicle_ownerships.owner_profile_id IS
  'The user who held the vehicle. Null on a fold row, which is keyed by owner_identity_id instead; exactly one of the two is set. A user who claimed the identity is read through v_vehicle_owner_periods.resolved_profile_id.';
COMMENT ON COLUMN public.vehicle_ownerships.owner_identity_id IS
  'The external identity (a platform handle) a sold lot named as seller or winner. Set only by fold_vehicle_ownership_periods; an identity is a handle, not a person, so two handles of one party stay two keys until a bridge says otherwise (ownership_fold_party).';
COMMENT ON COLUMN public.vehicle_ownerships.basis IS
  'What produced the row. Null: a user-keyed row written by verification or title review. auction_sale: folded from the sold lots of the vehicle. Fold rows are testimony of one platform, not title.';
COMMENT ON COLUMN public.vehicle_ownerships.fold_key IS
  'Identity of a period inside its vehicle: acq:<lot> for a winner from that lot, sell:<lot> for a seller whose start is unknown. Unique per vehicle while not superseded.';
COMMENT ON COLUMN public.vehicle_ownerships.fold_hash IS
  'md5 of every field the fold derived for the period. An unchanged hash on a re-run means no write; a changed one supersedes the row.';
COMMENT ON COLUMN public.vehicle_ownerships.start_unknown IS
  'The start is not observed: a first seller, or a seller who was not the previous winner. start_at and start_date stay null; no date is guessed.';
COMMENT ON COLUMN public.vehicle_ownerships.end_unknown IS
  'The holder stopped holding at an unobserved handover before the next sold lot (chain_peer_lot_id), not at a recorded sale. end_at and end_date stay null.';
COMMENT ON COLUMN public.vehicle_ownerships.start_at IS 'Event clock of the acquiring lot (hammer time); start_date is its UTC day.';
COMMENT ON COLUMN public.vehicle_ownerships.end_at IS 'Event clock of the lot at which the holder sold; end_date is its UTC day.';
COMMENT ON COLUMN public.vehicle_ownerships.start_clock_source IS 'Which column gave start_at: auction_events.auction_end_date, else vehicle_events.sold_at or ended_at.';
COMMENT ON COLUMN public.vehicle_ownerships.end_clock_source IS 'Which column gave end_at, as start_clock_source.';
COMMENT ON COLUMN public.vehicle_ownerships.acquired_via_lot_id IS 'auction_events.id of the sold lot this holder won (a locator, not a foreign key, like proof_event_id: lot corrections delete rows).';
COMMENT ON COLUMN public.vehicle_ownerships.disposed_via_lot_id IS 'auction_events.id of the sold lot this holder sold, when that lot names it as seller.';
COMMENT ON COLUMN public.vehicle_ownerships.chain_flag IS
  'handover_unobserved: the neighbouring lot names a different identity than this period ends or starts with, so the chain has a gap (two handles of one party, or a private sale between, cannot be told apart yet). party_unkeyed: the neighbouring lot names no identity at all.';
COMMENT ON COLUMN public.vehicle_ownerships.chain_peer_lot_id IS 'The neighbouring sold lot the chain_flag is about.';
COMMENT ON COLUMN public.vehicle_ownerships.fold_run_at IS 'When fold_vehicle_ownership_periods wrote the row.';
COMMENT ON COLUMN public.vehicle_ownerships.superseded_at IS 'A later fold run replaced or dropped this period; the row is kept. Readers take rows where this is null.';
COMMENT ON COLUMN public.vehicle_ownerships.superseded_by IS 'The row that replaced it (same fold_key), null when the period is no longer derived.';
COMMENT ON COLUMN public.vehicle_ownerships.superseded_reason IS 'inputs_changed: the same period derived differently. no_longer_derived: the lots no longer support it.';

-- A fold row must not end a user's current ownership, and must not be ended by one.
CREATE OR REPLACE FUNCTION public.set_single_current_owner()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Identity-keyed fold rows keep their own currentness (one open period per vehicle, enforced by an index).
  if NEW.owner_identity_id is not null then
    NEW.updated_at := now();
    return NEW;
  end if;
  if NEW.is_current then
    update public.vehicle_ownerships
       set is_current = false, end_date = coalesce(end_date, NEW.start_date)
     where vehicle_id = NEW.vehicle_id and id <> NEW.id and is_current = true and owner_identity_id is null;
  end if;
  NEW.updated_at := now();
  return NEW;
end; $function$;

-- The status view reads the user-keyed current owner; a fold row has no profile to show.
CREATE OR REPLACE VIEW public.v_vehicle_ownership_status WITH (security_invoker = true) AS
 SELECT v.id AS vehicle_id,
    v.year,
    v.make,
    v.model,
    v.vin,
    ov_title.user_id AS title_holder_id,
    ov_title.status AS title_status,
    ov_title.approved_at AS title_verified_at,
    vo.owner_profile_id AS current_owner_id,
    vo.ownership_type,
    vo.authority_score,
    vo.start_date AS ownership_start,
    NULL::uuid AS likely_possessor_id,
        CASE
            WHEN ((ov_title.user_id IS NOT NULL) AND (vo.owner_profile_id IS NOT NULL) AND (ov_title.user_id <> vo.owner_profile_id)) THEN true
            ELSE false
        END AS has_ownership_conflict
   FROM ((vehicles v
     LEFT JOIN ownership_verifications ov_title ON (((ov_title.vehicle_id = v.id) AND (ov_title.status = 'approved'::text) AND (ov_title.verification_category = 'title_document'::text))))
     LEFT JOIN vehicle_ownerships vo ON (((vo.vehicle_id = v.id) AND (vo.is_current = true) AND (vo.owner_profile_id IS NOT NULL) AND (vo.role = ANY (ARRAY['owner'::text, 'verified_owner'::text])))));

-- 2. What the fold refuses to guess ---------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ownership_fold_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  auction_event_id uuid,
  reason text NOT NULL CHECK (reason IN ('duplicate_lot', 'duplicate_lot_conflict', 'no_event_clock', 'same_clock', 'seller_is_winner')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ownership_fold_flags_open ON public.ownership_fold_flags (vehicle_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ownership_fold_flags_lot ON public.ownership_fold_flags (auction_event_id) WHERE auction_event_id IS NOT NULL;
ALTER TABLE public.ownership_fold_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ownership_fold_flags FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ownership_fold_flags TO service_role;

COMMENT ON TABLE public.ownership_fold_flags IS
  'Lots and vehicles the owner-period fold refused to fold, with the reason (grain: vehicle x lot x reason, open while resolved_at is null). duplicate_lot: one lot held twice with the same parties, the first is read. duplicate_lot_conflict, no_event_clock, same_clock: the vehicle is not folded because the order or the parties cannot be told. seller_is_winner: the lot names one identity on both sides, read as written. Writer: fold_vehicle_ownership_periods. Reader: operators; a flag is a to-do, not a verdict.';
COMMENT ON COLUMN public.ownership_fold_flags.vehicle_id IS 'The vehicle the flag is about (FK vehicles).';
COMMENT ON COLUMN public.ownership_fold_flags.auction_event_id IS 'The lot the flag is about, a locator into auction_events; null never happens today.';
COMMENT ON COLUMN public.ownership_fold_flags.reason IS 'duplicate_lot, duplicate_lot_conflict, no_event_clock, same_clock or seller_is_winner.';
COMMENT ON COLUMN public.ownership_fold_flags.detail IS 'Public facts only: the lot key and the lot that was kept; never a name.';
COMMENT ON COLUMN public.ownership_fold_flags.created_at IS 'When the fold first raised the flag.';
COMMENT ON COLUMN public.ownership_fold_flags.resolved_at IS 'When a later fold run no longer raised it. The row is kept.';
COMMENT ON COLUMN public.ownership_fold_flags.id IS 'Primary key.';

-- 3. The join point for task "same party, two handles" ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ownership_fold_party(p_identity uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $$ SELECT p_identity $$;
COMMENT ON FUNCTION public.ownership_fold_party(uuid) IS
  'The party an external identity stands for in the owner-period fold. Today it is the identity itself. An evidenced bridge between handles of one party replaces this body (CREATE OR REPLACE) so the chain closes across them; the fold hash includes the result, so a changed answer supersedes the affected periods.';

-- 4. The plan: pure, read-only ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ownership_fold_plan(p_vehicle_ids uuid[])
 RETURNS TABLE (
   kind text, vehicle_id uuid, owner_identity_id uuid, fold_key text,
   start_at timestamptz, end_at timestamptz, start_unknown boolean, end_unknown boolean, is_current boolean,
   start_clock_source text, end_clock_source text, acquired_via_lot_id uuid, disposed_via_lot_id uuid,
   chain_flag text, chain_peer_lot_id uuid, fold_hash text,
   flag_reason text, flag_lot_id uuid, flag_detail jsonb)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $$
WITH raw AS (
  SELECT a.id AS lot_id, a.vehicle_id,
         coalesce(lower(substring(a.source_url from 'bringatrailer\.com/listing/([^/?#]+)')),
                  a.source || ':' || coalesce(a.source_url, a.id::text)) AS lot_key,
         coalesce(a.auction_end_date, ve.sold_at, ve.ended_at) AS clock,
         CASE WHEN a.auction_end_date IS NOT NULL THEN 'auction_events.auction_end_date'
              WHEN ve.sold_at IS NOT NULL THEN 'vehicle_events.sold_at'
              WHEN ve.ended_at IS NOT NULL THEN 'vehicle_events.ended_at' END AS clock_source,
         public.ownership_fold_party(a.seller_external_identity_id) AS seller,
         public.ownership_fold_party(a.winning_bidder_external_identity_id) AS winner
    FROM public.auction_events a
    LEFT JOIN LATERAL (
      SELECT v.sold_at, v.ended_at FROM public.vehicle_events v
       WHERE a.auction_end_date IS NULL AND a.source_url IS NOT NULL AND v.source_url = a.source_url
       ORDER BY v.sold_at NULLS LAST, v.ended_at NULLS LAST, v.id LIMIT 1) ve ON true
   WHERE a.vehicle_id = ANY (p_vehicle_ids) AND a.outcome = 'sold'
), ranked AS (
  SELECT r.*, row_number() OVER w AS dup_rn,
         first_value(r.seller) OVER w AS first_seller, first_value(r.winner) OVER w AS first_winner,
         first_value(r.lot_id) OVER w AS kept_lot
    FROM raw r
  WINDOW w AS (PARTITION BY r.vehicle_id, r.lot_key ORDER BY r.clock NULLS LAST, r.lot_id)
), ties AS (
  SELECT x.vehicle_id, x.lot_id, x.lot_key FROM (
    SELECT k.vehicle_id, k.lot_id, k.lot_key, count(*) OVER (PARTITION BY k.vehicle_id, k.clock) AS c
      FROM ranked k WHERE k.dup_rn = 1 AND k.clock IS NOT NULL) x WHERE x.c > 1
), blocks AS (
  SELECT k.vehicle_id, 'duplicate_lot_conflict'::text AS reason, k.lot_id, jsonb_build_object('lot_key', k.lot_key, 'kept_lot', k.kept_lot) AS detail
    FROM ranked k WHERE k.dup_rn > 1 AND (k.seller IS DISTINCT FROM k.first_seller OR k.winner IS DISTINCT FROM k.first_winner)
  UNION ALL
  SELECT k.vehicle_id, 'no_event_clock', k.lot_id, jsonb_build_object('lot_key', k.lot_key)
    FROM ranked k WHERE k.dup_rn = 1 AND k.clock IS NULL
  UNION ALL
  SELECT t.vehicle_id, 'same_clock', t.lot_id, jsonb_build_object('lot_key', t.lot_key) FROM ties t
), blocked AS (SELECT DISTINCT b.vehicle_id FROM blocks b),
ok AS (
  SELECT k.* FROM ranked k WHERE k.dup_rn = 1 AND NOT EXISTS (SELECT 1 FROM blocked b WHERE b.vehicle_id = k.vehicle_id)
), seq AS (
  SELECT o.*, row_number() OVER v AS n,
         lag(o.lot_id) OVER v AS prev_lot, lag(o.winner) OVER v AS prev_winner,
         lead(o.lot_id) OVER v AS next_lot, lead(o.seller) OVER v AS next_seller,
         lead(o.clock) OVER v AS next_clock, lead(o.clock_source) OVER v AS next_clock_source
    FROM ok o
  WINDOW v AS (PARTITION BY o.vehicle_id ORDER BY o.clock, o.lot_id)
), periods AS (
  -- the winner of the lot holds from its clock, until the next lot when that lot's seller is the same identity
  SELECT s.vehicle_id, s.winner AS owner, 'acq:' || s.lot_id AS fold_key,
         s.clock AS start_at,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_clock END AS end_at,
         false AS start_unknown,
         (s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner) AS end_unknown,
         (s.next_lot IS NULL) AS is_current,
         s.clock_source AS start_clock_source,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_clock_source END AS end_clock_source,
         s.lot_id AS acquired_via_lot_id,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_lot END AS disposed_via_lot_id,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner
              THEN CASE WHEN s.next_seller IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END END AS chain_flag,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner THEN s.next_lot END AS chain_peer_lot_id
    FROM seq s WHERE s.winner IS NOT NULL
  UNION ALL
  -- the seller of a lot held until its clock; its start is unknown unless it is the previous winner (already a period)
  SELECT s.vehicle_id, s.seller, 'sell:' || s.lot_id,
         NULL::timestamptz, s.clock, true, false, false,
         NULL::text, s.clock_source, NULL::uuid, s.lot_id,
         CASE WHEN s.n > 1 THEN CASE WHEN s.prev_winner IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END END,
         CASE WHEN s.n > 1 THEN s.prev_lot END
    FROM seq s WHERE s.seller IS NOT NULL AND (s.n = 1 OR s.prev_winner IS DISTINCT FROM s.seller)
), flags AS (
  SELECT k.vehicle_id, 'duplicate_lot'::text AS reason, k.lot_id, jsonb_build_object('lot_key', k.lot_key, 'kept_lot', k.kept_lot) AS detail
    FROM ranked k WHERE k.dup_rn > 1 AND k.seller IS NOT DISTINCT FROM k.first_seller AND k.winner IS NOT DISTINCT FROM k.first_winner
  UNION ALL SELECT b.vehicle_id, b.reason, b.lot_id, b.detail FROM blocks b
  UNION ALL
  SELECT o.vehicle_id, 'seller_is_winner', o.lot_id, jsonb_build_object('lot_key', o.lot_key)
    FROM ok o WHERE o.seller IS NOT NULL AND o.seller = o.winner
)
SELECT 'period'::text, p.vehicle_id, p.owner, p.fold_key, p.start_at, p.end_at, p.start_unknown, p.end_unknown, p.is_current,
       p.start_clock_source, p.end_clock_source, p.acquired_via_lot_id, p.disposed_via_lot_id, p.chain_flag, p.chain_peer_lot_id,
       md5(concat_ws('|', p.vehicle_id, p.owner, p.fold_key,
                     coalesce(extract(epoch FROM p.start_at)::text, '-'), coalesce(extract(epoch FROM p.end_at)::text, '-'),
                     p.start_unknown, p.end_unknown, p.is_current,
                     coalesce(p.start_clock_source, '-'), coalesce(p.end_clock_source, '-'),
                     coalesce(p.acquired_via_lot_id::text, '-'), coalesce(p.disposed_via_lot_id::text, '-'),
                     coalesce(p.chain_flag, '-'), coalesce(p.chain_peer_lot_id::text, '-'))),
       NULL::text, NULL::uuid, NULL::jsonb
  FROM periods p
UNION ALL
SELECT 'flag', f.vehicle_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       f.reason, f.lot_id, f.detail
  FROM flags f
$$;
COMMENT ON FUNCTION public.ownership_fold_plan(uuid[]) IS
  'The owner periods and flags the sold lots of the given vehicles support: pure and read-only, computed from auction_events (clock fallback vehicle_events.sold_at/ended_at). Rows of kind period carry the columns of a vehicle_ownerships fold row; rows of kind flag carry what the fold refused to guess. fold_vehicle_ownership_periods applies it.';

-- 5. The writer ------------------------------------------------------------------------------------------------------

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
  v_flags jsonb; v_chain jsonb; v_unknown jsonb; v_blocked integer; v_with_periods integer;
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
  SELECT coalesce(jsonb_object_agg(c.chain_flag, c.n), '{}'::jsonb) INTO v_chain
    FROM (SELECT chain_flag, count(*) AS n FROM _fold_plan WHERE kind = 'period' AND chain_flag IS NOT NULL GROUP BY 1) c;
  SELECT jsonb_build_object('start_unknown', count(*) FILTER (WHERE start_unknown), 'end_unknown', count(*) FILTER (WHERE end_unknown),
                            'current', count(*) FILTER (WHERE is_current)) INTO v_unknown FROM _fold_plan WHERE kind = 'period';
  SELECT count(DISTINCT vehicle_id) INTO v_blocked FROM _fold_plan
   WHERE kind = 'flag' AND flag_reason IN ('duplicate_lot_conflict', 'no_event_clock', 'same_clock');

  IF p_apply THEN
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
      acquired_via_lot_id, disposed_via_lot_id, chain_flag, chain_peer_lot_id, fold_run_at)
    SELECT p.vehicle_id, p.owner_identity_id, 'owner', p.is_current,
           (p.start_at AT TIME ZONE 'UTC')::date, (p.end_at AT TIME ZONE 'UTC')::date,
           coalesce(p.acquired_via_lot_id, p.disposed_via_lot_id), 'claimed_unverified', 20,
           'auction_sale', p.fold_key, p.fold_hash, p.start_unknown, p.end_unknown, p.start_at, p.end_at,
           p.start_clock_source, p.end_clock_source, p.acquired_via_lot_id, p.disposed_via_lot_id,
           p.chain_flag, p.chain_peer_lot_id, v_now
      FROM _fold_plan p
     WHERE p.kind = 'period'
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
    'periods_by_state', v_unknown, 'chain_flags', v_chain, 'flags', v_flags);
END;
$function$;
COMMENT ON FUNCTION public.fold_vehicle_ownership_periods(uuid, integer, boolean) IS
  'The only writer of identity-keyed owner periods. Reads the next p_limit vehicles after p_after that have a sold lot naming a party, computes ownership_fold_plan, and with p_apply supersedes changed or dropped periods (rows kept), inserts new ones and opens or resolves flags, in one transaction under an advisory lock. Without p_apply it only reports the counts. Returns next_after for the following call; done is true past the last vehicle. Idempotent: unchanged periods are not rewritten.';

REVOKE ALL ON FUNCTION public.ownership_fold_plan(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ownership_fold_plan(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.fold_vehicle_ownership_periods(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_vehicle_ownership_periods(uuid, integer, boolean) TO service_role;

-- 6. The reader: periods with the claimed identity resolved to its profile --------------------------------------------

CREATE OR REPLACE VIEW public.v_vehicle_owner_periods WITH (security_invoker = true) AS
SELECT vo.id, vo.vehicle_id, vo.role, vo.is_current, vo.basis, vo.ownership_type, vo.authority_score,
       vo.owner_profile_id, vo.owner_identity_id,
       coalesce(vo.owner_profile_id, ei.claimed_by_user_id) AS resolved_profile_id,
       ei.claim_confidence, ei.platform AS owner_platform, ei.handle AS owner_handle,
       vo.start_at, vo.end_at, vo.start_date, vo.end_date, vo.start_unknown, vo.end_unknown,
       vo.start_clock_source, vo.end_clock_source, vo.acquired_via_lot_id, vo.disposed_via_lot_id,
       vo.proof_event_id, vo.chain_flag, vo.chain_peer_lot_id, vo.verification_id, vo.fold_run_at
  FROM public.vehicle_ownerships vo
  LEFT JOIN public.external_identities ei ON ei.id = vo.owner_identity_id
 WHERE vo.superseded_at IS NULL;
REVOKE ALL ON public.v_vehicle_owner_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_vehicle_owner_periods TO anon, authenticated, service_role;
COMMENT ON VIEW public.v_vehicle_owner_periods IS
  'Every current (not superseded) owner period of a vehicle, user-keyed and identity-keyed together, with the claimed user resolved (resolved_profile_id; claim_confidence says how sure) and the handle shown as the platform shows it. Order by start_at with start_unknown first, never by guessing a start. Read as the sold lots of one platform say, not as title.';

-- 7. Transfer status for a sale that was only recorded ---------------------------------------------------------------

COMMENT ON COLUMN public.ownership_transfers.status IS
  'Transfer state (enum transfer_status). recorded_unconfirmed: a sale recorded at the hammer from a scraped lot; payment, title and handover were never observed and cannot be by a scraper, so no milestone beyond agreement_reached is open. in_progress: a party engaged and at least one milestone beyond agreement_reached was observed. completed, cancelled, disputed: observed outcomes. stalled: an observed transfer that went quiet. pending: seeded for a Nuke-facilitated deal, not started.';

CREATE OR REPLACE FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(
  p_after uuid DEFAULT NULL, p_limit integer DEFAULT 2000, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ids uuid[]; v_last uuid; v_closed integer := 0; v_relabelled integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN RAISE EXCEPTION 'p_limit must be between 1 and 5000'; END IF;
  IF p_apply AND NOT pg_try_advisory_xact_lock(hashtext('relabel_auction_transfers_recorded_unconfirmed')) THEN
    RETURN jsonb_build_object('applied', false, 'skipped', 'another run holds the lock', 'next_after', p_after);
  END IF;
  -- in_progress transfers seeded from a lot where no milestone beyond the hammer was observed and nobody wrote to the parties
  SELECT array_agg(t.id ORDER BY t.id) INTO v_ids FROM (
    SELECT ot.id FROM public.ownership_transfers ot
     WHERE ot.id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
       AND ot.status = 'in_progress' AND ot.trigger_table = 'auction_events'
       AND NOT EXISTS (SELECT 1 FROM public.transfer_milestones m WHERE m.transfer_id = ot.id
                         AND m.milestone_type <> 'agreement_reached' AND m.status IN ('completed', 'skipped', 'blocked', 'in_progress'))
       AND NOT EXISTS (SELECT 1 FROM public.transfer_communications c WHERE c.transfer_id = ot.id)
     ORDER BY ot.id LIMIT p_limit) t;
  IF v_ids IS NULL THEN RETURN jsonb_build_object('applied', p_apply, 'done', true, 'transfers', 0, 'next_after', p_after); END IF;
  v_last := v_ids[array_upper(v_ids, 1)];
  SELECT count(*) INTO v_closed FROM public.transfer_milestones m
   WHERE m.transfer_id = ANY (v_ids) AND m.milestone_type <> 'agreement_reached' AND m.status IN ('pending', 'overdue');
  v_relabelled := array_length(v_ids, 1);
  IF p_apply THEN
    UPDATE public.transfer_milestones m SET status = 'not_observable',
           notes = coalesce(nullif(m.notes, '') || ' | ', '') || 'sale recorded from a scraped lot; this step cannot be observed'
     WHERE m.transfer_id = ANY (v_ids) AND m.milestone_type <> 'agreement_reached' AND m.status IN ('pending', 'overdue');
    UPDATE public.ownership_transfers SET status = 'recorded_unconfirmed' WHERE id = ANY (v_ids) AND status = 'in_progress';
  END IF;
  RETURN jsonb_build_object('applied', p_apply, 'done', false, 'transfers', v_relabelled, 'milestones_closed', v_closed, 'next_after', v_last);
END;
$function$;
COMMENT ON FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(uuid, integer, boolean) IS
  'Moves in_progress transfers seeded from a scraped lot, with no observed milestone beyond agreement_reached and no party communication, to recorded_unconfirmed, and marks their open milestones not_observable. Chunked by transfer id (next_after), dry by default, one transaction per call. Not scheduled and not run by the migration.';
REVOKE ALL ON FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(uuid, integer, boolean) TO service_role;

COMMIT;
