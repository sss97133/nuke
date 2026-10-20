-- Parts by job (owner, 2026-10-20): the tech approves eBay listings for a job's parts; the approval is a Sign on the job's
-- parts list, and the approved list hands off to eBay's own checkout (one link per item; nothing is ordered here).
--
-- Where it lives (extend, not mint): a job's parts list is work_order_parts (one row per part line); the offers recorded
-- against a part line are part_alternatives (grain: part line x offer; read by work_order_part_read since 20261020084500).
-- An approved eBay listing is an offer the tech selected, so it is a part_alternatives row with the Sign's columns, the way
-- 20261019180000 made provider offers columns on work_order_resource_fulfillments instead of a new table.
--
--   part_alternatives gains approval_observation_id (the signed owner-input work_record), approved_by_user_id,
--     approver_role, approved_at, approval_reason (the why, in the approver's words), listing (the listing as the parts
--     finder showed it: eBay item number and page, title, price, stated shipping, condition, eBay's fit verdict and the
--     fitment it was checked on, the finder's rank and reasons, and observed_at) and superseded_at / superseded_by.
--     brand becomes nullable (a search result states no brand). Approval rows are written only by the projector below,
--     never updated except to be superseded once, never deleted: a part line holding an approval cannot be deleted
--     (the cascade from work_order_parts is refused). Rows without an approval are the legacy offers, unchanged.
--   approve_job_part_listing(p_work_order_id, p_listing, p_reason, p_work_order_part_id, p_part_name, p_part_number,
--     p_quantity) is the Sign. Signers: the parties work_order_evidence_role names (customer, accepted provider,
--     organization owner or member). The job must be open and bound to a vehicle. The listing must be an eBay item page
--     read in the last two hours (the finder caches nothing longer). Without a part line id the Sign adds the line to the
--     job's parts list (status quoted, added_by the signer), or uses the open line of that exact name. One current
--     approval per part line and eBay item: approving it again with a new reason supersedes the old row. Idempotent.
--     One owner-input work_record (envelope work_order_part_listing_approval v1) in the same transaction, projected by
--     project_work_order_part_listing_approval. The seller's eBay username is not stored.
--   Readers: work_order_operations_read gives each part its current approved_listings (the reason to parties only) and a
--     top-level part_approval (the viewer's approver role, null when the viewer cannot approve); work_order_part_read
--     drops superseded approvals from offers and adds each offer's approval. Anchored edits of the live definitions.
-- No order, no payment, no cart: eBay's checkout is the buyer's own step.
-- Contract: supabase/sql/test_work_order_part_listing_approvals.sql (PG17); replayed by test_job_loop_replay.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.part_alternatives
  ALTER COLUMN brand DROP NOT NULL,
  ADD COLUMN approval_observation_id uuid UNIQUE REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  ADD COLUMN approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN approver_role text CHECK (approver_role IN ('customer','accepted_provider','organization_owner','organization_member')),
  ADD COLUMN approved_at timestamptz CHECK (isfinite(approved_at)),
  ADD COLUMN approval_reason text CHECK (length(btrim(approval_reason)) BETWEEN 1 AND 500),
  ADD COLUMN listing jsonb CHECK (jsonb_typeof(listing) = 'object'),
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_by uuid REFERENCES public.part_alternatives(id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT part_alternatives_approval_complete
    CHECK (num_nonnulls(approval_observation_id, approved_by_user_id, approver_role, approved_at, approval_reason, listing) IN (0,6)),
  ADD CONSTRAINT part_alternatives_supersession
    CHECK ((superseded_at IS NULL AND superseded_by IS NULL) OR (approval_observation_id IS NOT NULL AND superseded_at IS NOT NULL));
CREATE UNIQUE INDEX part_alternatives_one_current_approval ON public.part_alternatives
  (work_order_part_id, (listing->>'marketplace'), (listing->>'item_id'))
  WHERE approval_observation_id IS NOT NULL AND superseded_at IS NULL;
COMMENT ON TABLE public.part_alternatives IS 'Offers recorded against a work order part line: one row per offer with brand, part number, retailer, price and stock (grain: work order part x offer). Legacy rows 2026-02-04 have no writer. Approved marketplace listings (approval_observation_id set) are written only by approve_job_part_listing through project_work_order_part_listing_approval; immutable except superseded once; never deleted.';
COMMENT ON COLUMN public.part_alternatives.approval_observation_id IS 'The signed owner-input work_record of the approval (approve_job_part_listing). Null on legacy offers.';
COMMENT ON COLUMN public.part_alternatives.approver_role IS 'The approver''s role on the work order at sign time (work_order_evidence_role): customer, accepted_provider, organization_owner or organization_member.';
COMMENT ON COLUMN public.part_alternatives.approval_reason IS 'Why the listing was approved, in the approver''s words. Returned to parties only.';
COMMENT ON COLUMN public.part_alternatives.listing IS 'The listing as the parts finder showed it at listing.observed_at: marketplace, item_id, item_url, title, price, currency, shipping, total, condition, fit (eBay''s verdict: exact, possible or unknown) and fit_properties, fit_note, rank, why. Not a current price; not an order.';

-- Approval rows: inserted only with their signed source, never edited but to be superseded once, never deleted.
CREATE FUNCTION public.part_alternatives_approval_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.approval_observation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicle_observations o
        WHERE o.id = NEW.approval_observation_id AND o.extraction_method = 'work_order_part_listing_approval_sign_v1'
          AND o.submitted_by_user_id = NEW.approved_by_user_id) THEN
      RAISE EXCEPTION 'Approvals are written only by approve_job_part_listing';
    END IF;
    IF NEW.approval_observation_id IS NULL AND NEW.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'Only approvals are superseded'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.approval_observation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Approved listings are kept: this part line holds an approval and cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.approval_observation_id IS NULL THEN
    IF NEW.approval_observation_id IS NOT NULL OR NEW.listing IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'Approvals are written only by approve_job_part_listing';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by') THEN
    RAISE EXCEPTION 'Approved listings are immutable except for being superseded once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER part_alternatives_approval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.part_alternatives
  FOR EACH ROW EXECUTE FUNCTION public.part_alternatives_approval_guard();
CREATE FUNCTION public.part_alternatives_no_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.part_alternatives WHERE approval_observation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Approved listings are kept; part_alternatives cannot be truncated';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER part_alternatives_no_truncate BEFORE TRUNCATE ON public.part_alternatives
  FOR EACH STATEMENT EXECUTE FUNCTION public.part_alternatives_no_truncate();

-- The listing as presented, checked; null when it may be approved.
CREATE FUNCTION public.work_order_part_listing_refusal(p jsonb, p_now timestamptz) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE obs timestamptz;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN 'A listing is required'; END IF;
  IF p->>'marketplace' IS DISTINCT FROM 'ebay' THEN RETURN 'Only eBay listings are approved here'; END IF;
  IF COALESCE(p->>'item_id', '') !~ '^[0-9]{6,20}$' THEN RETURN 'The listing needs its eBay item number'; END IF;
  IF COALESCE(p->>'item_url', '') !~ ('^https://www\.ebay\.com/itm/' || (p->>'item_id') || '(\?fits=[^\s"<>#&]*)?$') THEN
    RETURN 'The listing link must be its eBay item page';
  END IF;
  IF length(btrim(COALESCE(p->>'title', ''))) NOT BETWEEN 1 AND 300 THEN RETURN 'The listing needs its title'; END IF;
  IF jsonb_typeof(p->'price') IS DISTINCT FROM 'number' OR (p->>'price')::numeric <= 0 OR (p->>'price')::numeric >= 1000000 THEN
    RETURN 'The listing price must be a positive amount';
  END IF;
  IF COALESCE(p->>'currency', '') !~ '^[A-Z]{3}$' THEN RETURN 'The listing price needs its currency'; END IF;
  IF COALESCE(jsonb_typeof(p->'shipping'), 'null') NOT IN ('number', 'null')
     OR (jsonb_typeof(p->'shipping') = 'number' AND (p->>'shipping')::numeric < 0) THEN
    RETURN 'Shipping must be an amount, or not stated';
  END IF;
  IF COALESCE(p->>'fit', '') NOT IN ('exact', 'possible', 'unknown') THEN RETURN 'Fit must be exact, possible or unknown'; END IF;
  BEGIN obs := (p->>'observed_at')::timestamptz;
  EXCEPTION WHEN others THEN RETURN 'The listing needs the clock it was read at'; END;
  IF obs IS NULL OR NOT isfinite(obs) OR obs > p_now + interval '5 minutes' THEN RETURN 'The listing needs the clock it was read at'; END IF;
  IF obs < p_now - interval '2 hours' THEN RETURN 'This listing was read more than two hours ago; search again before approving it'; END IF;
  RETURN NULL;
END $$;

-- The stored snapshot: named fields only (no seller username, nothing the finder did not show).
CREATE FUNCTION public.work_order_part_listing_snapshot(p jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'marketplace', 'ebay', 'item_id', p->>'item_id', 'item_url', p->>'item_url', 'title', left(btrim(p->>'title'), 300),
    'image_url', CASE WHEN p->>'image_url' ~ '^https://i\.ebayimg\.com/[^\s"<>]+$' THEN p->>'image_url' END,
    'price', (p->>'price')::numeric, 'currency', p->>'currency',
    'shipping', CASE WHEN jsonb_typeof(p->'shipping') = 'number' THEN (p->>'shipping')::numeric END,
    'shipping_basis', CASE WHEN p->>'shipping_basis' IN ('free', 'stated', 'not_stated') THEN p->>'shipping_basis' END,
    'total', CASE WHEN jsonb_typeof(p->'shipping') = 'number' THEN (p->>'price')::numeric + (p->>'shipping')::numeric END,
    'condition', left(p->>'condition', 80), 'condition_id', CASE WHEN p->>'condition_id' ~ '^[0-9]{1,5}$' THEN p->>'condition_id' END,
    'fit', p->>'fit',
    'fit_properties', CASE WHEN jsonb_typeof(p->'fit_properties') = 'array' THEN (SELECT jsonb_agg(jsonb_build_object('name', left(x->>'name', 40), 'value', left(x->>'value', 120)))
      FROM (SELECT x FROM jsonb_array_elements(p->'fit_properties') x WHERE jsonb_typeof(x) = 'object' LIMIT 8) y) END,
    'fit_note', left(p->>'fit_note', 300),
    'rank', CASE WHEN p->>'rank' ~ '^[0-9]{1,3}$' THEN (p->>'rank')::integer END,
    'why', CASE WHEN jsonb_typeof(p->'why') = 'array' THEN (SELECT jsonb_agg(left(x #>> '{}', 300))
      FROM (SELECT x FROM jsonb_array_elements(p->'why') x WHERE jsonb_typeof(x) = 'string' LIMIT 10) y) END,
    'seller_feedback_percentage', CASE WHEN jsonb_typeof(p->'seller_feedback_percentage') = 'number' THEN (p->>'seller_feedback_percentage')::numeric END,
    'seller_feedback_score', CASE WHEN jsonb_typeof(p->'seller_feedback_score') = 'number' THEN (p->>'seller_feedback_score')::numeric END,
    'observed_at', (p->>'observed_at')::timestamptz))
$$;

CREATE FUNCTION public.project_work_order_part_listing_approval(p_observation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  part public.work_order_parts%ROWTYPE;
  role text;
  cur public.part_alternatives%ROWTYPE;
  new_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.submitted_by_user_id IS NULL
     OR o.extraction_method IS DISTINCT FROM 'work_order_part_listing_approval_sign_v1'
     OR o.source_id IS DISTINCT FROM (SELECT id FROM public.observation_sources WHERE slug = 'owner-input') THEN
    RAISE EXCEPTION 'Current signed owner-input work_record required';
  END IF;
  e := o.structured_data->'work_order_part_listing_approval';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'work_order_part_listing_approval version 1 envelope required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.part_alternatives WHERE approval_observation_id = o.id) THEN
    RETURN jsonb_build_object('id', (SELECT id FROM public.part_alternatives WHERE approval_observation_id = o.id), 'duplicate', true);
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = (e->>'work_order_id')::uuid;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  role := public.work_order_evidence_role(w.id, o.submitted_by_user_id);
  IF role IS NULL OR role IS DISTINCT FROM e->>'approver_role' THEN RAISE EXCEPTION 'Signer is not a party to this work order'; END IF;
  SELECT * INTO part FROM public.work_order_parts WHERE id = (e->>'work_order_part_id')::uuid AND work_order_id = w.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Part line is not on this work order'; END IF;
  IF public.work_order_part_listing_refusal(e->'listing', o.observed_at) IS NOT NULL THEN
    RAISE EXCEPTION '%', public.work_order_part_listing_refusal(e->'listing', o.observed_at);
  END IF;
  SELECT * INTO cur FROM public.part_alternatives
  WHERE work_order_part_id = part.id AND approval_observation_id IS NOT NULL AND superseded_at IS NULL
    AND listing->>'marketplace' = e#>>'{listing,marketplace}' AND listing->>'item_id' = e#>>'{listing,item_id}'
  FOR UPDATE;
  IF cur.id IS NOT NULL THEN
    UPDATE public.part_alternatives SET superseded_at = o.observed_at, superseded_by = new_id WHERE id = cur.id;
  END IF;
  INSERT INTO public.part_alternatives(id, work_order_part_id, brand, part_number, condition, retailer, price, store_location, in_stock,
    url, is_selected, notes, created_at, approval_observation_id, approved_by_user_id, approver_role, approved_at, approval_reason, listing)
  VALUES (new_id, part.id, NULL, part.part_number, e#>>'{listing,condition}', 'eBay', (e#>>'{listing,price}')::numeric, NULL, NULL,
    e#>>'{listing,item_url}', true, NULL, o.observed_at, o.id, o.submitted_by_user_id, role, o.observed_at, e->>'reason', e->'listing');
  RETURN jsonb_build_object('id', new_id, 'superseded', cur.id, 'duplicate', false);
END $$;

CREATE FUNCTION public.approve_job_part_listing(p_work_order_id uuid, p_listing jsonb, p_reason text,
  p_work_order_part_id uuid DEFAULT NULL, p_part_name text DEFAULT NULL, p_part_number text DEFAULT NULL, p_quantity integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  role text;
  refusal text;
  part public.work_order_parts%ROWTYPE;
  same_name integer;
  created boolean := false;
  owner_source uuid;
  snap jsonb;
  request_key text;
  dup public.part_alternatives%ROWTYPE;
  obs_id uuid;
  proj jsonb;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  role := public.work_order_evidence_role(p_work_order_id, signer);
  IF w.id IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Work order unavailable for part approval' USING ERRCODE = '42501'; END IF;
  IF w.vehicle_id IS NULL THEN RAISE EXCEPTION 'Part approval needs a work order bound to a vehicle' USING ERRCODE = '23514'; END IF;
  IF COALESCE(w.status, '') IN ('completed', 'paid', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'This job is %; parts are approved on open jobs', w.status USING ERRCODE = '23514';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Say why you approve this listing (1 to 500 characters)' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Quantity must be 1 to 100' USING ERRCODE = '22023'; END IF;
  refusal := public.work_order_part_listing_refusal(p_listing, signed);
  IF refusal IS NOT NULL THEN RAISE EXCEPTION '%', refusal USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_part_approval:' || w.id::text, 0));

  IF p_work_order_part_id IS NOT NULL THEN
    SELECT * INTO part FROM public.work_order_parts WHERE id = p_work_order_part_id AND work_order_id = w.id;
    IF part.id IS NULL THEN RAISE EXCEPTION 'That part line is not on this job' USING ERRCODE = '23514'; END IF;
  ELSE
    IF p_part_name IS NULL OR length(btrim(p_part_name)) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Name the part (1 to 200 characters) or choose a part line' USING ERRCODE = '22023';
    END IF;
    IF p_part_number IS NOT NULL AND length(btrim(p_part_number)) > 60 THEN RAISE EXCEPTION 'Part number must be at most 60 characters' USING ERRCODE = '22023'; END IF;
    SELECT count(*) INTO same_name FROM public.work_order_parts
    WHERE work_order_id = w.id AND lower(btrim(part_name)) = lower(btrim(p_part_name)) AND COALESCE(status, '') NOT IN ('cancelled', 'not_used');
    IF same_name > 1 THEN
      RAISE EXCEPTION 'Several part lines on this job are named "%"; choose one', btrim(p_part_name) USING ERRCODE = '23514';
    END IF;
    SELECT * INTO part FROM public.work_order_parts
    WHERE work_order_id = w.id AND lower(btrim(part_name)) = lower(btrim(p_part_name)) AND COALESCE(status, '') NOT IN ('cancelled', 'not_used');
  END IF;
  IF part.id IS NOT NULL AND COALESCE(part.status, '') IN ('cancelled', 'not_used') THEN
    RAISE EXCEPTION 'That part line is %', part.status USING ERRCODE = '23514';
  END IF;

  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  snap := public.work_order_part_listing_snapshot(p_listing);
  -- The request as asked (part line id, or the part name), so a replay that finds the line it created is still a replay.
  request_key := md5(jsonb_build_array('work-order-part-listing', signer, w.id,
    COALESCE(p_work_order_part_id::text, lower(btrim(p_part_name))), snap->>'item_id', btrim(p_reason))::text);
  SELECT pa.* INTO dup FROM public.part_alternatives pa JOIN public.vehicle_observations o ON o.id = pa.approval_observation_id
  WHERE o.source_id = owner_source AND o.source_identifier = 'work_order_part_approval:' || w.id::text AND o.content_hash = request_key
    AND o.is_superseded IS FALSE AND pa.superseded_at IS NULL;
  IF dup.id IS NOT NULL THEN
    RETURN jsonb_build_object('approval_id', dup.id, 'work_order_id', w.id, 'work_order_part_id', dup.work_order_part_id, 'part_line_created', false,
      'superseded', NULL, 'approved_at', dup.approved_at, 'approver_role', dup.approver_role, 'item_id', dup.listing->>'item_id',
      'item_url', dup.listing->>'item_url', 'duplicate', true, 'ordered', false, 'payment_authorized', false);
  END IF;

  IF part.id IS NULL THEN
    INSERT INTO public.work_order_parts(id, work_order_id, part_name, part_number, quantity, status, added_by, user_verified, ai_extracted, created_at, updated_at)
    VALUES (gen_random_uuid(), w.id, btrim(p_part_name), NULLIF(btrim(COALESCE(p_part_number, '')), ''), p_quantity, 'quoted', signer, true, false, signed, signed)
    RETURNING * INTO part;
    created := true;
  END IF;

  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method,
    confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_part_approval:' || w.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    format('A party approved eBay item %s for the part line "%s" on work order %s.', snap->>'item_id', part.part_name, w.id), request_key,
    jsonb_build_object('work_order_part_listing_approval', jsonb_build_object('version', 1, 'work_order_id', w.id, 'work_order_part_id', part.id,
      'part_line_created', created, 'part_name', part.part_name, 'quantity', part.quantity, 'listing', snap, 'reason', btrim(p_reason),
      'approver_role', role, 'signer_user_id', signer)),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'approver_role', role),
    'work_order_part_listing_approval_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  proj := public.project_work_order_part_listing_approval(obs_id);
  RETURN jsonb_build_object('approval_id', proj->>'id', 'work_order_id', w.id, 'work_order_part_id', part.id, 'part_line_created', created,
    'superseded', proj->'superseded', 'approved_at', signed, 'approver_role', role, 'item_id', snap->>'item_id', 'item_url', snap->>'item_url',
    'duplicate', false, 'ordered', false, 'payment_authorized', false);
END $$;

-- Current approvals of one part line, for the open job readers (the reason to parties only).
CREATE FUNCTION public.work_order_part_approved_listings(p_part_id uuid, p_party boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('approval_id', pa.id, 'approved_at', pa.approved_at, 'approver_role', pa.approver_role,
      'listing', pa.listing,
      'basis', 'the listing as the parts finder showed it to the approver at listing.observed_at; price and availability may have changed since; nothing is ordered')
      || CASE WHEN p_party THEN jsonb_build_object('reason', pa.approval_reason) ELSE '{}'::jsonb END
    ORDER BY pa.approved_at DESC, pa.id), '[]'::jsonb)
  FROM public.part_alternatives pa
  WHERE pa.work_order_part_id = p_part_id AND pa.approval_observation_id IS NOT NULL AND pa.superseded_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.approve_job_part_listing(uuid, jsonb, text, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_job_part_listing(uuid, jsonb, text, uuid, text, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.project_work_order_part_listing_approval(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_part_approved_listings(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_part_listing_refusal(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_part_listing_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.part_alternatives_approval_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.part_alternatives_no_truncate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_work_order_part_listing_approval(uuid), public.work_order_part_approved_listings(uuid, boolean),
  public.work_order_part_listing_refusal(jsonb, timestamptz), public.work_order_part_listing_snapshot(jsonb) TO service_role;
COMMENT ON FUNCTION public.approve_job_part_listing(uuid, jsonb, text, uuid, text, text, integer) IS 'Sign: a party on an open work order approves one eBay listing (read by the parts finder in the last two hours) for a part line of the job, with its reason; adds the part line when none is named. Writes an owner-input work_record and its part_alternatives approval row. Orders nothing.';
COMMENT ON FUNCTION public.project_work_order_part_listing_approval(uuid) IS 'Projector: one signed work_order_part_listing_approval v1 work_record into its part_alternatives approval row; supersedes the current approval of the same item on the same part line.';
COMMENT ON FUNCTION public.work_order_part_approved_listings(uuid, boolean) IS 'Internal: the current approved listings of a part line for the open job readers; the reason to parties only.';

-- Readers: anchored edits of the live definitions, each anchor exactly once.
DO $edit$
DECLARE
  rd text := pg_get_functiondef('public.work_order_operations_read(uuid)'::regprocedure);
  a1 text := $a$'product', public.work_order_part_product_card(p.id),$a$;
  a2 text := $a$'people_basis', 'no people are returned; requested_by is a role',$a$;
BEGIN
  IF (length(rd)-length(replace(rd,a1,'')))/length(a1) <> 1 OR (length(rd)-length(replace(rd,a2,'')))/length(a2) <> 1 THEN
    RAISE EXCEPTION 'operations reader anchors not found exactly once';
  END IF;
  rd := replace(rd, a1, a1 || $r$ 'approved_listings', public.work_order_part_approved_listings(p.id, party),$r$);
  rd := replace(rd, a2, $r$'part_approval', jsonb_build_object('approver_role', public.work_order_evidence_role(w.id, uid),
      'sign', 'approve_job_part_listing', 'finder', 'extract-ebay-motors action parts',
      'basis', 'approver_role is the viewer''s role when the viewer may approve listings for this job''s parts; null otherwise'),
    $r$ || a2);
  EXECUTE rd;
END $edit$;

DO $edit$
DECLARE
  rd text := pg_get_functiondef('public.work_order_part_read(uuid)'::regprocedure);
  a1 text := $a$'is_selected', pa.is_selected, 'recorded_at', pa.created_at)$a$;
  a2 text := $a$CASE WHEN party THEN jsonb_build_object('store_location', pa.store_location, 'notes', pa.notes)$a$;
  a3 text := $a$INTO offers FROM public.part_alternatives pa WHERE pa.work_order_part_id = p.id;$a$;
BEGIN
  IF (length(rd)-length(replace(rd,a1,'')))/length(a1) <> 1 OR (length(rd)-length(replace(rd,a2,'')))/length(a2) <> 1
     OR (length(rd)-length(replace(rd,a3,'')))/length(a3) <> 1 THEN
    RAISE EXCEPTION 'part reader anchors not found exactly once';
  END IF;
  -- Legacy offers keep their exact shape; only an approval row carries the approval keys.
  rd := replace(rd, a1, a1 || $r$ || CASE WHEN pa.approval_observation_id IS NOT NULL THEN jsonb_build_object('approval',
        jsonb_build_object('approved_at', pa.approved_at, 'approver_role', pa.approver_role, 'listing', pa.listing)) ELSE '{}'::jsonb END$r$);
  rd := replace(rd, a2, a2 || $r$ || CASE WHEN pa.approval_observation_id IS NOT NULL
        THEN jsonb_build_object('approval_reason', pa.approval_reason) ELSE '{}'::jsonb END$r$);
  rd := replace(rd, a3, $r$INTO offers FROM public.part_alternatives pa WHERE pa.work_order_part_id = p.id AND pa.superseded_at IS NULL;$r$);
  EXECUTE rd;
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
