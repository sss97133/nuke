-- disclaim_vehicle_tie / restore_vehicle_tie: the sanctioned way for a person to take a vehicle out of their garage when
-- the tie was made by an importer or an agent, not by them. Journaled with before-images; nothing deleted.
--
-- Why. Walking the web garage on 2026-11-21, the owner named a car that an early Craigslist import had put there and that
-- is not his. A read-only pass that day (ids in the private run log, not here) found three such Craigslist cars, most of
-- the garage tied to the account only by an importer, and no sanctioned writer that ends a contributor tie or a
-- vehicles.user_id tie.
--
-- What already existed, read live 2026-11-21:
--   revoke_garage_membership(vehicle, reason): signed-in caller only (auth.uid()), every active vehicle_user_permissions
--   row of that caller on the vehicle (any role, owner included, with no evidence check) and every active
--   discovered_vehicles row. It does not touch vehicle_contributors, vehicles.user_id/owner_id, ownership_verifications or
--   vehicle_ownerships, keeps no before-image and has no restore. It cannot run at all: its UPDATE sets the text column
--   context to COALESCE(context, '{}'::jsonb) || jsonb, which raises "COALESCE types text and jsonb cannot be matched" on
--   every call (no permission row has ever carried its eject marker). And chk_granted_by_not_null (NOT VALID, which
--   still checks every UPDATE) refuses its UPDATE on the importer-era rows whose granted_by is NULL. Left as it is here.
--
-- How a vehicle reaches a garage (get_user_garage for iOS and the web hook; the web hook also reads
-- ownership_verifications approved, discovered_vehicles previously_owned, every vehicle_ownerships row of the person and
-- the person's garage_owner_correction_v1 statements):
--   vehicle_user_permissions owner/co_owner/previously_owned/consigned (role contributor is not a garage route),
--   ownership_verifications approved, vehicle_ownerships current, discovered_vehicles previously_owned, own photo uploads
--   or work sessions in the last 60 days, vehicle_contributors (any row: no status filter until this migration), and
--   vehicles.user_id (profile_record). vehicle_class_price is a per-vehicle price store, not a membership reader.
--
-- The writer ends only ties no person made, and never touches evidence:
--   vehicle_contributors   active rows whose notes say an automatic job made them ('Auto-derived: ...' from the
--                          2026-07-06 photo-attribution job, 'device_evidence (...' from device_create_vehicle_profile)
--                          -> status 'inactive', end_date today (the markers vehicle_user_has_access and
--                          vehicles_delete_policy already read). Other rows are a person's stated role and stay.
--   vehicle_user_permissions  active rows with granted_by NULL (no person granted them: the 2026-03-09 "Photo evidence"
--                          job, the 2025-09 auto-downgrades) -> is_active false, revoked_at now, revoked_by the person.
--                          Rows a person granted stay.
--   discovered_vehicles    active rows whose discovery_source is 'system:%' -> is_active false. Roster and unsourced
--                          rows are the person's own list and stay.
--   vehicles.user_id / owner_id equal to the person -> NULL. No column tells a hand-made profile from an importer's
--                          (profile_origin reads 'manual_entry' on the Craigslist imports), and creating a record is not an
--                          ownership claim (get_user_garage's own rule), so the record's account columns are treated as a
--                          record tie; the first-hand evidence check below is what protects a real car. NULL is what
--                          99.98% of vehicles carry (pg_stats, 2026-11-21); no constraint or trigger needs a value. What
--                          the person loses with it: edit and delete rights through the vehicles RLS policies, insider
--                          access through vehicle_user_has_access, owner standing for record_vehicle_statement, and the
--                          merge guard's "owned" reading. uploaded_by and discovered_by (who ran the import) stay as
--                          provenance. The UPDATE also moves vehicles.updated_at and vehicle_status_metadata through the
--                          existing triggers.
-- Not touched: the vehicle row otherwise, its photos (vehicle_images.user_id stays), observations, work sessions,
-- documents, ownership_verifications, vehicle_ownerships, statements, is_public.
--
-- First-hand evidence blocks the call and is named in the answer (vehicle_tie_first_hand_evidence): an
-- ownership_verifications row of the person (approved, or a title document submitted and pending), a vehicle_ownerships
-- period of the person not superseded, the person's own vehicle statement as owner or previous owner, the person's garage
-- correction stating an ownership, consignment or transfer role, ownership paper on the vehicle (vehicle_observations kind
-- 'ownership': titles, deal jackets, owner-confirmed acquisitions) submitted by the person or unattributed, a title,
-- registration or bill of sale in vehicle_documents uploaded by the person, the person's own device photos (a library
-- source or camera EXIF; listing photos an importer attributed to the person carry neither), and a work order with the
-- person as customer or quoter. p_force_reason overrides the block only for the signed-in person themselves; a service
-- call with it is refused. Forcing still ends only the importer-made ties: evidence rows are never changed, so a car with
-- an approved title stays in the garage through it, and the answer says so (still_in_garage_by).
--
-- Ties on vehicles merged into this one (two hops, as get_user_garage follows them) are included.
--
-- Supporting changes:
--   * chk_granted_by_not_null (NOT VALID) admits a NULL grantor on a retracted row (is_active false, revoked_at set), so
--     an importer row can be ended without inventing a grantor. Every active grant still names its author. A restore
--     re-activates such a row with granted_by = the restoring person (the one granting it again), as
--     stamp_vehicle_permission_grantor does for any signed-in re-activation; the journal keeps the original NULL.
--   * enforce_contributor_evidence (live body, never in a migration until now) lets an update end a row without a photo,
--     as enforce_user_vehicle_evidence already does for revocations. Re-activation still needs the photo.
--   * get_user_garage reads only active contributor rows (coalesce(status, 'active') = 'active', the reading
--     vehicle_user_has_access already uses). Read 2026-11-21: three of the owner's contributor rows were already
--     inactive, all on deleted vehicles, so no car leaves a garage on deploy.
--
-- Journal: vehicle_tie_journal, one row per ended tie with the before- and after-image, reason, force reason and the
-- evidence it overrode. No foreign key to vehicles. restore_vehicle_tie(journal id or run id) puts back each row this run
-- left unchanged since, and says which it could not.
--
-- Callers: the signed-in person for themselves (auth.uid() = p_actor), or the service role naming the person.
-- Contract: supabase/sql/test_disclaim_vehicle_tie.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE f text;
BEGIN
  IF to_regclass('public.vehicle_contributors') IS NULL OR to_regclass('public.vehicle_user_permissions') IS NULL
     OR to_regclass('public.discovered_vehicles') IS NULL OR to_regclass('public.vehicle_ownerships') IS NULL
     OR to_regclass('public.ownership_verifications') IS NULL OR to_regclass('public.vehicle_documents') IS NULL
     OR to_regclass('public.work_orders') IS NULL OR to_regclass('public.work_sessions') IS NULL
     OR to_regclass('public.vehicle_observations') IS NULL OR to_regclass('public.vehicle_images') IS NULL THEN
    RAISE EXCEPTION 'disclaim_vehicle_tie: a table it reads is missing';
  END IF;
  f := md5(pg_get_functiondef('public.get_user_garage(uuid)'::regprocedure));
  IF f NOT IN ('54f0556edc63ba6b9a6c136f27ed0d94', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               '50c816483cbe311e5d9450733f937bc7') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'get_user_garage changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.enforce_contributor_evidence()'::regprocedure));
  IF f NOT IN ('d96d8e19bd0e930b5729698db601032f', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               'e0bbc3faa42e46c51aec11271b35fe9d') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'enforce_contributor_evidence changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO f FROM pg_constraint c
   WHERE c.conrelid = 'public.vehicle_user_permissions'::regclass AND c.conname = 'chk_granted_by_not_null';
  IF f IS DISTINCT FROM 'CHECK ((granted_by IS NOT NULL)) NOT VALID'
     AND f IS DISTINCT FROM 'CHECK (((granted_by IS NOT NULL) OR ((is_active IS FALSE) AND (revoked_at IS NOT NULL)))) NOT VALID' THEN
    RAISE EXCEPTION 'chk_granted_by_not_null differs from the 2026-11-21 read (%); review before replacement', f;
  END IF;
  -- the columns the writer reads or writes, as read 2026-11-21
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (
        ('vehicle_contributors', 'status'), ('vehicle_contributors', 'end_date'), ('vehicle_contributors', 'notes'),
        ('vehicle_user_permissions', 'granted_by'), ('vehicle_user_permissions', 'revoked_by'),
        ('vehicle_user_permissions', 'context'), ('discovered_vehicles', 'discovery_source'),
        ('vehicle_ownerships', 'superseded_at'), ('vehicle_observations', 'submitted_by_user_id'),
        ('vehicle_images', 'documented_by_user_id'), ('vehicle_images', 'vision_gate_status'),
        ('vehicle_images', 'user_confirmed_vehicle'), ('work_orders', 'quoted_by'), ('vehicles', 'owner_id'))) <> 14 THEN
    RAISE EXCEPTION 'disclaim_vehicle_tie: a column it uses drifted from the 2026-11-21 read';
  END IF;
END $guard$;

-- 1. The journal --------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_tie_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,            -- the vehicle the call named; plain uuid, no foreign key to vehicles
  user_id uuid NOT NULL,               -- the person whose tie ended
  tie_table text NOT NULL CHECK (tie_table IN ('vehicle_contributors', 'vehicle_user_permissions', 'discovered_vehicles', 'vehicles')),
  tie_row_id uuid NOT NULL,            -- the row's id (the vehicle's id for the record columns)
  tie_kind text NOT NULL,
  before_image jsonb NOT NULL,
  after_image jsonb NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  force_reason text,
  overridden_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  called_as text NOT NULL CHECK (called_as IN ('self', 'service_role')),
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by uuid,
  restore_note text,
  UNIQUE (run_id, tie_table, tie_row_id)
);
CREATE INDEX IF NOT EXISTS vehicle_tie_journal_user_vehicle ON public.vehicle_tie_journal (user_id, vehicle_id);
ALTER TABLE public.vehicle_tie_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_tie_journal FROM PUBLIC;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON public.vehicle_tie_journal FROM anon, authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT SELECT ON public.vehicle_tie_journal TO service_role'; END IF;
END $r$;
COMMENT ON TABLE public.vehicle_tie_journal IS
  'One row per tie disclaim_vehicle_tie ended between a person and a vehicle (contributor, permission, discovery or the '
  'record''s user_id/owner_id), with the before- and after-image, reason, force reason and overridden evidence. '
  'restore_vehicle_tie puts a row back. No foreign key to vehicles. Read by the service role only.';

-- 2. A retracted permission row need not name a grantor -----------------------------------------------------------------
DO $c$
BEGIN
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.vehicle_user_permissions'::regclass
        AND c.conname = 'chk_granted_by_not_null') = 'CHECK ((granted_by IS NOT NULL)) NOT VALID' THEN
    ALTER TABLE public.vehicle_user_permissions DROP CONSTRAINT chk_granted_by_not_null;
    ALTER TABLE public.vehicle_user_permissions ADD CONSTRAINT chk_granted_by_not_null
      CHECK (granted_by IS NOT NULL OR (is_active IS FALSE AND revoked_at IS NOT NULL)) NOT VALID;
  END IF;
END $c$;
COMMENT ON CONSTRAINT chk_granted_by_not_null ON public.vehicle_user_permissions IS
  'Every live grant names its author (new INSERTs/UPDATEs). A retracted row (is_active false, revoked_at set) may keep '
  'the NULL grantor an importer left (20261122004000). Run VALIDATE CONSTRAINT after the remaining active NULL rows end.';

-- 3. Ending a contributor row needs no photo -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_contributor_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Ending a tie claims nothing new: an update that keeps the vehicle, the person and the role and leaves the row not
  -- active (disclaim_vehicle_tie, 20261122004000) needs no photo. Re-activation is checked below like an insert.
  IF TG_OP = 'UPDATE'
     AND (NEW.vehicle_id, NEW.user_id, NEW.role) IS NOT DISTINCT FROM (OLD.vehicle_id, OLD.user_id, OLD.role)
     AND coalesce(NEW.status, 'active') <> 'active' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
    WHERE vi.vehicle_id = NEW.vehicle_id
    AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'Cannot add contributor without photo evidence on this vehicle. Vehicle: %, User: %',
      NEW.vehicle_id, NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. First-hand evidence of ownership or custody ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_tie_first_hand_evidence(p_vehicle_ids uuid[], p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x.e ORDER BY x.e->>'kind', x.e->>'id'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('kind', CASE WHEN ov.status = 'approved' THEN 'ownership_verification' ELSE 'title_document_submitted' END,
             'table', 'ownership_verifications', 'id', ov.id, 'vehicle_id', ov.vehicle_id, 'status', ov.status,
             'category', ov.verification_category) AS e
      FROM public.ownership_verifications ov
     WHERE ov.vehicle_id = ANY (p_vehicle_ids) AND ov.user_id = p_user_id
       AND ov.status IN ('approved', 'pending', 'documents_uploaded', 'ai_processing', 'human_review')
    UNION ALL
    SELECT jsonb_build_object('kind', 'ownership_period', 'table', 'vehicle_ownerships', 'id', o.id, 'vehicle_id', o.vehicle_id,
             'role', o.role, 'ownership_type', o.ownership_type, 'is_current', o.is_current)
      FROM public.vehicle_ownerships o
     WHERE o.vehicle_id = ANY (p_vehicle_ids) AND o.owner_profile_id = p_user_id AND o.superseded_at IS NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'owner_statement', 'table', 'vehicle_observations', 'id', s.id, 'vehicle_id', s.vehicle_id,
             'speaker_role', s.structured_data->>'speaker_role')
      FROM public.vehicle_observations s
     WHERE s.vehicle_id = ANY (p_vehicle_ids) AND s.submitted_by_user_id = p_user_id AND s.is_superseded IS NOT TRUE
       AND s.extraction_method = 'vehicle_statement_v1' AND s.structured_data->>'speaker_role' IN ('owner', 'previous_owner')
    UNION ALL
    SELECT jsonb_build_object('kind', 'owner_correction', 'table', 'vehicle_observations', 'id', s.id, 'vehicle_id', s.vehicle_id,
             'roles', s.structured_data->'correction'->'relationship'->'roles')
      FROM public.vehicle_observations s
     WHERE s.vehicle_id = ANY (p_vehicle_ids) AND s.submitted_by_user_id = p_user_id AND s.is_superseded IS NOT TRUE
       AND s.extraction_method = 'garage_owner_correction_v1'
       AND jsonb_typeof(s.structured_data->'correction'->'relationship'->'roles') = 'array'
       AND s.structured_data->'correction'->'relationship'->'roles' ?| ARRAY['owner_current', 'owner_past', 'transfer_pending', 'consignment']
       AND (s.structured_data->'correction'->'relationship'->>'ownership_denied') IS DISTINCT FROM 'true'
    UNION ALL
    SELECT jsonb_build_object('kind', 'ownership_paper', 'table', 'vehicle_observations', 'id', s.id, 'vehicle_id', s.vehicle_id,
             'method', s.extraction_method, 'document_type', s.structured_data->>'document_type')
      FROM public.vehicle_observations s
     WHERE s.vehicle_id = ANY (p_vehicle_ids) AND s.kind = 'ownership' AND s.is_superseded IS NOT TRUE
       AND (s.submitted_by_user_id = p_user_id OR s.submitted_by_user_id IS NULL)
    UNION ALL
    SELECT jsonb_build_object('kind', 'title_document', 'table', 'vehicle_documents', 'id', d.id, 'vehicle_id', d.vehicle_id,
             'document_type', d.document_type)
      FROM public.vehicle_documents d
     WHERE d.vehicle_id = ANY (p_vehicle_ids) AND d.uploaded_by = p_user_id
       AND lower(d.document_type) IN ('title', 'title_document', 'registration', 'registration_card', 'bill_of_sale')
    UNION ALL
    SELECT jsonb_build_object('kind', 'own_photos', 'table', 'vehicle_images', 'id', min(i.id::text), 'count', count(*),
             'first_taken', min(i.taken_at), 'last_taken', max(i.taken_at), 'sources', jsonb_agg(DISTINCT i.source))
      FROM public.vehicle_images i
     WHERE i.vehicle_id = ANY (p_vehicle_ids) AND i.user_id = p_user_id
       AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE
       AND (coalesce(i.vision_gate_status, '') NOT IN ('rejected_misattributed', 'rejected_personal') OR i.user_confirmed_vehicle IS TRUE)
       AND (i.source IN ('iphoto', 'iphoto_60d', 'ssd_blast', 'capture_relay_ios', 'hd_archive', 'drop-folder', 'dropbox',
                         'dropbox_import', 'library_recovery', 'photo_auto_sync', 'owner_capture')
            OR nullif(btrim(coalesce(i.exif_data->>'Make', i.exif_data->>'make', i.exif_data->>'camera_make',
                                     i.exif_data->'camera'->>'make')), '') IS NOT NULL)
    HAVING count(*) > 0
    UNION ALL
    SELECT jsonb_build_object('kind', 'work_order', 'table', 'work_orders', 'id', w.id, 'vehicle_id', w.vehicle_id,
             'status', w.status, 'as', CASE WHEN w.customer_id = p_user_id THEN 'customer' ELSE 'quoted_by' END)
      FROM public.work_orders w
     WHERE w.vehicle_id = ANY (p_vehicle_ids) AND (w.customer_id = p_user_id OR w.quoted_by = p_user_id)
  ) x
$function$;
COMMENT ON FUNCTION public.vehicle_tie_first_hand_evidence(uuid[], uuid) IS
  'The person''s first-hand evidence of ownership or custody on these vehicles, one entry per item (photos as one count): '
  'ownership verification or a submitted title, an ownership period, an owner statement or correction, ownership paper, '
  'a title document, own device photos (library source or camera EXIF), a work order as customer or quoter. '
  'Read by disclaim_vehicle_tie; an empty array means none.';

-- 5. The garage routes that tie the person to these vehicles (get_user_garage's own view plus the web hook's tables) ----
CREATE OR REPLACE FUNCTION public.vehicle_tie_garage_routes(p_vehicle_ids uuid[], p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x.e ORDER BY x.e->>'route', x.e->>'row_id'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('route', CASE p.role WHEN 'previously_owned' THEN 'previously_owned_permission'
             WHEN 'consigned' THEN 'consigned_permission' ELSE 'owner_permission' END,
             'table', 'vehicle_user_permissions', 'row_id', p.id) AS e
      FROM public.vehicle_user_permissions p
     WHERE p.vehicle_id = ANY (p_vehicle_ids) AND p.user_id = p_user_id AND p.revoked_at IS NULL AND coalesce(p.is_active, true)
       AND p.role IN ('owner', 'co_owner', 'previously_owned', 'consigned')
    UNION ALL
    SELECT jsonb_build_object('route', 'ownership_verification', 'table', 'ownership_verifications', 'row_id', ov.id)
      FROM public.ownership_verifications ov
     WHERE ov.vehicle_id = ANY (p_vehicle_ids) AND ov.user_id = p_user_id AND ov.status = 'approved'
    UNION ALL
    -- the web hook reads every period of the person, current or not
    SELECT jsonb_build_object('route', 'ownership_period', 'table', 'vehicle_ownerships', 'row_id', o.id)
      FROM public.vehicle_ownerships o WHERE o.vehicle_id = ANY (p_vehicle_ids) AND o.owner_profile_id = p_user_id
    UNION ALL
    SELECT jsonb_build_object('route', 'discovered_previously_owned', 'table', 'discovered_vehicles', 'row_id', d.id)
      FROM public.discovered_vehicles d
     WHERE d.vehicle_id = ANY (p_vehicle_ids) AND d.user_id = p_user_id AND d.is_active = true
       AND d.relationship_type = 'previously_owned'
    UNION ALL
    SELECT jsonb_build_object('route', 'recent_photos', 'table', 'vehicle_images', 'row_id', NULL, 'count', count(*))
      FROM public.vehicle_images i
     WHERE i.vehicle_id = ANY (p_vehicle_ids) AND i.user_id = p_user_id AND i.created_at >= now() - interval '60 days'
       AND coalesce(i.is_superseded, false) = false
    HAVING count(*) > 0
    UNION ALL
    SELECT jsonb_build_object('route', 'recent_work_sessions', 'table', 'work_sessions', 'row_id', NULL, 'count', count(*))
      FROM public.work_sessions w
     WHERE w.vehicle_id = ANY (p_vehicle_ids) AND w.user_id = p_user_id AND w.session_date >= current_date - 60
    HAVING count(*) > 0
    UNION ALL
    SELECT jsonb_build_object('route', 'contributor', 'table', 'vehicle_contributors', 'row_id', c.id)
      FROM public.vehicle_contributors c
     WHERE c.vehicle_id = ANY (p_vehicle_ids) AND c.user_id = p_user_id AND coalesce(c.status, 'active') = 'active'
    UNION ALL
    SELECT jsonb_build_object('route', 'profile_record', 'table', 'vehicles', 'row_id', v.id)
      FROM public.vehicles v
     WHERE v.id = ANY (p_vehicle_ids) AND v.user_id = p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    UNION ALL
    SELECT jsonb_build_object('route', 'owner_correction', 'table', 'vehicle_observations', 'row_id', s.id)
      FROM public.vehicle_observations s
     WHERE s.vehicle_id = ANY (p_vehicle_ids) AND s.submitted_by_user_id = p_user_id AND s.subject_type = 'user'
       AND s.subject_id = p_user_id AND s.extraction_method = 'garage_owner_correction_v1' AND s.is_superseded IS NOT TRUE
  ) x
$function$;
COMMENT ON FUNCTION public.vehicle_tie_garage_routes(uuid[], uuid) IS
  'Every route that puts these vehicles in the person''s garage (get_user_garage''s own view, plus the web hook''s '
  'vehicle_ownerships and owner corrections), one entry per row. Read by disclaim_vehicle_tie.';

-- 6. The writer ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disclaim_vehicle_tie(p_vehicle_id uuid, p_reason text, p_actor uuid,
  p_force_reason text DEFAULT NULL, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_as text;
  v_force text := nullif(btrim(coalesce(p_force_reason, '')), '');
  v_ids uuid[];
  v_rec record;
  r record;
  v_end jsonb := '[]'::jsonb;
  v_left jsonb := '[]'::jsonb;
  v_ended jsonb := '[]'::jsonb;
  v_evidence jsonb;
  v_routes jsonb;
  v_after_routes jsonb;
  v_run uuid;
  v_after jsonb;
  v_jid uuid;
  v_cols text;
BEGIN
  IF p_vehicle_id IS NULL OR p_actor IS NULL OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'disclaim_vehicle_tie: vehicle, actor and reason are required' USING ERRCODE = '22004';
  END IF;
  IF v_uid IS NOT NULL THEN
    IF v_uid IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'disclaim_vehicle_tie: a signed-in person disclaims only their own ties' USING ERRCODE = '42501';
    END IF;
    v_as := 'self';
  ELSIF coalesce(auth.role(), '') = 'service_role' THEN
    v_as := 'service_role';
  ELSE
    RAISE EXCEPTION 'disclaim_vehicle_tie: the signed-in person or the service role only' USING ERRCODE = '42501';
  END IF;

  SELECT v.id, v.user_id, v.owner_id INTO v_rec FROM public.vehicles v WHERE v.id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'vehicle_not_found', 'vehicle_id', p_vehicle_id);
  END IF;
  -- the vehicle and the ones merged into it (two hops), as get_user_garage follows them
  SELECT array_agg(DISTINCT x) INTO v_ids FROM (
    SELECT p_vehicle_id AS x
    UNION ALL SELECT m1.id FROM public.vehicles m1 WHERE m1.merged_into_vehicle_id = p_vehicle_id
    UNION ALL SELECT m2.id FROM public.vehicles m1 JOIN public.vehicles m2 ON m2.merged_into_vehicle_id = m1.id
               WHERE m1.merged_into_vehicle_id = p_vehicle_id) s;

  -- What could end, and what stays because a person made it. Rows are locked for the rest of the call.
  FOR r IN SELECT c.* FROM public.vehicle_contributors c
            WHERE c.vehicle_id = ANY (v_ids) AND c.user_id = p_actor AND coalesce(c.status, 'active') = 'active'
            ORDER BY c.id FOR UPDATE LOOP
    IF r.notes ILIKE 'Auto-derived%' OR r.notes ILIKE 'device_evidence (%' THEN
      v_end := v_end || jsonb_build_object('table', 'vehicle_contributors', 'row_id', r.id, 'vehicle_id', r.vehicle_id,
        'kind', 'contributor:' || r.role, 'made_by', left(r.notes, 60), 'created_at', r.created_at);
    ELSE
      v_left := v_left || jsonb_build_object('table', 'vehicle_contributors', 'row_id', r.id, 'vehicle_id', r.vehicle_id,
        'kind', 'contributor:' || r.role, 'why', 'a stated role, not written by an automatic job');
    END IF;
  END LOOP;
  FOR r IN SELECT p.* FROM public.vehicle_user_permissions p
            WHERE p.vehicle_id = ANY (v_ids) AND p.user_id = p_actor AND p.revoked_at IS NULL AND coalesce(p.is_active, true)
            ORDER BY p.id FOR UPDATE LOOP
    IF r.granted_by IS NULL THEN
      v_end := v_end || jsonb_build_object('table', 'vehicle_user_permissions', 'row_id', r.id, 'vehicle_id', r.vehicle_id,
        'kind', 'permission:' || r.role, 'made_by', left(coalesce(r.context, 'no grantor recorded'), 60), 'created_at', r.created_at);
    ELSE
      v_left := v_left || jsonb_build_object('table', 'vehicle_user_permissions', 'row_id', r.id, 'vehicle_id', r.vehicle_id,
        'kind', 'permission:' || r.role,
        'why', CASE WHEN r.granted_by = p_actor THEN 'granted by this account' ELSE 'granted by another account' END);
    END IF;
  END LOOP;
  FOR r IN SELECT d.* FROM public.discovered_vehicles d
            WHERE d.vehicle_id = ANY (v_ids) AND d.user_id = p_actor AND d.is_active = true ORDER BY d.id FOR UPDATE LOOP
    IF r.discovery_source LIKE 'system:%' THEN
      v_end := v_end || jsonb_build_object('table', 'discovered_vehicles', 'row_id', r.id, 'vehicle_id', r.vehicle_id,
        'kind', 'discovered:' || coalesce(r.relationship_type, 'unknown'), 'made_by', r.discovery_source, 'created_at', r.created_at);
    ELSE
      v_left := v_left || jsonb_build_object('table', 'discovered_vehicles', 'row_id', r.id, 'vehicle_id', r.vehicle_id,
        'kind', 'discovered:' || coalesce(r.relationship_type, 'unknown'),
        'why', 'the person''s own list (' || coalesce(r.discovery_source, 'no source recorded') || ')');
    END IF;
  END LOOP;
  IF v_rec.user_id = p_actor OR v_rec.owner_id = p_actor THEN
    v_cols := concat_ws('+', CASE WHEN v_rec.user_id = p_actor THEN 'user_id' END, CASE WHEN v_rec.owner_id = p_actor THEN 'owner_id' END);
    v_end := v_end || jsonb_build_object('table', 'vehicles', 'row_id', p_vehicle_id, 'vehicle_id', p_vehicle_id,
      'kind', 'record:' || v_cols);
  END IF;

  v_evidence := public.vehicle_tie_first_hand_evidence(v_ids, p_actor);
  v_routes := public.vehicle_tie_garage_routes(v_ids, p_actor);
  -- the routes that would remain once the planned ties end
  SELECT coalesce(jsonb_agg(g), '[]'::jsonb) INTO v_after_routes FROM jsonb_array_elements(v_routes) g
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_end) e
                      WHERE e->>'table' = g->>'table' AND e->>'row_id' = g->>'row_id');

  IF p_dry_run THEN
    RETURN jsonb_build_object('status', 'dry_run', 'vehicle_id', p_vehicle_id, 'actor', p_actor, 'called_as', v_as,
      'vehicle_ids', to_jsonb(v_ids), 'would_end', v_end, 'left', v_left, 'blocked_by', v_evidence,
      'would_refuse', jsonb_array_length(v_evidence) > 0 AND (v_force IS NULL OR v_as <> 'self'),
      'in_garage_by', v_routes, 'still_in_garage_by', v_after_routes);
  END IF;
  IF v_force IS NOT NULL AND v_as <> 'self' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'force_needs_signed_in_person', 'vehicle_id', p_vehicle_id,
      'blocked_by', v_evidence, 'would_end', v_end, 'left', v_left);
  END IF;
  IF jsonb_array_length(v_evidence) > 0 AND v_force IS NULL THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'first_hand_evidence', 'vehicle_id', p_vehicle_id,
      'blocked_by', v_evidence, 'would_end', v_end, 'left', v_left, 'in_garage_by', v_routes);
  END IF;
  IF jsonb_array_length(v_end) = 0 THEN
    RETURN jsonb_build_object('status', 'nothing_to_end', 'vehicle_id', p_vehicle_id, 'left', v_left,
      'blocked_by', v_evidence, 'still_in_garage_by', v_routes);
  END IF;

  v_run := gen_random_uuid();
  FOR r IN SELECT c.* FROM public.vehicle_contributors c
            WHERE c.id IN (SELECT (e->>'row_id')::uuid FROM jsonb_array_elements(v_end) e WHERE e->>'table' = 'vehicle_contributors')
            ORDER BY c.id LOOP
    UPDATE public.vehicle_contributors c SET status = 'inactive', end_date = current_date, updated_at = now()
     WHERE c.id = r.id RETURNING to_jsonb(c.*) INTO v_after;
    INSERT INTO public.vehicle_tie_journal (run_id, vehicle_id, user_id, tie_table, tie_row_id, tie_kind, before_image,
      after_image, reason, force_reason, overridden_evidence, called_as)
    VALUES (v_run, p_vehicle_id, p_actor, 'vehicle_contributors', r.id, 'contributor:' || r.role, to_jsonb(r), v_after,
      p_reason, v_force, CASE WHEN v_force IS NULL THEN '[]'::jsonb ELSE v_evidence END, v_as)
    RETURNING id INTO v_jid;
    v_ended := v_ended || jsonb_build_object('journal_id', v_jid, 'table', 'vehicle_contributors', 'row_id', r.id,
      'kind', 'contributor:' || r.role);
  END LOOP;
  FOR r IN SELECT p.* FROM public.vehicle_user_permissions p
            WHERE p.id IN (SELECT (e->>'row_id')::uuid FROM jsonb_array_elements(v_end) e WHERE e->>'table' = 'vehicle_user_permissions')
            ORDER BY p.id LOOP
    UPDATE public.vehicle_user_permissions p SET is_active = false, revoked_at = now(), revoked_by = p_actor,
           context = concat_ws(' | ', nullif(p.context, ''), 'ended by disclaim_vehicle_tie run ' || v_run)
     WHERE p.id = r.id RETURNING to_jsonb(p.*) INTO v_after;
    INSERT INTO public.vehicle_tie_journal (run_id, vehicle_id, user_id, tie_table, tie_row_id, tie_kind, before_image,
      after_image, reason, force_reason, overridden_evidence, called_as)
    VALUES (v_run, p_vehicle_id, p_actor, 'vehicle_user_permissions', r.id, 'permission:' || r.role, to_jsonb(r), v_after,
      p_reason, v_force, CASE WHEN v_force IS NULL THEN '[]'::jsonb ELSE v_evidence END, v_as)
    RETURNING id INTO v_jid;
    v_ended := v_ended || jsonb_build_object('journal_id', v_jid, 'table', 'vehicle_user_permissions', 'row_id', r.id,
      'kind', 'permission:' || r.role);
  END LOOP;
  FOR r IN SELECT d.* FROM public.discovered_vehicles d
            WHERE d.id IN (SELECT (e->>'row_id')::uuid FROM jsonb_array_elements(v_end) e WHERE e->>'table' = 'discovered_vehicles')
            ORDER BY d.id LOOP
    UPDATE public.discovered_vehicles d SET is_active = false WHERE d.id = r.id RETURNING to_jsonb(d.*) INTO v_after;
    INSERT INTO public.vehicle_tie_journal (run_id, vehicle_id, user_id, tie_table, tie_row_id, tie_kind, before_image,
      after_image, reason, force_reason, overridden_evidence, called_as)
    VALUES (v_run, p_vehicle_id, p_actor, 'discovered_vehicles', r.id, 'discovered:' || coalesce(r.relationship_type, 'unknown'),
      to_jsonb(r), v_after, p_reason, v_force, CASE WHEN v_force IS NULL THEN '[]'::jsonb ELSE v_evidence END, v_as)
    RETURNING id INTO v_jid;
    v_ended := v_ended || jsonb_build_object('journal_id', v_jid, 'table', 'discovered_vehicles', 'row_id', r.id,
      'kind', 'discovered:' || coalesce(r.relationship_type, 'unknown'));
  END LOOP;
  IF v_cols IS NOT NULL THEN
    -- one row, by primary key, only while it still holds what was read above
    UPDATE public.vehicles v
       SET user_id = CASE WHEN v.user_id = p_actor THEN NULL ELSE v.user_id END,
           owner_id = CASE WHEN v.owner_id = p_actor THEN NULL ELSE v.owner_id END
     WHERE v.id = p_vehicle_id AND v.user_id IS NOT DISTINCT FROM v_rec.user_id AND v.owner_id IS NOT DISTINCT FROM v_rec.owner_id
    RETURNING jsonb_build_object('user_id', v.user_id, 'owner_id', v.owner_id) INTO v_after;
    IF FOUND THEN
      INSERT INTO public.vehicle_tie_journal (run_id, vehicle_id, user_id, tie_table, tie_row_id, tie_kind, before_image,
        after_image, reason, force_reason, overridden_evidence, called_as)
      VALUES (v_run, p_vehicle_id, p_actor, 'vehicles', p_vehicle_id, 'record:' || v_cols,
        jsonb_build_object('user_id', v_rec.user_id, 'owner_id', v_rec.owner_id), v_after,
        p_reason, v_force, CASE WHEN v_force IS NULL THEN '[]'::jsonb ELSE v_evidence END, v_as)
      RETURNING id INTO v_jid;
      v_ended := v_ended || jsonb_build_object('journal_id', v_jid, 'table', 'vehicles', 'row_id', p_vehicle_id, 'kind', 'record:' || v_cols);
    ELSE
      v_left := v_left || jsonb_build_object('table', 'vehicles', 'row_id', p_vehicle_id, 'kind', 'record:' || v_cols,
        'why', 'the record changed during the call');
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'disclaimed', 'vehicle_id', p_vehicle_id, 'actor', p_actor, 'called_as', v_as,
    'run_id', v_run, 'ended', v_ended, 'left', v_left, 'forced', v_force IS NOT NULL,
    'overridden_evidence', CASE WHEN v_force IS NULL THEN '[]'::jsonb ELSE v_evidence END,
    'still_in_garage_by', public.vehicle_tie_garage_routes(v_ids, p_actor));
END
$function$;
COMMENT ON FUNCTION public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean) IS
  'Ends the ties between a person and a vehicle that an importer or agent made (automatic contributor rows, permission '
  'rows no person granted, system discoveries, the record''s user_id/owner_id), one vehicle_tie_journal row each with '
  'the before-image; the vehicle, its photos and evidence are untouched. Refused (blocked_by) when the person has '
  'first-hand evidence, unless the signed-in person passes p_force_reason. p_dry_run answers the plan and writes nothing. '
  'Callers: the signed-in person for themselves, or the service role naming them. Undo: restore_vehicle_tie.';

-- 7. The undo ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_vehicle_tie(p_journal_id uuid, p_run_id uuid, p_actor uuid, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  j record;
  b jsonb;
  a jsonb;
  v_ok boolean;
  v_why text;
  v_restored jsonb := '[]'::jsonb;
  v_not jsonb := '[]'::jsonb;
BEGIN
  IF p_actor IS NULL OR (p_journal_id IS NULL) = (p_run_id IS NULL) THEN
    RAISE EXCEPTION 'restore_vehicle_tie: the actor and exactly one of journal id or run id are required' USING ERRCODE = '22004';
  END IF;
  IF v_uid IS NOT NULL THEN
    IF v_uid IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'restore_vehicle_tie: a signed-in person restores only their own ties' USING ERRCODE = '42501';
    END IF;
  ELSIF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'restore_vehicle_tie: the signed-in person or the service role only' USING ERRCODE = '42501';
  END IF;

  FOR j IN SELECT * FROM public.vehicle_tie_journal t
            WHERE (t.id = p_journal_id OR t.run_id = p_run_id) AND t.user_id = p_actor AND t.restored_at IS NULL
            ORDER BY t.created_at, t.id FOR UPDATE LOOP
    b := j.before_image; a := j.after_image; v_ok := false; v_why := NULL;
    BEGIN
      IF j.tie_table = 'vehicle_contributors' THEN
        UPDATE public.vehicle_contributors c SET status = b->>'status', end_date = (b->>'end_date')::date, updated_at = now()
         WHERE c.id = j.tie_row_id AND c.status IS NOT DISTINCT FROM a->>'status'
           AND c.end_date IS NOT DISTINCT FROM (a->>'end_date')::date;
        v_ok := FOUND;
      ELSIF j.tie_table = 'vehicle_user_permissions' THEN
        -- a row no person granted comes back granted by the person restoring it (every live grant names its author)
        UPDATE public.vehicle_user_permissions p SET is_active = (b->>'is_active')::boolean,
               revoked_at = (b->>'revoked_at')::timestamptz, revoked_by = (b->>'revoked_by')::uuid,
               granted_by = coalesce((b->>'granted_by')::uuid, p_actor),
               granted_at = CASE WHEN b->>'granted_by' IS NULL THEN now() ELSE (b->>'granted_at')::timestamptz END,
               context = b->>'context'
         WHERE p.id = j.tie_row_id AND p.is_active IS FALSE AND p.revoked_at = (a->>'revoked_at')::timestamptz;
        v_ok := FOUND;
      ELSIF j.tie_table = 'discovered_vehicles' THEN
        UPDATE public.discovered_vehicles d SET is_active = (b->>'is_active')::boolean
         WHERE d.id = j.tie_row_id AND d.is_active IS FALSE;
        v_ok := FOUND;
      ELSE
        UPDATE public.vehicles v
           SET user_id = CASE WHEN (b->>'user_id')::uuid = p_actor AND v.user_id IS NULL THEN p_actor ELSE v.user_id END,
               owner_id = CASE WHEN (b->>'owner_id')::uuid = p_actor AND v.owner_id IS NULL THEN p_actor ELSE v.owner_id END
         WHERE v.id = j.tie_row_id
           AND (((b->>'user_id')::uuid = p_actor AND v.user_id IS NULL) OR ((b->>'owner_id')::uuid = p_actor AND v.owner_id IS NULL));
        v_ok := FOUND;
      END IF;
      IF NOT v_ok THEN v_why := 'the row changed since it was ended; left as it is'; END IF;
    EXCEPTION WHEN raise_exception OR check_violation OR foreign_key_violation OR unique_violation THEN
      v_ok := false; v_why := 'refused by ' || SQLERRM;
    END;
    IF v_ok THEN
      UPDATE public.vehicle_tie_journal SET restored_at = now(), restored_by = p_actor, restore_note = p_note WHERE id = j.id;
      v_restored := v_restored || jsonb_build_object('journal_id', j.id, 'table', j.tie_table, 'row_id', j.tie_row_id, 'kind', j.tie_kind);
    ELSE
      UPDATE public.vehicle_tie_journal SET restore_note = v_why WHERE id = j.id;
      v_not := v_not || jsonb_build_object('journal_id', j.id, 'table', j.tie_table, 'row_id', j.tie_row_id, 'kind', j.tie_kind, 'why', v_why);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('restored', v_restored, 'not_restored', v_not, 'run_id', p_run_id, 'journal_id', p_journal_id);
END
$function$;
COMMENT ON FUNCTION public.restore_vehicle_tie(uuid, uuid, uuid, text) IS
  'Puts back the ties one disclaim_vehicle_tie run (or one journal row) ended, each only if it is still as the run left '
  'it; a permission row no person granted returns granted by the restoring person. Returns restored and not_restored '
  'with the reason. Callers: the person whose ties they were, or the service role naming them.';

-- 8. The garage reader reads only active contributor rows ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text, last_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The owner, or the service role (no user id; the books and attribution scripts), sees everything.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  -- prec = precedence when one vehicle is reached by several routes (lower wins).
  --   1 owner | 2 previously_owned | 3 consigned (significant non-owner role) | 4 documenting (own photos / work in last 60d)
  --   5 contributor | 6 profile_record
  src AS (
    -- owner / co_owner permissions and approved title verifications: 'owner' (owner's own view and the public projection alike)
    SELECT vehicle_id, 1 prec, NULL::timestamptz act FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role IN ('owner','co_owner')
    UNION ALL SELECT vehicle_id, 1, NULL FROM ownership_verifications WHERE user_id=p_user_id AND status='approved'
    -- Owner-only routes (every relationship the record holds).
    UNION ALL SELECT vehicle_id, 1, NULL FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true AND (SELECT is_own FROM viewer)
    -- significant non-owner roles carried as their own role
    UNION ALL SELECT vehicle_id, 2, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 2, NULL FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 3, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='consigned' AND (SELECT is_own FROM viewer)
    -- documenting: own photo uploads or work sessions in the last 60 days, ranked by recency
    UNION ALL SELECT vi.vehicle_id, 4, max(vi.created_at) FROM vehicle_images vi
      WHERE vi.user_id=p_user_id AND vi.vehicle_id IS NOT NULL AND vi.created_at >= now() - interval '60 days'
        AND coalesce(vi.is_superseded,false)=false AND (SELECT is_own FROM viewer)
      GROUP BY vi.vehicle_id
    UNION ALL SELECT ws.vehicle_id, 4, max(ws.session_date)::timestamptz FROM work_sessions ws
      WHERE ws.user_id=p_user_id AND ws.vehicle_id IS NOT NULL AND ws.session_date >= current_date - 60 AND (SELECT is_own FROM viewer)
      GROUP BY ws.vehicle_id
    -- an ended contributor row (status other than active: disclaim_vehicle_tie, earlier deactivations) is not a tie
    UNION ALL SELECT vehicle_id, 5, NULL FROM vehicle_contributors WHERE user_id=p_user_id AND coalesce(status, 'active') = 'active'
      AND (SELECT is_own FROM viewer)
    -- Creating a profile relates it to this account; it does not establish ownership.
    UNION ALL SELECT v.id, 6, NULL FROM vehicles v
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND (SELECT is_own FROM viewer)
  ),
  -- follow merged_into_vehicle_id (two hops) to the canonical vehicle
  canon AS (
    SELECT coalesce(m2.id, m1.id, sv.id) AS vid, s.prec, s.act
    FROM src s
    JOIN vehicles sv ON sv.id = s.vehicle_id
    LEFT JOIN vehicles m1 ON m1.id = sv.merged_into_vehicle_id
    LEFT JOIN vehicles m2 ON m2.id = m1.merged_into_vehicle_id
  ),
  dedup AS (SELECT vid AS vehicle_id, MIN(prec) pr, max(act) act FROM canon GROUP BY vid)
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                       -- the definer skips RLS and the vision gate; a stranger gets only an admitted frame
                       AND ((SELECT is_own FROM viewer) OR public.vehicle_image_gallery_eligible(vi2))
                     ORDER BY vi2.created_at LIMIT 1)),
         -- the stored class price (vehicle_class_price, written by refresh_vehicle_class_price); never nuke_estimates
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 6 THEN
           (SELECT cp.value FROM vehicle_class_price cp
              WHERE cp.vehicle_id = v.id AND cp.status = 'priced') END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 6 THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' WHEN 3 THEN 'consigned' WHEN 4 THEN 'documenting' WHEN 5 THEN 'contributor' ELSE 'profile_record' END,
         -- genuine activity only (EXIF photos by owner/contributors, real work sessions, genuine timeline events); see vehicle_activity
         va.last_activity_at
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN vehicle_activity va ON va.vehicle_id = v.id
  WHERE v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL
    AND ((SELECT is_own FROM viewer) OR v.is_public = true)
  -- display order: consigned (active deal) ranks above documenting (photos only) and previously_owned (historical)
  -- owner > consigned > documenting > previously_owned > contributor > profile_record
  ORDER BY CASE d.pr WHEN 1 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 2 THEN 4 WHEN 5 THEN 5 ELSE 6 END,
           va.last_activity_at DESC NULLS LAST, v.year;
$function$;

-- 9. Grants --------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.vehicle_tie_first_hand_evidence(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vehicle_tie_garage_routes(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_vehicle_tie(uuid, uuid, uuid, text) FROM PUBLIC;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.vehicle_tie_first_hand_evidence(uuid[], uuid) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.vehicle_tie_garage_routes(uuid[], uuid) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.restore_vehicle_tie(uuid, uuid, uuid, text) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean) TO authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.restore_vehicle_tie(uuid, uuid, uuid, text) TO authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_tie_first_hand_evidence(uuid[], uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_tie_garage_routes(uuid[], uuid) TO service_role';
  END IF;
END $g$;

COMMIT;
