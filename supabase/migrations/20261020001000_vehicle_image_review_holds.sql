-- Reversible review holds on one vehicle's public images (privacy fix, 2026-10-19). Images of people (including children) on
-- a public vehicle gallery passed the intake gate as approved. The existing writers do not fit: hold_frames_by_device_triage
-- records the final rejected_personal verdict for "a prominent face and no vehicle", and hold_wrong_byte_images is for byte
-- mismatches. This adds a service-only, audited, reversible hold that is not a verdict.
--
--   * hold_vehicle_images_for_review(p_vehicle_id, p_items, p_method, p_reason, p_run, p_apply default false): moves the
--     named images of that vehicle that are currently public (vision_gate_status approved or null) to review_needed,
--     which the existing "Users can view images for public vehicles" policy already hides; the vehicle's owner and the
--     uploader still see them. p_items = [{image_id, signals}] (signals: the detector's booleans/confidences, stored as
--     given). Dry run unless p_apply. Each change is recorded in vehicle_image_gate_changes (run, method, reason, actor,
--     before/after status, before reasoning and clock, signals). The image's reasoning notes the hold; file_hash,
--     image_url, vehicle and every other column are unchanged. The vehicle's cover is recomputed so a held frame is never
--     the cover. Images of other vehicles, already hidden images and unknown ids are skipped and counted.
--   * revert_vehicle_image_review_hold(p_run, p_image_ids default null, p_apply default false): restores the recorded
--     before status, reasoning and clock for that run's holds that are still review_needed (all, or the named ids), marks
--     them reverted, and recomputes the cover.
-- Contract: supabase/sql/test_vehicle_image_review_holds.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.vehicle_image_gate_changes (
  id bigserial PRIMARY KEY,
  run text NOT NULL CHECK (length(btrim(run)) BETWEEN 1 AND 200),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,
  method text NOT NULL CHECK (length(btrim(method)) BETWEEN 1 AND 100),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  actor text NOT NULL,
  before_status text,
  after_status text NOT NULL,
  before_reasoning text,
  before_processed_at timestamptz,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  reverted_at timestamptz,
  reverted_by text,
  UNIQUE (run, image_id)
);
CREATE INDEX vehicle_image_gate_changes_image ON public.vehicle_image_gate_changes(image_id);
CREATE INDEX vehicle_image_gate_changes_vehicle ON public.vehicle_image_gate_changes(vehicle_id, changed_at DESC);
ALTER TABLE public.vehicle_image_gate_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_image_gate_changes FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.vehicle_image_gate_changes FROM service_role;
GRANT SELECT ON TABLE public.vehicle_image_gate_changes TO service_role;
REVOKE ALL ON SEQUENCE public.vehicle_image_gate_changes_id_seq FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.vehicle_image_gate_changes IS 'Audit of reversible vision-gate holds (hold_vehicle_images_for_review / revert_vehicle_image_review_hold): run, method, reason, actor, before/after status, before reasoning and clock, detector signals, revert clock. Service SELECT only.';

CREATE FUNCTION public.hold_vehicle_images_for_review(p_vehicle_id uuid, p_items jsonb, p_method text, p_reason text, p_run text,
  p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  v_items integer;
  v_actor text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_eligible integer;
  v_held integer := 0;
  v_cover jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id) THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'p_items must be a json array of {image_id, signals}'; END IF;
  v_items := jsonb_array_length(p_items);
  IF v_items NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'between 1 and 2000 items per call (got %)', v_items; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
      WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
        OR coalesce(x->>'image_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (x ? 'signals' AND jsonb_typeof(x->'signals') IS DISTINCT FROM 'object')) THEN
    RAISE EXCEPTION 'each item needs image_id (uuid) and optional signals (object)';
  END IF;
  IF coalesce(btrim(p_method), '') = '' OR coalesce(btrim(p_reason), '') = '' OR coalesce(btrim(p_run), '') = '' THEN
    RAISE EXCEPTION 'method, reason and run are required';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.hvi_items(image_id uuid PRIMARY KEY, signals jsonb) ON COMMIT DROP;
  TRUNCATE pg_temp.hvi_items;
  INSERT INTO pg_temp.hvi_items
    SELECT DISTINCT ON ((x->>'image_id')::uuid) (x->>'image_id')::uuid, coalesce(x->'signals', '{}'::jsonb)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY t(x, n) ORDER BY (x->>'image_id')::uuid, n;
  SELECT count(*) INTO v_eligible FROM pg_temp.hvi_items i JOIN public.vehicle_images vi ON vi.id = i.image_id
    WHERE vi.vehicle_id = p_vehicle_id AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status = 'approved');

  IF p_apply THEN
    WITH upd AS (
      UPDATE public.vehicle_images vi
         SET vision_gate_status = 'review_needed',
             vision_gate_processed_at = now(),
             vision_gate_agent_reasoning = format('Held for review (%s, run %s): %s. Was %s, visible to the public. Not a final verdict; reversible with revert_vehicle_image_review_hold.%s',
               btrim(p_method), btrim(p_run), btrim(p_reason), coalesce(vi.vision_gate_status::text, 'ungated'),
               CASE WHEN vi.vision_gate_agent_reasoning IS NOT NULL THEN ' Prior reasoning: ' || vi.vision_gate_agent_reasoning ELSE '' END)
        FROM pg_temp.hvi_items i
       WHERE vi.id = i.image_id AND vi.vehicle_id = p_vehicle_id
         AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status = 'approved')
         AND NOT EXISTS (SELECT 1 FROM public.vehicle_image_gate_changes c WHERE c.run = btrim(p_run) AND c.image_id = vi.id)
      RETURNING vi.id, i.signals
    ), prior AS (
      SELECT u.id, u.signals, b.vision_gate_status::text AS before_status, b.vision_gate_agent_reasoning AS before_reasoning,
        b.vision_gate_processed_at AS before_processed_at
      FROM upd u JOIN public.vehicle_images b ON b.id = u.id
    ), ins AS (
      INSERT INTO public.vehicle_image_gate_changes(run, image_id, vehicle_id, method, reason, actor, before_status, after_status,
        before_reasoning, before_processed_at, signals)
      SELECT btrim(p_run), p.id, p_vehicle_id, btrim(p_method), btrim(p_reason), v_actor, p.before_status, 'review_needed',
        p.before_reasoning, p.before_processed_at, p.signals
      FROM prior p
      RETURNING 1
    )
    SELECT count(*) INTO v_held FROM ins;
  END IF;

  IF p_apply AND v_held > 0 THEN
    v_cover := public.recompute_vehicle_primary_image(p_vehicle_id);
  END IF;
  RETURN jsonb_build_object('run', btrim(p_run), 'applied', p_apply, 'received', v_items,
    'unique_items', (SELECT count(*) FROM pg_temp.hvi_items), 'eligible_public', v_eligible,
    'held', CASE WHEN p_apply THEN v_held END, 'would_hold', CASE WHEN NOT p_apply THEN v_eligible END,
    'skipped_not_public_other_vehicle_or_unknown', (SELECT count(*) FROM pg_temp.hvi_items) - v_eligible,
    'after_status', 'review_needed', 'method', btrim(p_method), 'actor', v_actor, 'cover', v_cover);
END $$;
REVOKE ALL ON FUNCTION public.hold_vehicle_images_for_review(uuid,jsonb,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_vehicle_images_for_review(uuid,jsonb,text,text,text,boolean) TO service_role;
COMMENT ON FUNCTION public.hold_vehicle_images_for_review(uuid,jsonb,text,text,text,boolean) IS 'Service-only: move named public images of one vehicle to review_needed (hidden by the public read policy; owner and uploader still see them), audited in vehicle_image_gate_changes with method, reason, actor, before/after and signals. Dry run unless p_apply. Not a final verdict; reverse with revert_vehicle_image_review_hold.';

CREATE FUNCTION public.revert_vehicle_image_review_hold(p_run text, p_image_ids uuid[] DEFAULT NULL, p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  v_actor text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_candidates integer;
  v_reverted integer := 0;
  v_vehicles uuid[];
  v_vehicle uuid;
  v_covers jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(btrim(p_run), '') = '' THEN RAISE EXCEPTION 'run is required'; END IF;
  SELECT count(*) INTO v_candidates FROM public.vehicle_image_gate_changes c JOIN public.vehicle_images vi ON vi.id = c.image_id
    WHERE c.run = btrim(p_run) AND c.reverted_at IS NULL AND vi.vision_gate_status::text = c.after_status
      AND (p_image_ids IS NULL OR c.image_id = ANY (p_image_ids));
  IF p_apply THEN
    WITH r AS (
      UPDATE public.vehicle_images vi
         SET vision_gate_status = c.before_status::vision_gate_status,
             vision_gate_agent_reasoning = c.before_reasoning,
             vision_gate_processed_at = c.before_processed_at
        FROM public.vehicle_image_gate_changes c
       WHERE c.image_id = vi.id AND c.run = btrim(p_run) AND c.reverted_at IS NULL AND vi.vision_gate_status::text = c.after_status
         AND (p_image_ids IS NULL OR c.image_id = ANY (p_image_ids))
      RETURNING c.id, vi.vehicle_id
    ), m AS (
      UPDATE public.vehicle_image_gate_changes c SET reverted_at = statement_timestamp(), reverted_by = v_actor
        FROM r WHERE c.id = r.id RETURNING r.vehicle_id
    )
    SELECT count(*), array_agg(DISTINCT vehicle_id) INTO v_reverted, v_vehicles FROM m;
    FOREACH v_vehicle IN ARRAY coalesce(v_vehicles, '{}'::uuid[]) LOOP
      v_covers := v_covers || jsonb_build_array(public.recompute_vehicle_primary_image(v_vehicle));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('run', btrim(p_run), 'applied', p_apply, 'candidates', v_candidates,
    'reverted', CASE WHEN p_apply THEN v_reverted END, 'actor', v_actor, 'covers', v_covers);
END $$;
REVOKE ALL ON FUNCTION public.revert_vehicle_image_review_hold(text,uuid[],boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_vehicle_image_review_hold(text,uuid[],boolean) TO service_role;
COMMENT ON FUNCTION public.revert_vehicle_image_review_hold(text,uuid[],boolean) IS 'Service-only: undo hold_vehicle_images_for_review for one run (all or named ids) where the image is still at the held status: restores the recorded before status, reasoning and clock; marks the audit rows reverted; recomputes covers. Dry run unless p_apply.';

COMMIT;
