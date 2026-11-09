-- Signed approvals for owned-vehicle merges, and a merge that never adds an owner.
--
-- WHY (2026-11-09, measured): merge_into_primary refuses a merge when either vehicle has an owner signal (Gate 2,
-- 20260708133823 / 20261021170000) unless vehicle_merge_proposals holds an 'approved' row with reviewed_by set. Nothing
-- writes that approval: propose_vehicle_merge (20261021180000) files status 'proposed' only, needs both vehicles live,
-- and the table is written by service code alone. So six same-vehicle duplicate pairs in one owner's garage (1983 GMC
-- K2500, 1979 K10, 1973 Charger, 1985 Suburban 2500, 1971 C10, 1967 GTO; every record owner_id-set by owner_import, four
-- duplicates already soft-deleted on 2026-03-10) could only merge by hand-editing the proposal row.
-- Second, merge_into_primary calls merge_carry_children with the owner fill on, so a survivor without owner_id or
-- uploaded_by takes the duplicate's (for the GTO pair, either direction adds an owner signal), and owner / co_owner
-- permission, contributor, relationship and owner-link rows move onto the survivor. A merge is an identity decision, not an
-- ownership decision: ownership comes from the title rules.
--
-- This migration:
--   1. vehicle_merge_proposals gains merge_fill_owner (NULL = old behaviour, fill on), approval_evidence and
--      approval_signature. vehicle_merge_approvals is an append-only audit of every approval and revocation (service role
--      only; RLS on with no policy).
--   2. approve_vehicle_merge(primary, duplicate, reviewer, evidence, notes, fill_owner DEFAULT false, actor): the sanctioned
--      writer. Service role only. The reviewer must hold an owner signal on both vehicles (owner_id, uploaded_by, or an
--      active owner / co_owner permission) or be an active admin. Evidence must be an object with a non-empty "basis" and
--      a non-empty "items" array. It refuses what merge_into_primary refuses (same id, either vehicle merged, two
--      different 11+ character VINs, two different owners) so an approval never names a merge that cannot run. It works
--      on a soft-deleted (not merged) duplicate, which propose_vehicle_merge cannot. A pending proposal filed the other
--      way round is turned to the approved direction in place (its id and history kept; the old direction is recorded).
--      The approval is signed: approval_signature = sha256 of the canonical approval payload (proposal, both vehicles,
--      reviewer, evidence, notes, fill flag, time), stored on the proposal and in the audit row.
--   3. revoke_vehicle_merge_approval(proposal, reason, actor): an approval not yet merged goes back to 'proposed'.
--   4. merge_carry_children: with p_fill_owner false, ownership-chain rows (role owner, co_owner, previously_owned,
--      consigned, consigner; link_type owner) stay on the duplicate and are journaled as ownership_rows_held.
--   5. merge_into_primary passes the proposal's merge_fill_owner (NULL -> true, unchanged for every existing caller).
-- unmerge_vehicle needs no change: held rows never moved, and owner_filled is absent when the fill is off.
--
-- Not applied by this PR's author. Contract: supabase/sql/test_merge_signed_approval.sql (dm_refinement_* database).
-- Reversal: revoke any approval with revoke_vehicle_merge_approval; re-run 20261021200000_merge_carries_records.sql and
-- 20261021170000 for the old function bodies; drop the two new functions, the audit table and the three columns.

SET statement_timeout = '60s';
SET lock_timeout = '5s';

ALTER TABLE public.vehicle_merge_proposals
  ADD COLUMN IF NOT EXISTS merge_fill_owner boolean,
  ADD COLUMN IF NOT EXISTS approval_evidence jsonb,
  ADD COLUMN IF NOT EXISTS approval_signature text;
COMMENT ON COLUMN public.vehicle_merge_proposals.merge_fill_owner IS
  'Whether merge_into_primary may fill the survivor''s owner columns and carry ownership-chain rows. NULL = legacy (true). approve_vehicle_merge sets it, false by default.';
COMMENT ON COLUMN public.vehicle_merge_proposals.approval_signature IS
  'sha256 (hex) of the canonical approval payload written by approve_vehicle_merge; see vehicle_merge_approvals.';

CREATE TABLE IF NOT EXISTS public.vehicle_merge_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.vehicle_merge_proposals (id) ON DELETE CASCADE,
  primary_vehicle_id uuid NOT NULL,
  duplicate_vehicle_id uuid NOT NULL,
  reviewer uuid NOT NULL,
  actor text NOT NULL,
  evidence jsonb NOT NULL,
  review_notes text,
  fill_owner boolean NOT NULL,
  signed_payload jsonb NOT NULL,
  signature text NOT NULL,
  prior_direction jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS vehicle_merge_approvals_proposal_idx ON public.vehicle_merge_approvals (proposal_id);
ALTER TABLE public.vehicle_merge_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_merge_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vehicle_merge_approvals TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_owner_signal(p_vehicle uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p_vehicle AND (v.owner_id = p_user OR v.uploaded_by = p_user))
    OR EXISTS (SELECT 1 FROM vehicle_user_permissions p WHERE p.vehicle_id = p_vehicle AND p.user_id = p_user
               AND p.is_active AND p.role IN ('owner', 'co_owner')));
$$;
REVOKE EXECUTE ON FUNCTION public.vehicle_owner_signal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_owner_signal(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_vehicle_merge(
  p_primary uuid, p_dup uuid, p_reviewer uuid, p_evidence jsonb, p_notes text,
  p_fill_owner boolean DEFAULT false, p_actor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  p record; d record;
  v_prop record;
  v_prior jsonb;
  v_at timestamptz := clock_timestamp();
  v_payload jsonb;
  v_sig text;
  v_id uuid;
  v_admin boolean := false;
BEGIN
  IF p_primary IS NULL OR p_dup IS NULL OR p_primary = p_dup THEN RAISE EXCEPTION 'approve_vehicle_merge: two different vehicle ids are required'; END IF;
  IF p_reviewer IS NULL THEN RAISE EXCEPTION 'approve_vehicle_merge: a reviewer is required'; END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN RAISE EXCEPTION 'approve_vehicle_merge: an actor is required'; END IF;
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object'
     OR coalesce(btrim(p_evidence->>'basis'), '') = ''
     OR jsonb_typeof(p_evidence->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence->'items') = 0 THEN
    RAISE EXCEPTION 'approve_vehicle_merge: evidence must be an object with a non-empty "basis" and a non-empty "items" array';
  END IF;

  SELECT id, status, vin, user_id, owner_id, uploaded_by INTO p FROM vehicles WHERE id = p_primary;
  IF NOT FOUND THEN RAISE EXCEPTION 'approve_vehicle_merge: primary % not found', p_primary; END IF;
  SELECT id, status, vin, user_id, owner_id, uploaded_by INTO d FROM vehicles WHERE id = p_dup;
  IF NOT FOUND THEN RAISE EXCEPTION 'approve_vehicle_merge: duplicate % not found', p_dup; END IF;
  IF p.status = 'merged' OR d.status = 'merged' THEN RAISE EXCEPTION 'approve_vehicle_merge: a vehicle is already merged'; END IF;
  IF length(btrim(p.vin)) >= 11 AND length(btrim(d.vin)) >= 11 AND upper(btrim(p.vin)) <> upper(btrim(d.vin)) THEN
    RAISE EXCEPTION 'approve_vehicle_merge: vin_conflict (two different VINs are two vehicles)';
  END IF;
  IF (p.user_id IS NOT NULL AND d.user_id IS NOT NULL AND p.user_id <> d.user_id)
     OR (p.owner_id IS NOT NULL AND d.owner_id IS NOT NULL AND p.owner_id <> d.owner_id) THEN
    RAISE EXCEPTION 'approve_vehicle_merge: owner_conflict (two different owners)';
  END IF;

  IF to_regclass('public.admin_users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = $1 AND is_active)' INTO v_admin USING p_reviewer;
  END IF;
  IF NOT v_admin AND NOT (public.vehicle_owner_signal(p_primary, p_reviewer) AND public.vehicle_owner_signal(p_dup, p_reviewer)) THEN
    RAISE EXCEPTION 'approve_vehicle_merge: the reviewer must hold an owner signal on both vehicles or be an active admin';
  END IF;

  SELECT * INTO v_prop FROM vehicle_merge_proposals WHERE primary_vehicle_id = p_primary AND duplicate_vehicle_id = p_dup;
  IF FOUND THEN
    IF v_prop.status IN ('merged', 'auto_merged') THEN RAISE EXCEPTION 'approve_vehicle_merge: proposal % is already merged', v_prop.id; END IF;
    v_id := v_prop.id;
  ELSE
    SELECT * INTO v_prop FROM vehicle_merge_proposals WHERE primary_vehicle_id = p_dup AND duplicate_vehicle_id = p_primary;
    IF FOUND THEN
      IF v_prop.status IN ('merged', 'auto_merged', 'approved') THEN
        RAISE EXCEPTION 'approve_vehicle_merge: the reverse proposal % is %; revoke or unmerge it first', v_prop.id, v_prop.status;
      END IF;
      v_prior := jsonb_build_object('proposal_id', v_prop.id, 'primary', v_prop.primary_vehicle_id, 'duplicate', v_prop.duplicate_vehicle_id,
                                    'status', v_prop.status, 'detected_by', v_prop.detected_by);
      UPDATE vehicle_merge_proposals SET primary_vehicle_id = p_primary, duplicate_vehicle_id = p_dup WHERE id = v_prop.id;
      v_id := v_prop.id;
    ELSE
      INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, match_type, confidence_score, status, detected_by, detected_at)
      VALUES (p_primary, p_dup, 'manual_merge', 100, 'proposed', 'approve_vehicle_merge', v_at)
      RETURNING id INTO v_id;
    END IF;
  END IF;

  v_payload := jsonb_build_object('proposal_id', v_id, 'primary_vehicle_id', p_primary, 'duplicate_vehicle_id', p_dup,
    'reviewer', p_reviewer, 'actor', p_actor, 'evidence', p_evidence, 'review_notes', p_notes, 'fill_owner', p_fill_owner,
    'approved_at', v_at);
  v_sig := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  UPDATE vehicle_merge_proposals
     SET status = 'approved', reviewed_by = p_reviewer, reviewed_at = v_at, review_notes = p_notes,
         recommended_primary = p_primary, recommendation_reason = left(p_evidence->>'basis', 500),
         approval_evidence = p_evidence, approval_signature = v_sig, merge_fill_owner = p_fill_owner, updated_at = v_at
   WHERE id = v_id;

  INSERT INTO vehicle_merge_approvals (proposal_id, primary_vehicle_id, duplicate_vehicle_id, reviewer, actor, evidence, review_notes,
                                       fill_owner, signed_payload, signature, prior_direction, created_at)
  VALUES (v_id, p_primary, p_dup, p_reviewer, p_actor, p_evidence, p_notes, p_fill_owner, v_payload, v_sig, v_prior, v_at);

  RETURN jsonb_build_object('proposal_id', v_id, 'status', 'approved', 'signature', v_sig, 'fill_owner', p_fill_owner,
                            'prior_direction', v_prior);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_vehicle_merge(uuid, uuid, uuid, jsonb, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_vehicle_merge(uuid, uuid, uuid, jsonb, text, boolean, text) TO service_role;
COMMENT ON FUNCTION public.approve_vehicle_merge(uuid, uuid, uuid, jsonb, text, boolean, text) IS
  'Sanctioned, signed approval for merging an owned duplicate (Gate 2 of merge_into_primary). Service role only; reviewer must hold an owner signal on both vehicles or be an active admin. Owner fill is off by default. Audited in vehicle_merge_approvals; undo with revoke_vehicle_merge_approval.';

CREATE OR REPLACE FUNCTION public.revoke_vehicle_merge_approval(p_proposal_id uuid, p_reason text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_n int;
BEGIN
  IF coalesce(btrim(p_reason), '') = '' OR coalesce(btrim(p_actor), '') = '' THEN RAISE EXCEPTION 'revoke_vehicle_merge_approval: reason and actor are required'; END IF;
  UPDATE vehicle_merge_proposals
     SET status = 'proposed', reviewed_by = NULL, reviewed_at = NULL, approval_signature = NULL, merge_fill_owner = NULL, updated_at = now()
   WHERE id = p_proposal_id AND status = 'approved';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('proposal_id', p_proposal_id, 'revoked', false, 'reason', 'not_approved'); END IF;
  UPDATE vehicle_merge_approvals SET revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
   WHERE proposal_id = p_proposal_id AND revoked_at IS NULL;
  RETURN jsonb_build_object('proposal_id', p_proposal_id, 'revoked', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_vehicle_merge_approval(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_vehicle_merge_approval(uuid, text, text) TO service_role;

-- merge_carry_children: live body (20261021200000) plus the owner-fill-off hold of ownership-chain rows.
CREATE OR REPLACE FUNCTION public.merge_carry_children(p_primary uuid, p_dup uuid, p_fill_owner boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  spec record;
  v_exists boolean;
  v_ids uuid[];
  v_collide text;
  v_carry jsonb := '{}'::jsonb;
  v_errors jsonb := '{}'::jsonb;
  v_filled jsonb := '{}'::jsonb;
  v_held jsonb := '{}'::jsonb;
  dup record;
  sur record;
BEGIN
  IF p_primary IS NULL OR p_dup IS NULL OR p_primary = p_dup THEN RETURN '{}'::jsonb; END IF;

  FOR spec IN SELECT * FROM (VALUES
      ('work_sessions', ARRAY['start_time']),
      ('receipts', ARRAY[]::text[]),
      ('deal_jackets', ARRAY[]::text[]),
      ('journal_entries', ARRAY[]::text[]),
      ('qb_transactions', ARRAY[]::text[]),
      ('work_orders', ARRAY[]::text[]),
      ('vehicle_user_permissions', ARRAY['user_id']),
      ('vehicle_contributors', ARRAY['user_id', 'role']),
      ('user_vehicle_links', ARRAY['user_id', 'link_type']),
      ('vehicle_user_relationships', ARRAY['user_id', 'role']),
      ('organization_vehicles', ARRAY['organization_id', 'relationship_type']),
      ('image_sets', ARRAY[]::text[]),
      ('vehicle_resolver_aliases', ARRAY['alias', 'alias_type']),
      ('vehicle_listings', ARRAY[]::text[]),
      ('vehicle_builder_attribution', ARRAY['organization_id']),
      ('vehicle_field_sources', ARRAY['field_name'])
    ) AS t(tbl, keys)
  LOOP
    CONTINUE WHEN to_regclass(format('public.%I', spec.tbl)) IS NULL;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE vehicle_id = $1)', spec.tbl) INTO v_exists USING p_dup;
    CONTINUE WHEN NOT v_exists;
    v_collide := '';
    -- 2026-11-13: with the owner fill off, ownership-chain rows (owner, co_owner, previously_owned, consigned, consigner; an
    -- owner link) stay on the duplicate: a merge never makes anyone an owner of the survivor. Title rules decide that.
    IF NOT p_fill_owner THEN
      IF spec.tbl IN ('vehicle_user_permissions', 'vehicle_contributors', 'vehicle_user_relationships') THEN
        v_collide := ' AND NOT (COALESCE(d.role::text, '''') = ANY (ARRAY[''owner'', ''co_owner'', ''previously_owned'', ''consigned'', ''consigner'']))';
        BEGIN
          EXECUTE format('SELECT coalesce(array_agg(id), ''{}''::uuid[]) FROM public.%I d WHERE d.vehicle_id = $1 AND d.role::text = ANY (ARRAY[''owner'', ''co_owner'', ''previously_owned'', ''consigned'', ''consigner''])', spec.tbl)
            INTO v_ids USING p_dup;
          IF cardinality(v_ids) > 0 THEN v_held := v_held || jsonb_build_object(spec.tbl, to_jsonb(v_ids)); END IF;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors || jsonb_build_object(spec.tbl || '_held', left(SQLERRM, 160));
        END;
      ELSIF spec.tbl = 'user_vehicle_links' THEN
        v_collide := ' AND COALESCE(d.link_type::text, '''') <> ''owner''';
        BEGIN
          EXECUTE 'SELECT coalesce(array_agg(id), ''{}''::uuid[]) FROM public.user_vehicle_links d WHERE d.vehicle_id = $1 AND d.link_type::text = ''owner'''
            INTO v_ids USING p_dup;
          IF cardinality(v_ids) > 0 THEN v_held := v_held || jsonb_build_object(spec.tbl, to_jsonb(v_ids)); END IF;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors || jsonb_build_object(spec.tbl || '_held', left(SQLERRM, 160));
        END;
      END IF;
    END IF;
    IF cardinality(spec.keys) > 0 THEN
      v_collide := v_collide || format(' AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.vehicle_id = $1 AND %s)', spec.tbl,
        (SELECT string_agg(format('p.%1$I IS NOT DISTINCT FROM d.%1$I', k), ' AND ') FROM unnest(spec.keys) k));
    ELSIF spec.tbl = 'vehicle_listings' THEN
      -- one active and one draft listing per vehicle (partial unique indexes)
      v_collide := ' AND NOT (d.status IN (''active'', ''draft'') AND EXISTS (SELECT 1 FROM public.vehicle_listings p WHERE p.vehicle_id = $1 AND p.status = d.status))';
    END IF;
    BEGIN
      EXECUTE format('WITH m AS (UPDATE public.%I d SET vehicle_id = $1 WHERE d.vehicle_id = $2%s RETURNING d.id) SELECT coalesce(array_agg(id), ''{}''::uuid[]) FROM m',
                     spec.tbl, v_collide) INTO v_ids USING p_primary, p_dup;
      IF cardinality(v_ids) > 0 THEN v_carry := v_carry || jsonb_build_object(spec.tbl, to_jsonb(v_ids)); END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(spec.tbl, left(SQLERRM, 160));
    END;
  END LOOP;

  -- Rows that name the vehicle only through their scope.
  IF to_regclass('public.receipts') IS NOT NULL THEN
    BEGIN
      WITH m AS (UPDATE public.receipts r SET scope_id = p_primary::text WHERE r.scope_type = 'vehicle' AND r.scope_id = p_dup::text RETURNING r.id)
      SELECT array_agg(id) INTO v_ids FROM m;
      IF v_ids IS NOT NULL THEN v_carry := v_carry || jsonb_build_object('receipts_scope', to_jsonb(v_ids)); END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('receipts_scope', left(SQLERRM, 160));
    END;
  END IF;
  IF to_regclass('public.payment_events') IS NOT NULL THEN
    BEGIN
      WITH m AS (UPDATE public.payment_events e SET scope_id = p_primary WHERE e.scope_type = 'vehicle' AND e.scope_id = p_dup RETURNING e.id)
      SELECT array_agg(id) INTO v_ids FROM m;
      IF v_ids IS NOT NULL THEN v_carry := v_carry || jsonb_build_object('payment_events_scope', to_jsonb(v_ids)); END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('payment_events_scope', left(SQLERRM, 160));
    END;
  END IF;

  -- The owner link: an owner column the survivor lacks comes from the duplicate (a conflict never reaches here: the callers refuse it).
  -- vehicles.user_id is generated from uploaded_by, so filling uploaded_by fills it.
  BEGIN
    SELECT owner_id, uploaded_by INTO dup FROM public.vehicles WHERE id = p_dup;
    SELECT owner_id, uploaded_by INTO sur FROM public.vehicles WHERE id = p_primary;
    IF FOUND AND p_fill_owner THEN
      IF sur.owner_id IS NULL AND dup.owner_id IS NOT NULL THEN v_filled := v_filled || jsonb_build_object('owner_id', dup.owner_id); END IF;
      IF sur.uploaded_by IS NULL AND dup.uploaded_by IS NOT NULL THEN v_filled := v_filled || jsonb_build_object('uploaded_by', dup.uploaded_by); END IF;
      IF v_filled <> '{}'::jsonb THEN
        UPDATE public.vehicles v
           SET owner_id = COALESCE(v.owner_id, dup.owner_id), uploaded_by = COALESCE(v.uploaded_by, dup.uploaded_by)
         WHERE v.id = p_primary;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_filled := '{}'::jsonb;
    v_errors := v_errors || jsonb_build_object('owner_columns', left(SQLERRM, 160));
  END;

  RETURN (CASE WHEN v_carry = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('carried', v_carry) END)
      || (CASE WHEN v_filled = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('owner_filled', v_filled) END)
      || (CASE WHEN v_held = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('ownership_rows_held', v_held) END)
      || (CASE WHEN v_errors = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('errors', v_errors) END);
END;
$function$;

-- merge_into_primary: live body (20261021200000) with the proposal's fill flag passed through.
CREATE OR REPLACE FUNCTION public.merge_into_primary(primary_id uuid, dup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dup_status TEXT;
  v_proposal_id UUID;
  v_journal JSONB := '{}'::jsonb;
  v_ids UUID[];
  v_left UUID[];
  v_sup JSONB;
  n_images INT := 0; n_obs INT := 0; n_auction_events INT := 0; n_comments INT := 0; n_obs_disc INT := 0;
  n_vehicle_events INT := 0; n_timeline INT := 0; n_obs_superseded INT := 0;
  v_carry JSONB := '{}'::jsonb;
BEGIN
  -- Guard: skip if same ID or already merged
  IF primary_id = dup_id THEN
    RETURN jsonb_build_object('skipped', 'same_id');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = primary_id AND (status IS DISTINCT FROM 'merged')) THEN
    RETURN jsonb_build_object('skipped', 'primary_not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = dup_id AND (status IS DISTINCT FROM 'merged')) THEN
    RETURN jsonb_build_object('skipped', 'dup_already_merged');
  END IF;

  -- Gate 2 (2026-07-08): NEVER auto-merge an OWNED vehicle without owner-approval evidence. Owned is user_id, owner_id or uploaded_by
  -- set, or an active owner / co_owner permission (2026-10-20: 126 live vehicles were owned through owner_id alone and passed).
  IF EXISTS (SELECT 1 FROM vehicles WHERE id IN (primary_id, dup_id) AND (user_id IS NOT NULL OR owner_id IS NOT NULL OR uploaded_by IS NOT NULL))
     OR EXISTS (SELECT 1 FROM vehicle_user_permissions WHERE vehicle_id IN (primary_id, dup_id) AND is_active AND role IN ('owner', 'co_owner')) THEN
    IF NOT EXISTS (
      SELECT 1 FROM vehicle_merge_proposals
      WHERE ((primary_vehicle_id = primary_id AND duplicate_vehicle_id = dup_id)
          OR (primary_vehicle_id = dup_id AND duplicate_vehicle_id = primary_id))
        AND status = 'approved' AND reviewed_by IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('skipped', 'owned_requires_approval', 'primary', primary_id, 'dup', dup_id);
    END IF;
  END IF;

  -- Two different owners are two vehicles' owners: never merged here either (an owner column set on both rows and different).
  IF EXISTS (
    SELECT 1 FROM vehicles p, vehicles d
     WHERE p.id = primary_id AND d.id = dup_id
       AND ((p.user_id IS NOT NULL AND d.user_id IS NOT NULL AND p.user_id <> d.user_id)
         OR (p.owner_id IS NOT NULL AND d.owner_id IS NOT NULL AND p.owner_id <> d.owner_id))
  ) THEN
    RETURN jsonb_build_object('skipped', 'owner_conflict', 'primary', primary_id, 'dup', dup_id);
  END IF;

  -- Two different VINs are two vehicles, whatever URL they share: never merged here (the rule merge_into_primary_batch
  -- already enforces; 49 single-pair merges since 2026-10-17 joined two 11+ character VINs and wait for unmerge review).
  IF EXISTS (
    SELECT 1 FROM vehicles p, vehicles d
     WHERE p.id = primary_id AND d.id = dup_id
       AND length(btrim(p.vin)) >= 11 AND length(btrim(d.vin)) >= 11
       AND upper(btrim(p.vin)) <> upper(btrim(d.vin))
  ) THEN
    RETURN jsonb_build_object('skipped', 'vin_conflict', 'primary', primary_id, 'dup', dup_id);
  END IF;

  SELECT status INTO v_dup_status FROM vehicles WHERE id = dup_id;

  SELECT id INTO v_proposal_id
  FROM vehicle_merge_proposals
  WHERE primary_vehicle_id = primary_id AND duplicate_vehicle_id = dup_id
  LIMIT 1;

  IF v_proposal_id IS NULL THEN
    INSERT INTO vehicle_merge_proposals (
      primary_vehicle_id, duplicate_vehicle_id,
      match_type, confidence_score, status, detected_by, detected_at
    ) VALUES (
      primary_id, dup_id,
      'exact_listing_url', 100, 'merged', 'dedup-worker', NOW()
    )
    ON CONFLICT (primary_vehicle_id, duplicate_vehicle_id) DO UPDATE
      SET status = 'merged', merged_at = NOW()
    RETURNING id INTO v_proposal_id;
  END IF;

  -- 1. vehicle_images. A photo whose (vehicle_id, file_hash) the primary already holds stays on the duplicate.
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false AND EXISTS (
           SELECT 1 FROM vehicle_images p WHERE p.vehicle_id = primary_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false))),
         array_agg(d.id) FILTER (WHERE d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false AND EXISTS (
           SELECT 1 FROM vehicle_images p WHERE p.vehicle_id = primary_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false))
    INTO v_ids, v_left
  FROM vehicle_images d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('images_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'images_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE vehicle_images SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_images = ROW_COUNT;

  -- 2. vehicle_observations: testimony. A duplicate observation that shares (source_id, source_identifier, kind) with one the
  --    primary holds is SUPERSEDED by it (and still moved); nothing is deleted.
  WITH hits AS (
    SELECT d.id,
           (SELECT p.id FROM vehicle_observations p
             WHERE p.vehicle_id = primary_id AND p.source_id = d.source_id
               AND p.source_identifier = d.source_identifier AND p.kind = d.kind
             ORDER BY p.observed_at DESC NULLS LAST, p.id LIMIT 1) AS by_id
    FROM vehicle_observations d
    WHERE d.vehicle_id = dup_id AND d.is_superseded IS NOT TRUE
  ), sup AS (
    UPDATE vehicle_observations o
       SET is_superseded = true, superseded_by = h.by_id, superseded_at = now()
      FROM hits h
     WHERE o.id = h.id AND h.by_id IS NOT NULL
    RETURNING o.id, h.by_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'by', by_id)), '[]'::jsonb), count(*) INTO v_sup, n_obs_superseded FROM sup;
  -- Protected rows stay on the duplicate, as in merge_into_primary_batch: guard_retained_vin_observation and
  --    validate_retained_listing_property_source refuse to move them (they are re-derived on the survivor).
  SELECT array_agg(id) FILTER (WHERE source_vin IS NULL
           AND source_vin_taxonomy_revision_id IS NULL
           AND extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1'
           AND source_vehicle_event_id IS NULL
           AND source_observation_id IS NULL
           AND source_comment_id IS NULL
           AND source_snapshot_id IS NULL),
         array_agg(id) FILTER (WHERE NOT (source_vin IS NULL
           AND source_vin_taxonomy_revision_id IS NULL
           AND extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1'
           AND source_vehicle_event_id IS NULL
           AND source_observation_id IS NULL
           AND source_comment_id IS NULL
           AND source_snapshot_id IS NULL))
    INTO v_ids, v_left
  FROM vehicle_observations WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('observations_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'observations_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb),
                                               'observations_superseded', v_sup);
  UPDATE vehicle_observations SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_obs = ROW_COUNT;

  -- 3. auction_events. An event whose (vehicle_id, source_url) the primary already holds stays on the duplicate.
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM auction_events p WHERE p.vehicle_id = primary_id AND p.source_url = d.source_url))),
         array_agg(d.id) FILTER (WHERE d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM auction_events p WHERE p.vehicle_id = primary_id AND p.source_url = d.source_url))
    INTO v_ids, v_left
  FROM auction_events d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('events_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'events_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE auction_events SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_auction_events = ROW_COUNT;

  -- 4. auction_comments. auction_comments has no supersession columns and a unique (vehicle_id, content_hash): a comment whose
  --    content_hash the primary already holds is the same comment; it stays on the duplicate (kept, not deleted).
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.content_hash IS NOT NULL AND EXISTS (SELECT 1 FROM auction_comments p WHERE p.vehicle_id = primary_id AND p.content_hash = d.content_hash))),
         array_agg(d.id) FILTER (WHERE d.content_hash IS NOT NULL AND EXISTS (SELECT 1 FROM auction_comments p WHERE p.vehicle_id = primary_id AND p.content_hash = d.content_hash))
    INTO v_ids, v_left
  FROM auction_comments d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('comments_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'comments_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE auction_comments SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_comments = ROW_COUNT;

  -- 5. observation_discoveries: no unique key; move all.
  SELECT array_agg(id) INTO v_ids FROM observation_discoveries WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('obs_disc_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));
  UPDATE observation_discoveries SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_obs_disc = ROW_COUNT;

  -- 6. vehicle_events (listing episodes). An episode whose listing key the primary already holds stays on the duplicate.
  SELECT array_agg(d.id) FILTER (WHERE NOT (
           (d.source_listing_id IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_listing_id = d.source_listing_id))
        OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_url = d.source_url AND p.source_listing_id IS NULL)))),
         array_agg(d.id) FILTER (WHERE
           (d.source_listing_id IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_listing_id = d.source_listing_id))
        OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_url = d.source_url AND p.source_listing_id IS NULL)))
    INTO v_ids, v_left
  FROM vehicle_events d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('vehicle_events_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'vehicle_events_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE vehicle_events SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_vehicle_events = ROW_COUNT;

  -- 7. timeline_events. A photo-session day the primary already has (idx_timeline_events_one_photo_session_per_day) stays.
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.event_type IN ('photo_session', 'batch_image_upload') AND EXISTS (
           SELECT 1 FROM timeline_events p WHERE p.vehicle_id = primary_id AND p.event_type IN ('photo_session', 'batch_image_upload')
             AND p.event_date IS NOT DISTINCT FROM d.event_date AND COALESCE(p.user_id::text, 'system') = COALESCE(d.user_id::text, 'system')))),
         array_agg(d.id) FILTER (WHERE d.event_type IN ('photo_session', 'batch_image_upload') AND EXISTS (
           SELECT 1 FROM timeline_events p WHERE p.vehicle_id = primary_id AND p.event_type IN ('photo_session', 'batch_image_upload')
             AND p.event_date IS NOT DISTINCT FROM d.event_date AND COALESCE(p.user_id::text, 'system') = COALESCE(d.user_id::text, 'system')))
    INTO v_ids, v_left
  FROM timeline_events d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('timeline_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'timeline_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE timeline_events SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_timeline = ROW_COUNT;

  -- 7b. Records about the car or its people follow the merge (work sessions, receipts and jackets, journals, permissions and links,
  --     organization links, albums, aliases, listings), and the owner link fills an unowned survivor. Collisions stay on the duplicate;
  --     a table whose carry fails is recorded and skipped, never failing the merge. Journaled for unmerge_vehicle.
  -- 2026-11-13: the owner link fills an unowned survivor only when the approval allowed it. A proposal approved through
  --     approve_vehicle_merge carries merge_fill_owner (false by default there), and with it off the ownership-chain rows stay on
  --     the duplicate for the title rules to judge. Proposals without the flag keep the old behaviour (fill on).
  v_carry := public.merge_carry_children(primary_id, dup_id,
    COALESCE((SELECT mp.merge_fill_owner FROM vehicle_merge_proposals mp WHERE mp.id = v_proposal_id), true));
  v_journal := v_journal || jsonb_build_object('carry', v_carry);

  -- 8. bat_listings, comment_discoveries, description_discoveries: unique per vehicle and not stamped, so they are neither moved nor
  --    deleted: they stay on the soft-deleted duplicate (.claude/rules/db-safety.md lists them as testimony; the old merge archived
  --    then deleted them). Counts go in the journal.
  v_journal := v_journal || jsonb_build_object(
    'bat_left_count', (SELECT count(*) FROM bat_listings WHERE vehicle_id = dup_id),
    'comment_disc_left_count', (SELECT count(*) FROM comment_discoveries WHERE vehicle_id = dup_id),
    'desc_disc_left_count', (SELECT count(*) FROM description_discoveries WHERE vehicle_id = dup_id));

  -- 11. Soft-delete the duplicate; its photos are on the primary now (or stayed by file_hash, counted as duplicates).
  UPDATE vehicles SET merged_into_vehicle_id = primary_id, status = 'merged', deleted_at = NOW(),
         image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = dup_id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
   WHERE id = dup_id;

  -- 12. image_count on the primary, only when a photo moved (the row trigger recounts the new vehicle only).
  IF n_images > 0 THEN
    UPDATE vehicles v
       SET image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
     WHERE v.id = primary_id;
  END IF;

  -- 13. Journal.
  UPDATE vehicle_merge_proposals
     SET status = 'merged', merged_at = NOW(), merge_journal = v_journal, pre_merge_dup_status = v_dup_status
   WHERE id = v_proposal_id;

  RETURN jsonb_build_object(
    'proposal_id', v_proposal_id,
    'images_moved', n_images,
    'observations_moved', n_obs,
    'observations_superseded', n_obs_superseded,
    'events_moved', n_auction_events,
    'comments_moved', n_comments,
    'obs_disc_moved', n_obs_disc,
    'vehicle_events_moved', n_vehicle_events,
    'timeline_events_moved', n_timeline,
    'carry', v_carry,
    'bat_left', (v_journal->>'bat_left_count')::int,
    'comment_disc_left', (v_journal->>'comment_disc_left_count')::int,
    'desc_disc_left', (v_journal->>'desc_disc_left_count')::int
  );
END;
$function$;
