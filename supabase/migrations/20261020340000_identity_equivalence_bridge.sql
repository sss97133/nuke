-- Evidenced bridge for "one party, two handles" on external_identities, and the lot chain that shows where it is needed.
--
-- WHY. A BaT handle is one identity row, and ownership is a chain of stewards. After a sold lot the next lot's seller is
-- often not the winner: bought under one handle, sold under another. The chain must not guess that the two handles are one
-- party. This migration adds a place to record that fact WITH its evidence, and a reader that shows every break in a
-- vehicle's lot chain with the evidence that explains it, or 'unexplained'. It links nothing by itself.
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-20; bounded sample: 3,000 of the 17,326 BaT vehicles that
-- hold two or more lots, taken in md5(vehicle_id) order; 6,353 lot rows, 5,913 after dropping rows that repeat a lot slug):
--   2,913 consecutive lot pairs. 2,075 are a sold lot with a keyed winner followed by a keyed seller: 954 the winner is the
--   next seller, 1,121 it is not. The other 838: previous lot not sold 792, winner unkeyed 34, seller unkeyed 7, undated 4,
--   next end date same or earlier 1. 2,164 of the 6,353 lot rows have no auction_events.auction_end_date; 1,967 take their
--   end from vehicle_events.ended_at (same source_url), which this reader does too.
--   Of the 1,121 breaks:
--     428 the next seller is the previous lot's seller (keyed fact): the seller listed it again after a lot recorded as sold.
--         Not two handles; it says the sold lot did not hand the car on, or the seller got it back. 72 of 416 vehicle
--         descriptions say "relist". Reported as its own state, never as a bridge.
--      56 BaT's own listing text says the seller bought the car on BaT in the same month the previous lot ended (kind
--         lot_text_purchase: needs text parsing, not built here).
--       3 the seller commented on the previous lot after it closed, claiming to be the buyer (kind buyer_comment: weak and
--         low-yield, not built here).
--       0 two handles on one organization's monitors (210 monitors, 210 organizations, one handle each).
--       0 two identities claimed by one user (1 approved claim on any platform, none on BaT).
--       0 two handles sharing a BaT numeric author id (574 breaks with an id on both sides; 2 of 10,527 sampled ids span two
--         identities anywhere).
--     634 unexplained, which stays a legitimate state. 213 of them end in a seller that is a monitored dealer: a hint, not
--         a link, and so is a seller who merely commented on the previous lot (33).
--   Handle similarity, location and the shared vehicle are never evidence here.
--
-- WHAT THIS ADDS (nothing existing fitted: external_identity_claims is a view over account_link_claims, which links an
-- identity to a Nuke user, not two identities to each other; capability check "identity equivalence" found no owner):
--   * public.identity_equivalences: append-only, one row per (pair, evidence kind). Pair stored in canonical order
--     (identity_a < identity_b). Evidence kinds monitor_organization and claimed_user have a writer below; lot_text_purchase
--     and buyer_comment are declared so a text-parsing lane can write them without a schema change, and have no writer.
--     Supersession is the only permitted change to a row (superseded_by, once). The pairing of handles is private data:
--     RLS on, no anon or authenticated access of any kind, service_role reads. No public view.
--   * public.identity_equivalence_candidates() and public.record_identity_equivalences(p_dry_run boolean default true): the
--     keyed facts and an idempotent writer for the two keyed kinds.
--     Defaults to a dry run that reports what it would create. Not run on prod by this migration.
--   * public.vehicle_lot_chain(uuid): the lot chain of one vehicle with each break and the evidence kind that explains it.
--     SECURITY DEFINER, service_role only (it can return a recorded pairing).
--
-- LOCK COST: CREATE TABLE with two foreign keys takes SHARE ROW EXCLUSIVE on external_identities for the statement; the
-- table is new and empty. lock_timeout 5 s makes it fail rather than queue. No scan, no rewrite, no index on a big table.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS public.identity_equivalences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_a uuid NOT NULL REFERENCES public.external_identities(id),
  identity_b uuid NOT NULL REFERENCES public.external_identities(id),
  relation text NOT NULL DEFAULT 'same_party' CHECK (relation = 'same_party'),
  evidence_kind text NOT NULL CHECK (evidence_kind IN
    ('claimed_user', 'monitor_organization', 'lot_text_purchase', 'buyer_comment')),
  evidence_ref_table text NOT NULL CHECK (btrim(evidence_ref_table) <> ''),
  evidence_ref_id uuid NOT NULL,
  evidence_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  asserted_by text NOT NULL CHECK (btrim(asserted_by) <> ''),
  superseded_by uuid REFERENCES public.identity_equivalences(id),
  CONSTRAINT identity_equivalences_pair_order CHECK (identity_a < identity_b),
  CONSTRAINT identity_equivalences_pair_kind_key UNIQUE (identity_a, identity_b, evidence_kind)
);
CREATE INDEX IF NOT EXISTS idx_identity_equivalences_b ON public.identity_equivalences (identity_b);

COMMENT ON TABLE public.identity_equivalences IS
  'Evidence that two external_identities rows are one party (a buyer who later sells under a business handle). Grain: one '
  'row per identity pair and evidence kind, pair in canonical order (identity_a < identity_b). Append-only: a row is never '
  'edited or deleted; the only permitted change is superseded_by, set once. Private (the pairing of handles): RLS on, no '
  'anon or authenticated access, service_role reads, no public view. Written only by record_identity_equivalences '
  '(claimed_user, monitor_organization) or a text-parsing writer (lot_text_purchase, buyer_comment, none yet). Never from '
  'similarity of handles, location or vehicle. Absence of a row means unknown, not different.';
COMMENT ON COLUMN public.identity_equivalences.evidence_kind IS
  'Strongest first. claimed_user: both identities approved by account_link_claims for one Nuke user (the user''s own proof). '
  'monitor_organization: both handles sit on bat_seller_monitors or bat_buyer_monitors rows of one organization (our own '
  'assertion, basis not recorded; none exist today). lot_text_purchase: BaT''s listing text says the seller bought the car on '
  'BaT in the month the previous lot ended (attributed claim, month precision; needs parsing). buyer_comment: the seller '
  'commented on the previous lot after close claiming to be its buyer (weak).';
COMMENT ON COLUMN public.identity_equivalences.evidence_ref_table IS
  'Table the evidence row lives in: users (claimed_user, evidence_ref_id = the Nuke user), organizations (monitor_organization), '
  'auction_events (lot_text_purchase, the later lot), auction_comments (buyer_comment).';
COMMENT ON COLUMN public.identity_equivalences.evidence_detail IS
  'Row ids that make the evidence checkable (claim ids, monitor ids, parsed month). Ids only: no handle, name or text.';
COMMENT ON COLUMN public.identity_equivalences.observed_at IS
  'When the evidence was true or seen: the later of the two linking rows (claim review, monitor creation), or the lot or '
  'comment time. Clock: event. recorded_at is the ingest clock.';
COMMENT ON COLUMN public.identity_equivalences.superseded_by IS
  'The row that replaces this one for the same pair, set once. NULL while the row stands.';

CREATE OR REPLACE FUNCTION public.identity_equivalences_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL
       AND (to_jsonb(NEW) - 'superseded_by') = (to_jsonb(OLD) - 'superseded_by')
       AND EXISTS (SELECT 1 FROM public.identity_equivalences s
                    WHERE s.id = NEW.superseded_by AND s.identity_a = NEW.identity_a AND s.identity_b = NEW.identity_b
                      AND s.id <> NEW.id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'identity_equivalences is append-only: only superseded_by may be set, once, to a row for the same pair';
  END IF;
  RAISE EXCEPTION 'identity_equivalences is append-only: % refused', TG_OP;
END $$;
DROP TRIGGER IF EXISTS trg_identity_equivalences_append_only ON public.identity_equivalences;
CREATE TRIGGER trg_identity_equivalences_append_only
  BEFORE UPDATE OR DELETE ON public.identity_equivalences
  FOR EACH ROW EXECUTE FUNCTION public.identity_equivalences_append_only();
DROP TRIGGER IF EXISTS trg_identity_equivalences_no_truncate ON public.identity_equivalences;
CREATE TRIGGER trg_identity_equivalences_no_truncate
  BEFORE TRUNCATE ON public.identity_equivalences
  FOR EACH STATEMENT EXECUTE FUNCTION public.identity_equivalences_append_only();

ALTER TABLE public.identity_equivalences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_equivalences FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.identity_equivalences TO service_role;
DROP POLICY IF EXISTS identity_equivalences_service_read ON public.identity_equivalences;
CREATE POLICY identity_equivalences_service_read ON public.identity_equivalences
  FOR SELECT TO service_role USING (true);

-- The keyed facts that say two handles are one party. Internal: the writer and its dry run both read it.
CREATE OR REPLACE FUNCTION public.identity_equivalence_candidates()
RETURNS TABLE (identity_a uuid, identity_b uuid, evidence_kind text, ref_table text, ref_id uuid, detail jsonb,
               observed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- monitor_organization: two different handles on monitors of one organization. Handles resolve by exact
  -- (platform, handle) only; no case folding, no guess.
  WITH m AS (
    SELECT s.organization_id, s.id AS monitor_id, 'bat_seller_monitors'::text AS monitor_table, e.id AS ident, s.created_at
      FROM public.bat_seller_monitors s
      JOIN public.external_identities e ON e.platform = 'bat' AND e.handle = s.seller_username
     WHERE s.organization_id IS NOT NULL
    UNION ALL
    SELECT b.organization_id, b.id, 'bat_buyer_monitors', e.id, b.created_at
      FROM public.bat_buyer_monitors b
      JOIN public.external_identities e ON e.platform = 'bat' AND e.handle = b.buyer_username
     WHERE b.organization_id IS NOT NULL)
  SELECT x.ident, y.ident, 'monitor_organization'::text, 'organizations'::text, x.organization_id,
         jsonb_build_object('monitors', jsonb_build_array(
           jsonb_build_object('table', x.monitor_table, 'id', x.monitor_id),
           jsonb_build_object('table', y.monitor_table, 'id', y.monitor_id))),
         greatest(x.created_at, y.created_at)
    FROM m x JOIN m y ON x.organization_id = y.organization_id AND x.ident < y.ident
  UNION ALL
  -- claimed_user: two identities approved for one Nuke user through account_link_claims.
  SELECT x.external_identity_id, y.external_identity_id, 'claimed_user', 'users', x.user_id,
         jsonb_build_object('claims', jsonb_build_array(x.id, y.id)),
         greatest(coalesce(x.reviewed_at, x.created_at), coalesce(y.reviewed_at, y.created_at))
    FROM public.account_link_claims x
    JOIN public.account_link_claims y
      ON x.user_id = y.user_id AND x.external_identity_id < y.external_identity_id
   WHERE x.status = 'approved' AND y.status = 'approved'
     AND x.external_identity_id IS NOT NULL AND y.external_identity_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.identity_equivalence_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_equivalence_candidates() TO service_role;

-- Writer for the two kinds that are already keyed facts. Dry run by default.
CREATE OR REPLACE FUNCTION public.record_identity_equivalences(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $$
DECLARE
  v_ins integer := 0;
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
           'dry_run', p_dry_run,
           'monitor_organization_pairs', count(*) FILTER (WHERE c.evidence_kind = 'monitor_organization'),
           'claimed_user_pairs', count(*) FILTER (WHERE c.evidence_kind = 'claimed_user'),
           'not_yet_recorded', count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM public.identity_equivalences q
               WHERE q.identity_a = c.identity_a AND q.identity_b = c.identity_b AND q.evidence_kind = c.evidence_kind)))
    INTO v_out
    FROM public.identity_equivalence_candidates() c;
  IF NOT p_dry_run THEN
    INSERT INTO public.identity_equivalences
      (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id, evidence_detail, observed_at, asserted_by)
    SELECT c.identity_a, c.identity_b, c.evidence_kind, c.ref_table, c.ref_id, c.detail, c.observed_at,
           'record_identity_equivalences'
      FROM public.identity_equivalence_candidates() c
    ON CONFLICT (identity_a, identity_b, evidence_kind) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
  END IF;
  RETURN v_out || jsonb_build_object('inserted', v_ins);
END $$;
REVOKE ALL ON FUNCTION public.record_identity_equivalences(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_identity_equivalences(boolean) TO service_role;
COMMENT ON FUNCTION public.record_identity_equivalences(boolean) IS
  'Idempotent writer of identity_equivalences for the keyed kinds (monitor_organization, claimed_user). p_dry_run (default) '
  'reports what it would create and writes nothing. Handles resolve by exact (platform, handle). service_role only.';

-- The lot chain of one vehicle. One row per distinct BaT lot (rows repeating a lot slug fold into one), oldest first.
CREATE OR REPLACE FUNCTION public.vehicle_lot_chain(p_vehicle_id uuid)
RETURNS TABLE (
  seq integer, lot_id uuid, source_url text, ended_at timestamptz, ended_at_source text, outcome text,
  winner_identity_id uuid, seller_identity_id uuid, same_lot_rows integer,
  link text, evidence_kind text, equivalence_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH raw AS (
    SELECT ae.id, ae.source_url,
           coalesce(lower(substring(ae.source_url from 'bringatrailer\.com/listing/([^/?#]+)')), ae.source_url) AS lot_key,
           ae.outcome, ae.winning_bidder_external_identity_id AS win_id, ae.seller_external_identity_id AS sel_id,
           coalesce(ae.auction_end_date, ve.ended_at, ve.sold_at) AS end_at,
           CASE WHEN ae.auction_end_date IS NOT NULL THEN 'auction_events'
                WHEN ve.ended_at IS NOT NULL OR ve.sold_at IS NOT NULL THEN 'vehicle_events' END AS end_src
      FROM public.auction_events ae
      LEFT JOIN LATERAL (
        SELECT e.ended_at, e.sold_at FROM public.vehicle_events e
         WHERE ae.auction_end_date IS NULL AND e.source_url = ae.source_url AND e.source_platform = 'bat' LIMIT 1) ve ON true
     WHERE ae.vehicle_id = p_vehicle_id AND ae.source = 'bat'),
  lots AS (
    SELECT DISTINCT ON (lot_key) r.*, count(*) OVER (PARTITION BY lot_key)::integer AS n_rows
      FROM raw r
     ORDER BY lot_key, (win_id IS NOT NULL)::int + (sel_id IS NOT NULL)::int DESC, id),
  ord AS (
    SELECT l.*, row_number() OVER w AS rn,
           lag(id) OVER w AS prev_id, lag(end_at) OVER w AS prev_end, lag(outcome) OVER w AS prev_outcome,
           lag(win_id) OVER w AS prev_win, lag(sel_id) OVER w AS prev_sel
      FROM lots l WINDOW w AS (ORDER BY end_at, id)),
  cls AS (
    SELECT o.*, CASE
      WHEN o.prev_id IS NULL THEN 'first'
      WHEN o.end_at IS NULL OR o.prev_end IS NULL THEN 'undated'
      WHEN o.end_at <= o.prev_end THEN 'date_error'
      WHEN o.prev_outcome IS DISTINCT FROM 'sold' THEN 'prev_not_sold'
      WHEN o.prev_win IS NULL THEN 'prev_winner_unkeyed'
      WHEN o.sel_id IS NULL THEN 'seller_unkeyed'
      WHEN o.prev_win = o.sel_id THEN 'continuity'
      WHEN o.prev_sel = o.sel_id THEN 'relist_same_seller'
      ELSE 'break' END AS link
      FROM ord o)
  SELECT c.rn::integer, c.id, c.source_url, c.end_at, c.end_src, c.outcome, c.win_id, c.sel_id, c.n_rows, c.link,
         CASE c.link
           WHEN 'relist_same_seller' THEN 'same_seller_relist'
           WHEN 'break' THEN coalesce(q.evidence_kind, 'unexplained') END,
         q.id
    FROM cls c
    LEFT JOIN LATERAL (
      SELECT e.id, e.evidence_kind FROM public.identity_equivalences e
       WHERE c.link = 'break' AND e.superseded_by IS NULL
         AND e.identity_a = least(c.prev_win, c.sel_id) AND e.identity_b = greatest(c.prev_win, c.sel_id)
       ORDER BY array_position(ARRAY['claimed_user', 'monitor_organization', 'lot_text_purchase', 'buyer_comment'], e.evidence_kind),
                e.recorded_at
       LIMIT 1) q ON true
   ORDER BY c.rn
$$;
REVOKE ALL ON FUNCTION public.vehicle_lot_chain(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_lot_chain(uuid) TO service_role;
COMMENT ON FUNCTION public.vehicle_lot_chain(uuid) IS
  'Lot chain of one vehicle (BaT lots, oldest first, repeated lot slugs folded, missing end dates taken from vehicle_events). '
  'link: first | continuity (winner of the previous sold lot is this lot''s seller) | break (it is not) | relist_same_seller '
  '(the seller of the previous lot lists it again) | prev_not_sold | prev_winner_unkeyed | seller_unkeyed | undated | '
  'date_error (end date same or earlier than the previous lot: a folding or duplicate-lot error, not a break). '
  'evidence_kind: on a break, the strongest unsuperseded identity_equivalences kind for the pair, else unexplained; '
  'same_seller_relist on a relist; NULL elsewhere. Direct pairs only, no transitive links. SECURITY DEFINER, service_role only.';

COMMIT;
