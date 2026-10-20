-- Auction-seeded transfers get the status their evidence supports, with a before-image so any of it can be flipped back.
--
-- Decided 2026-10-20 (the evidence ladder: store the narrow provable claim, never collapse it into a stronger one):
--   * a sold lot is a recorded sale. Hammer only, or hammer plus the winner listing the car next (sale_confirmation
--     confirmed_next_lot on the fold's period): recorded_unconfirmed. 'completed' means title and payment finished in the
--     deal pipeline, and no scraped sale proves that; the stronger evidence stays on the period row.
--   * the same seller listed the car again right after the lot (ownership_fold_flags relist_same_seller): direct evidence
--     the sale did not hand it on: cancelled, cancelled_at = the relisting lot's event clock.
--   * the open milestones of a relabelled transfer become not_observable; agreement_reached (the hammer) stays completed.
--   * never touched: a transfer with a user on either side (from_user_id, to_user_id), any milestone beyond
--     agreement_reached, any party communication, or a trigger other than a lot. Only untouched auction-seeded in_progress rows.
-- A transfer whose relabel still stands (not reverted) is not relabelled again, whatever its status has become since.
-- Each relabel writes a row to ownership_transfer_relabels (previous status, new status, reason, the lot and the evidence lot,
-- milestones closed); revert_auction_transfer_relabels() puts the status, cancelled_at and the milestones back (a closed
-- milestone returns to overdue when its deadline has passed, else pending: the rule the staleness sweep uses).
--
-- Replaces relabel_auction_transfers_recorded_unconfirmed(uuid, integer, boolean) from 20261020330000 (same signature, grants
-- kept); adds one small table (no foreign keys, so no lock on any busy table) and the revert function. Not run by the migration.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS public.ownership_transfer_relabels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL,
  auction_event_id uuid,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('hammer_only', 'confirmed_next_lot', 'relist_same_seller')),
  evidence_lot_id uuid,
  milestones_closed integer NOT NULL DEFAULT 0,
  relabelled_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ownership_transfer_relabels_open ON public.ownership_transfer_relabels (transfer_id) WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ownership_transfer_relabels_lot ON public.ownership_transfer_relabels (auction_event_id) WHERE auction_event_id IS NOT NULL;
ALTER TABLE public.ownership_transfer_relabels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ownership_transfer_relabels FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ownership_transfer_relabels TO service_role;

COMMENT ON TABLE public.ownership_transfer_relabels IS
  'Before-image of every status change made by relabel_auction_transfers_recorded_unconfirmed (grain: one relabel of one transfer; open while reverted_at is null). previous_status is always in_progress today. reason: hammer_only and confirmed_next_lot became recorded_unconfirmed, relist_same_seller became cancelled. transfer_id and the lot ids are locators, not foreign keys (a foreign key would lock busy tables). Writers: relabel_auction_transfers_recorded_unconfirmed, revert_auction_transfer_relabels. Reader: operators.';
COMMENT ON COLUMN public.ownership_transfer_relabels.id IS 'Primary key.';
COMMENT ON COLUMN public.ownership_transfer_relabels.transfer_id IS 'The ownership_transfers row that was relabelled (a locator).';
COMMENT ON COLUMN public.ownership_transfer_relabels.auction_event_id IS 'The sold lot the transfer was seeded from (its trigger_id).';
COMMENT ON COLUMN public.ownership_transfer_relabels.previous_status IS 'The status before the relabel, as the enum label.';
COMMENT ON COLUMN public.ownership_transfer_relabels.new_status IS 'The status the relabel set: recorded_unconfirmed or cancelled.';
COMMENT ON COLUMN public.ownership_transfer_relabels.reason IS 'The evidence class: hammer_only, confirmed_next_lot (the winner listed the car next) or relist_same_seller (the seller listed it again).';
COMMENT ON COLUMN public.ownership_transfer_relabels.evidence_lot_id IS 'For relist_same_seller: the relisting lot whose event clock became cancelled_at.';
COMMENT ON COLUMN public.ownership_transfer_relabels.milestones_closed IS 'How many open milestones were set to not_observable.';
COMMENT ON COLUMN public.ownership_transfer_relabels.relabelled_at IS 'When the relabel ran.';
COMMENT ON COLUMN public.ownership_transfer_relabels.reverted_at IS 'When revert_auction_transfer_relabels put it back; null while the relabel stands.';

CREATE OR REPLACE FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(
  p_after uuid DEFAULT NULL, p_limit integer DEFAULT 1000, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ids uuid[]; v_last uuid; v_by jsonb; v_closed integer; v_n integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN RAISE EXCEPTION 'p_limit must be between 1 and 5000'; END IF;
  IF p_apply AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE basis = 'auction_sale' LIMIT 1) THEN
    RAISE EXCEPTION 'run fold_vehicle_ownership_periods first: the relist and confirmation classes come from its output';
  END IF;
  IF p_apply AND NOT pg_try_advisory_xact_lock(hashtext('relabel_auction_transfers_recorded_unconfirmed')) THEN
    RETURN jsonb_build_object('applied', false, 'skipped', 'another run holds the lock', 'next_after', p_after);
  END IF;
  -- untouched auction-seeded rows only
  SELECT array_agg(t.id ORDER BY t.id) INTO v_ids FROM (
    SELECT ot.id FROM public.ownership_transfers ot
     WHERE ot.id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
       AND ot.status = 'in_progress' AND ot.trigger_table = 'auction_events'
       AND ot.from_user_id IS NULL AND ot.to_user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.transfer_milestones m WHERE m.transfer_id = ot.id
                         AND m.milestone_type <> 'agreement_reached' AND m.status IN ('completed', 'skipped', 'blocked', 'in_progress'))
       AND NOT EXISTS (SELECT 1 FROM public.transfer_communications c WHERE c.transfer_id = ot.id)
       AND NOT EXISTS (SELECT 1 FROM public.ownership_transfer_relabels r WHERE r.transfer_id = ot.id AND r.reverted_at IS NULL)
     ORDER BY ot.id LIMIT p_limit) t;
  IF v_ids IS NULL THEN RETURN jsonb_build_object('applied', p_apply, 'done', true, 'transfers', 0, 'next_after', p_after); END IF;
  v_last := v_ids[array_upper(v_ids, 1)];

  DROP TABLE IF EXISTS _relabel_plan;
  CREATE TEMP TABLE _relabel_plan ON COMMIT DROP AS
    SELECT ot.id AS transfer_id, ot.trigger_id AS lot_id, f.next_lot AS evidence_lot_id,
           CASE WHEN f.lot IS NOT NULL THEN 'relist_same_seller' WHEN c.lot IS NOT NULL THEN 'confirmed_next_lot' ELSE 'hammer_only' END AS reason,
           CASE WHEN f.lot IS NOT NULL THEN 'cancelled' ELSE 'recorded_unconfirmed' END AS new_status,
           (SELECT coalesce(ea.auction_end_date, ve.sold_at, ve.ended_at)
              FROM public.auction_events ea
              LEFT JOIN LATERAL (SELECT v.sold_at, v.ended_at FROM public.vehicle_events v
                                  WHERE ea.auction_end_date IS NULL AND ea.source_url IS NOT NULL AND v.source_url = ea.source_url
                                  ORDER BY v.sold_at NULLS LAST, v.ended_at NULLS LAST, v.id LIMIT 1) ve ON true
             WHERE ea.id = f.next_lot) AS evidence_clock,
           (SELECT count(*) FROM public.transfer_milestones m WHERE m.transfer_id = ot.id
              AND m.milestone_type <> 'agreement_reached' AND m.status IN ('pending', 'overdue'))::integer AS milestones_open
      FROM public.ownership_transfers ot
      LEFT JOIN LATERAL (SELECT fl.auction_event_id AS lot, nullif(fl.detail ->> 'next_lot', '')::uuid AS next_lot
                           FROM public.ownership_fold_flags fl
                          WHERE fl.auction_event_id = ot.trigger_id AND fl.reason = 'relist_same_seller' AND fl.resolved_at IS NULL LIMIT 1) f ON true
      LEFT JOIN LATERAL (SELECT o.acquired_via_lot_id AS lot FROM public.vehicle_ownerships o
                          WHERE o.acquired_via_lot_id = ot.trigger_id AND o.sale_confirmation = 'confirmed_next_lot'
                            AND o.superseded_at IS NULL LIMIT 1) c ON true
     WHERE ot.id = ANY (v_ids);

  SELECT count(*), coalesce(sum(milestones_open), 0) INTO v_n, v_closed FROM _relabel_plan;
  SELECT coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) INTO v_by FROM (SELECT reason, count(*) AS n FROM _relabel_plan GROUP BY 1) x;

  IF p_apply THEN
    INSERT INTO public.ownership_transfer_relabels (transfer_id, auction_event_id, previous_status, new_status, reason, evidence_lot_id, milestones_closed)
    SELECT transfer_id, lot_id, 'in_progress', new_status, reason, evidence_lot_id, milestones_open FROM _relabel_plan;
    UPDATE public.transfer_milestones m SET status = 'not_observable',
           notes = coalesce(nullif(m.notes, '') || ' | ', '') || 'sale recorded from a scraped lot; this step cannot be observed'
     WHERE m.transfer_id IN (SELECT transfer_id FROM _relabel_plan)
       AND m.milestone_type <> 'agreement_reached' AND m.status IN ('pending', 'overdue');
    UPDATE public.ownership_transfers ot
       SET status = p.new_status::public.transfer_status,
           cancelled_at = CASE WHEN p.new_status = 'cancelled' THEN p.evidence_clock END
      FROM _relabel_plan p
     WHERE ot.id = p.transfer_id AND ot.status = 'in_progress';
  END IF;
  RETURN jsonb_build_object('applied', p_apply, 'done', false, 'transfers', v_n, 'by_reason', v_by,
                            'recorded_unconfirmed', (SELECT count(*) FROM _relabel_plan WHERE new_status = 'recorded_unconfirmed'),
                            'cancelled', (SELECT count(*) FROM _relabel_plan WHERE new_status = 'cancelled'),
                            'milestones_closed', v_closed, 'next_after', v_last);
END;
$function$;
COMMENT ON FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(uuid, integer, boolean) IS
  'Gives untouched auction-seeded in_progress transfers (no user on either side, no milestone beyond agreement_reached, no party communication) the status their evidence supports: recorded_unconfirmed for a recorded sale (hammer only, or the winner listed the car next), cancelled for a sale the same seller relisted after (cancelled_at = the relisting lot''s event clock). Their open milestones become not_observable. Every change is written to ownership_transfer_relabels first. Needs the fold to have run. Chunked by transfer id (next_after), dry by default, one transaction per call, by_reason counts per class. Not scheduled and not run by the migration.';

CREATE OR REPLACE FUNCTION public.revert_auction_transfer_relabels(p_transfer_ids uuid[], p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ids uuid[]; v_skipped integer;
BEGIN
  IF p_transfer_ids IS NULL OR cardinality(p_transfer_ids) = 0 OR cardinality(p_transfer_ids) > 5000 THEN
    RAISE EXCEPTION 'p_transfer_ids must hold between 1 and 5000 ids';
  END IF;
  -- only a relabel that still stands, on a transfer that still has the status the relabel set
  SELECT array_agg(r.transfer_id) INTO v_ids
    FROM public.ownership_transfer_relabels r JOIN public.ownership_transfers ot ON ot.id = r.transfer_id
   WHERE r.transfer_id = ANY (p_transfer_ids) AND r.reverted_at IS NULL AND ot.status::text = r.new_status;
  v_ids := coalesce(v_ids, ARRAY[]::uuid[]);
  v_skipped := cardinality(p_transfer_ids) - cardinality(v_ids);
  IF p_apply AND cardinality(v_ids) > 0 THEN
    UPDATE public.ownership_transfers ot
       SET status = r.previous_status::public.transfer_status, cancelled_at = NULL
      FROM public.ownership_transfer_relabels r
     WHERE r.transfer_id = ot.id AND r.transfer_id = ANY (v_ids) AND r.reverted_at IS NULL;
    UPDATE public.transfer_milestones m
       SET status = CASE WHEN m.deadline_at < now() THEN 'overdue'::public.milestone_status ELSE 'pending'::public.milestone_status END
     WHERE m.transfer_id = ANY (v_ids) AND m.status = 'not_observable' AND m.milestone_type <> 'agreement_reached';
    UPDATE public.ownership_transfer_relabels SET reverted_at = now() WHERE transfer_id = ANY (v_ids) AND reverted_at IS NULL;
  END IF;
  RETURN jsonb_build_object('applied', p_apply, 'reverted', cardinality(v_ids), 'skipped', v_skipped);
END;
$function$;
COMMENT ON FUNCTION public.revert_auction_transfer_relabels(uuid[], boolean) IS
  'Puts back relabelled transfers: status from the before-image, cancelled_at cleared, not_observable milestones back to overdue (deadline passed) or pending, the relabel row marked reverted. Skips a transfer whose status is no longer the one the relabel set (it moved on its own). Dry by default.';

REVOKE ALL ON FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relabel_auction_transfers_recorded_unconfirmed(uuid, integer, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.revert_auction_transfer_relabels(uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_auction_transfer_relabels(uuid[], boolean) TO service_role;

COMMIT;
