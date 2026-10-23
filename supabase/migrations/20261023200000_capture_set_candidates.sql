-- Capture-set vehicle candidates: one row per (shoot, candidate vehicle) from the multi-signal scorer
-- (an offline scorer run on the box; not in this repo). A candidate is a proposal, never a filing: nothing here reads into the
-- gallery, and the writer never touches vehicle_images, vehicle_observations or any other testimony table.
--
-- Why a new table and not image_vehicle_candidates (20261021220000): that store is per photo and per pass, and its
-- writers (M1w) are not live, so nothing can write it yet. This table is per shoot, carries the scorer's per-signal
-- breakdown, the combined score and the margin to the runner-up, and is revoked by run. A later promotion can copy
-- the clear rows into image_vehicle_candidates once its writers deploy.
--
-- signals (jsonb object), one key per independent signal, each with its own numbers and cited row ids:
--   gps              filed photos of this vehicle within 150 m of the shoot centroid, more than 24 h away
--   time_photos      filed photos of this vehicle 1-7 days around the shoot
--   work_sessions    work_sessions of this vehicle on the shoot's day not started or ended by the shoot's photos
--   timeline_events  receipt / user / manual timeline_events of this vehicle within a day
--   album            photos of the shoot in an Apple album mapped to this vehicle (album_sync_map)
--   visual_zero_shot share of frames whose best make/model prompt is this vehicle's make family (CLIP)
--   visual_prototype median best cosine similarity to this vehicle's filed frames, more than 24 h away (CLIP)
-- gates (applied before scoring, recorded in signals.gates): a vehicle is a candidate only if it was tied to the user at
--   the shoot (not before a recorded purchase, not after a recorded exit sale, within a year of its own dated evidence)
--   and its body type is compatible with the shoot's dominant shape (e.g. a pickup-shaped shoot never goes to a car).
-- band: 'clear' (inside the band measured at >= 95% precision on held-out filed shoots), 'likely', 'weak', 'tie'.
-- Revert: capture_set_candidates_revert(run, reason) revokes a run; the table can be dropped with
-- supabase/sql/revert_20261023200000_capture_set_candidates.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.capture_set_candidates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL,
  user_id        uuid NOT NULL,
  set_key        text NOT NULL,
  image_ids      uuid[] NOT NULL,
  vehicle_id     uuid NOT NULL,
  rank           smallint NOT NULL CHECK (rank >= 1),
  combined       numeric(5,4) NOT NULL CHECK (combined >= 0 AND combined <= 1),
  margin         numeric(5,4) NOT NULL CHECK (margin >= -1 AND margin <= 1),
  band           text NOT NULL CHECK (band IN ('clear', 'likely', 'weak', 'tie')),
  signals        jsonb NOT NULL CHECK (jsonb_typeof(signals) = 'object'),
  method         text NOT NULL,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_reason text,
  CONSTRAINT csc_images_nonempty CHECK (cardinality(image_ids) > 0),
  UNIQUE (run_id, set_key, vehicle_id)
);
CREATE INDEX IF NOT EXISTS csc_run ON public.capture_set_candidates (run_id);
CREATE INDEX IF NOT EXISTS csc_user_band ON public.capture_set_candidates (user_id, band, rank) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS csc_vehicle ON public.capture_set_candidates (vehicle_id) WHERE revoked_at IS NULL;
COMMENT ON TABLE public.capture_set_candidates IS
  'Proposed vehicle for a capture set (shoot), per candidate, with per-signal evidence. Proposals only: never a filing.';
COMMENT ON COLUMN public.capture_set_candidates.margin IS 'combined minus the next-ranked candidate of the same set and run.';

ALTER TABLE public.capture_set_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_set_candidates FROM anon, authenticated;
GRANT SELECT ON public.capture_set_candidates TO authenticated;
DROP POLICY IF EXISTS csc_owner_read ON public.capture_set_candidates;
CREATE POLICY csc_owner_read ON public.capture_set_candidates FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Writer. p_items: [{set_key, image_ids[], vehicle_id, rank, combined, margin, band, signals}]. A row is skipped (and
-- counted) when the vehicle is gone or merged, or when any of its photos is not the user's or is already filed.
CREATE OR REPLACE FUNCTION public.record_capture_set_candidates(p_run_id uuid, p_user uuid, p_method text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; v_ids uuid[]; v_ok int := 0; v_skip int := 0; v_dup int := 0; v_n int;
BEGIN
  IF p_run_id IS NULL OR p_user IS NULL OR coalesce(p_method, '') = '' OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'record_capture_set_candidates: run, user, method and an items array are required';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ids := ARRAY(SELECT jsonb_array_elements_text(it->'image_ids')::uuid);
    IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = (it->>'vehicle_id')::uuid AND v.deleted_at IS NULL
                     AND v.merged_into_vehicle_id IS NULL)
       OR (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY(v_ids) AND vi.user_id = p_user AND vi.vehicle_id IS NULL)
          <> cardinality(v_ids) THEN
      v_skip := v_skip + 1; CONTINUE;
    END IF;
    INSERT INTO capture_set_candidates (run_id, user_id, set_key, image_ids, vehicle_id, rank, combined, margin, band,
                                        signals, method, created_by)
    VALUES (p_run_id, p_user, it->>'set_key', v_ids, (it->>'vehicle_id')::uuid, (it->>'rank')::smallint,
            (it->>'combined')::numeric, (it->>'margin')::numeric, it->>'band', it->'signals', p_method, 'agent:grok-bot')
    ON CONFLICT (run_id, set_key, vehicle_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_dup := v_dup + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run_id, 'written', v_ok, 'skipped', v_skip, 'duplicate', v_dup);
END $$;

CREATE OR REPLACE FUNCTION public.capture_set_candidates_revert(p_run_id uuid, p_reason text)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH r AS (UPDATE capture_set_candidates SET revoked_at = now(), revoked_reason = coalesce(p_reason, 'reverted')
             WHERE run_id = p_run_id AND revoked_at IS NULL RETURNING 1)
  SELECT count(*)::int FROM r
$$;

REVOKE ALL ON FUNCTION public.record_capture_set_candidates(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_set_candidates_revert(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_capture_set_candidates(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_set_candidates_revert(uuid, text) TO service_role;
