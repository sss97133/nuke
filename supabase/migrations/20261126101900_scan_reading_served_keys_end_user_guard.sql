-- Scan readings a stranger is served are written only by the pipeline; every other top-level key is withheld.
--
-- Follows 20261125200000 (the image rule rows and the worker image_scan_metadata_for_viewer). There, the car's plate is
-- replaced by [withheld] inside every string an untied caller receives. A signed-in user could store a guess in a photo's
-- document (on any public car; a forged uploader passed the live insert policy) and read whether it came back replaced: a
-- yes/no test of the plate (ta-policies' PG17 repro, 2026-11-25). Paper's insert tie (20261126040500) closes the forged
-- uploader; this closes the stored text itself, whoever uploads.
--
--   image_scan_withheld_paths  rule_kind 'served_key' (path = one top-level key): the keys of ai_scan_metadata an untied
--                              caller may receive. Every other top-level key, including one a future writer adds, is
--                              withheld from that caller. A scan document that is not an object is withheld whole.
--   worker                     applies the served list after the removal tree and before the plate rule, so the plate is
--                              compared only inside served keys.
--   a000_guard_end_user_scan_reading  BEFORE INSERT OR UPDATE OF ai_scan_metadata ON vehicle_images: 42501 when the
--                              statement runs as anon or authenticated (current_user) and sets or changes a served key.
--                              The served list is read from the same rule rows, so a key added to it is protected in the
--                              same statement. Together: no string an end user wrote is ever compared with the plate.
--
-- Dispositions (top-level keys, 0.05% sample of vehicle_images 2026-11-25: 36 keys; client and reader reads on main):
--   served, plate-compared, end-user writes refused: the keys a client page or a sanctioned reader reads for a stranger:
--     classification, byok_deep_analysis, tier_1_analysis, appraiser, deep_analysis, scene_class, classifier, rekognition,
--     spid, spid_data, vin_tag, phase, extractions, last_extracted_at, yono, parts_visible (web and iOS reads), and the
--     keys vehicle_image_findings unpacks: error, vin, license_plate (a path rule still removes it), engine, engine_guess,
--     engine_badge, transmission, color_visible, interior_trim, odometer, mileage_at_listing, part_number, critical,
--     privacy_concern, attribution_concern, make_guess, model_guess, year_guess, confidence.
--   withheld (not listed): keys an end user writes (VehicleComments: source, bat_url, scraped_at, vin_match,
--     confidence_score, original_listing, vehicle_expected, validation; iOS sync_local_vision_tags: on_device_vision, whose
--     labels and owner_verdict are caller-supplied strings), pipeline stamps no stranger reads (pipeline_version,
--     processed_at, duration_ms, route_result, classifier_failed, deep_byok_enqueued, photo_pipeline, processing_tier_reached,
--     scanned_at, supersession, duplicate_collapse, kind, reset_reason, reset_at, previous_status, requeue_*, cited_page_url,
--     basis, run_id, auction_event_id, page_fetched_at), audit and import text (provenance_corrections, image_intake,
--     original_metadata, attribution, context), and any key not yet seen.
--   Narrowing for a stranger: vehicle_image_findings no longer reports a 'source' row (it is a client-written key).
--
-- Writers checked (origin/main and live, 2026-11-25): the 10 live SQL functions that write ai_scan_metadata are SECURITY
-- DEFINER or service-only (only sync_local_vision_tags is executable by authenticated; it writes on_device_vision);
-- edge functions write through the secret-key client (image-intake, check-image-vehicle-match and mcp-connector use a
-- caller's token only to identify the caller); the web writes provenance keys only (VehicleComments). No live trigger on
-- vehicle_images issues a nested UPDATE of it; trg_flag_duplicate_image and trg_withdraw_reviewed_image_analysis edit NEW
-- and sort after a000_.
--
-- Why current_user and not auth.role(): a SECURITY DEFINER RPC an end user calls (sync_local_vision_tags) runs as its
-- owner and stays allowed; a direct PostgREST write runs as anon or authenticated. Why a000_: triggers fire by name, and
-- '0' sorts before '_', so this one runs first of the BEFORE triggers (before a00_trg_capture_relay_default_vehicle) and
-- judges what the end user sent, before trg_withdraw_reviewed_image_analysis rewrites the reading on a move. Paper's
-- zz_ insert tie sorts last on purpose (it judges user_id after trg_vehicle_images_default_attribution); different columns.
--
-- Guard: both bodies are 20261125200000's (md5 below) or already carry served_key_default_v1; anything else raises.
--   image_scan_metadata_for_viewer(jsonb, uuid, uuid, image_scan_rule[])  c3ab8411de3cd842c8cafd823f90641e
--     or 3d45767ad3218d2c53cb78879e975be1, the same body after 20261125234700 (#3978) widens the plate separator
--     or 3d45767ad3218d2c53cb78879e975be1: the same body after 20261125234700 (#3978) widened the plate separator to \[nrt]
--   image_scan_rules(text)                                                420fe0be7f009555945951f1876bb1dd
-- Contract: supabase/sql/test_scan_reading_served_keys_end_user_guard.sql.
-- Revert: supabase/sql/revert_20261126101900_scan_reading_served_keys_end_user_guard.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE v_w text; v_r text;
BEGIN
  IF to_regclass('public.image_scan_withheld_paths') IS NULL
     OR to_regprocedure('public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])') IS NULL THEN
    RAISE EXCEPTION '20261125200000 (rule rows and worker) is not live';
  END IF;
  SELECT prosrc INTO v_w FROM pg_proc WHERE oid = 'public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])'::regprocedure;
  SELECT prosrc INTO v_r FROM pg_proc WHERE oid = 'public.image_scan_rules(text)'::regprocedure;
  IF md5(v_w) NOT IN ('c3ab8411de3cd842c8cafd823f90641e', '3d45767ad3218d2c53cb78879e975be1') AND position('served_key_default_v1' IN v_w) = 0 THEN
    RAISE EXCEPTION 'image_scan_metadata_for_viewer is not the 20261125200000 body (md5 %); review the drift', md5(v_w);
  END IF;
  IF md5(v_r) <> '420fe0be7f009555945951f1876bb1dd' AND position('served_key_default_v1' IN v_r) = 0 THEN
    RAISE EXCEPTION 'image_scan_rules is not the 20261125200000 body (md5 %); review the drift', md5(v_r);
  END IF;
END
$guard$;

-- 1. The rule kind.
ALTER TABLE public.image_scan_withheld_paths DROP CONSTRAINT IF EXISTS image_scan_withheld_paths_rule_kind_check;
ALTER TABLE public.image_scan_withheld_paths ADD CONSTRAINT image_scan_withheld_paths_rule_kind_check
  CHECK (rule_kind IN ('path', 'free_text', 'array_element', 'vehicle_value', 'reviewed_keep', 'served_key'));
ALTER TABLE public.image_scan_withheld_paths DROP CONSTRAINT IF EXISTS image_scan_withheld_paths_kind_shape;
ALTER TABLE public.image_scan_withheld_paths ADD CONSTRAINT image_scan_withheld_paths_kind_shape CHECK (CASE rule_kind
    WHEN 'path' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
    WHEN 'free_text' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
    WHEN 'array_element' THEN cardinality(path) >= 1 AND match_key <> '' AND match_value <> '' AND min_alnum IS NULL
    WHEN 'vehicle_value' THEN cardinality(path) = 0 AND match_value = '' AND min_alnum >= 4 AND match_key = 'license_plate'
    WHEN 'reviewed_keep' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
    -- a top-level key an untied caller may receive (served_key_default_v1); on the photo surface only
    WHEN 'served_key' THEN cardinality(path) = 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
                          AND surface = 'vehicle_images.ai_scan_metadata'
  END);

-- 2. The compiled rules gain one 'served' entry (keys = the served list) between the removal tree and the other rules,
--    so the worker applies it before array_element and vehicle_value. No served_key row: no entry, no default.
CREATE OR REPLACE FUNCTION public.image_scan_rules(p_surface text)
RETURNS public.image_scan_rule[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH rem AS (
    SELECT r.path FROM public.image_scan_withheld_paths r
     WHERE r.surface = p_surface AND r.rule_kind IN ('path', 'free_text')
  ), nodes AS (
    SELECT DISTINCT rem.path[1:k] AS p FROM rem, generate_series(0, cardinality(rem.path) - 1) k
     -- no node inside a path that is removed whole (a rule on {a} makes a rule on {a,b} moot)
     WHERE NOT EXISTS (SELECT 1 FROM rem q WHERE cardinality(q.path) <= k AND rem.path[1:cardinality(q.path)] = q.path)
  ), numbered AS (
    SELECT n.p, row_number() OVER (ORDER BY cardinality(n.p), n.p)::integer AS i FROM nodes n
  ), tree AS (
    SELECT n.i, ROW('node', n.p,
                    coalesce((SELECT array_agg(DISTINCT rem.path[cardinality(rem.path)]) FROM rem
                               WHERE rem.path[1:cardinality(rem.path) - 1] = n.p
                                 AND NOT EXISTS (SELECT 1 FROM rem q WHERE cardinality(q.path) < cardinality(rem.path)
                                                   AND rem.path[1:cardinality(q.path)] = q.path)), '{}'),
                    coalesce((SELECT q.i FROM numbered q WHERE cardinality(n.p) > 0 AND q.p = n.p[1:cardinality(n.p) - 1]), 0),
                    '', '', NULL)::public.image_scan_rule AS rule
      FROM numbered n
  ), served AS (
    -- served_key_default_v1: one entry holding every served top-level key
    SELECT ROW('served', '{}'::text[], array_agg(DISTINCT r.path[1] ORDER BY r.path[1]), 0, '', '', NULL)::public.image_scan_rule AS rule
      FROM public.image_scan_withheld_paths r
     WHERE r.surface = p_surface AND r.rule_kind = 'served_key'
    HAVING count(*) > 0
  ), other AS (
    SELECT row_number() OVER (ORDER BY (r.rule_kind = 'vehicle_value'), r.path, r.match_key, r.match_value) AS i,
           ROW(r.rule_kind, r.path, '{}'::text[], 0, r.match_key, r.match_value, r.min_alnum)::public.image_scan_rule AS rule
      FROM public.image_scan_withheld_paths r
     WHERE r.surface = p_surface AND r.rule_kind IN ('array_element', 'vehicle_value')
  )
  SELECT coalesce((SELECT array_agg(t.rule ORDER BY t.i) FROM tree t), '{}')
         || coalesce((SELECT array_agg(s.rule) FROM served s), '{}')
         || coalesce((SELECT array_agg(o.rule ORDER BY o.i) FROM other o), '{}')
$function$;
REVOKE ALL ON FUNCTION public.image_scan_rules(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_scan_rules(text) TO service_role;

-- 3. The worker, patched at three anchors of its 20261125200000 text (owner, grants and header kept).
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])'::regprocedure);
  a1 text := $a$  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' OR p_rules IS NULL THEN
    RETURN p_meta;
  END IF;$a$;
  b1 text := $b$  IF p_meta IS NULL OR p_rules IS NULL THEN
    RETURN p_meta;
  END IF;$b$;
  a2 text := $a$  IF v_uid IS NOT NULL AND p_user_id = v_uid THEN
    RETURN p_meta;
  END IF;$a$;
  b2 text := $b$  IF v_uid IS NOT NULL AND p_user_id = v_uid THEN
    RETURN p_meta;
  END IF;
  -- served_key_default_v1: a scan document that is not an object is withheld whole from an untied caller
  IF jsonb_typeof(p_meta) <> 'object' THEN
    IF v_uid IS NOT NULL AND public.vehicle_viewer_tied(p_vehicle_id) THEN
      RETURN p_meta;
    END IF;
    RETURN NULL;
  END IF;$b$;
  a3 text := $a$    ELSIF r.kind = 'array_element' THEN$a$;
  b3 text := $b$    ELSIF r.kind = 'served' THEN
      -- served_key_default_v1: a top-level key not on the served list is withheld (a key no rule names included)
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_out) k WHERE NOT (k = ANY (r.keys))) THEN
        v_out := v_out - ARRAY(SELECT k FROM jsonb_object_keys(v_out) k WHERE NOT (k = ANY (r.keys)));
        v_hit := true;
      END IF;
    ELSIF r.kind = 'array_element' THEN$b$;
BEGIN
  IF position('served_key_default_v1' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     OR (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1
     OR (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 THEN
    RAISE EXCEPTION 'image_scan_metadata_for_viewer: an anchor is not found exactly once';
  END IF;
  EXECUTE replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
END
$patch$;

-- 4. The served list (the rule table's statement trigger recompiles image_scan_rules_compiled).
INSERT INTO public.image_scan_withheld_paths (surface, rule_kind, path, reason, basis)
SELECT 'vehicle_images.ai_scan_metadata', 'served_key', ARRAY[k], 'served to a stranger: ' || why,
       'served_key_default_v1 (20261126101900): pipeline-written, plate-compared, end-user writes refused'
  FROM (VALUES
    ('classification', 'photo classifier reading (web, iOS, findings)'),
    ('byok_deep_analysis', 'deep reading (web, iOS, get_image_deep_analysis, day receipt, axle evidence)'),
    ('tier_1_analysis', 'tier-1 reading (web, 39 reads)'),
    ('appraiser', 'appraiser reading (web)'),
    ('deep_analysis', 'legacy deep reading (web)'),
    ('scene_class', 'scene class (web, findings)'),
    ('classifier', 'classifier name (web, findings)'),
    ('rekognition', 'legacy label reading (web)'),
    ('spid', 'SPID reading (web)'),
    ('spid_data', 'SPID reading (web)'),
    ('vin_tag', 'VIN tag reading (web)'),
    ('phase', 'build phase (web, findings)'),
    ('extractions', 'extraction results (web)'),
    ('last_extracted_at', 'extraction clock (web)'),
    ('yono', 'local model reading'),
    ('parts_visible', 'parts reading'),
    ('error', 'findings'), ('vin', 'findings'), ('license_plate', 'findings (a path rule removes it)'),
    ('engine', 'findings'), ('engine_guess', 'findings'), ('engine_badge', 'findings'), ('transmission', 'findings'),
    ('color_visible', 'findings'), ('interior_trim', 'findings'), ('odometer', 'findings'),
    ('mileage_at_listing', 'findings'), ('part_number', 'findings'), ('critical', 'findings'),
    ('privacy_concern', 'findings'), ('attribution_concern', 'findings'), ('make_guess', 'findings'),
    ('model_guess', 'findings'), ('year_guess', 'findings'), ('confidence', 'findings')
  ) AS s(k, why)
ON CONFLICT DO NOTHING;

-- 5. The served list for the guard (the rule table is not readable by end users; this returns key names only).
CREATE OR REPLACE FUNCTION public.image_scan_served_keys()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(array_agg(r.path[1] ORDER BY r.path[1]), '{}')
    FROM public.image_scan_withheld_paths r
   WHERE r.surface = 'vehicle_images.ai_scan_metadata' AND r.rule_kind = 'served_key'
$function$;
REVOKE ALL ON FUNCTION public.image_scan_served_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.image_scan_served_keys() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.image_scan_served_keys() IS
  'The top-level ai_scan_metadata keys served to an untied caller (image_scan_withheld_paths served_key rows). Read by the vehicle_images guard a000_guard_end_user_scan_reading.';

-- 6. The guard. SECURITY INVOKER on purpose: current_user is the role the statement runs as.
CREATE OR REPLACE FUNCTION public.guard_end_user_scan_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_keys text[];
  v_k text;
BEGIN
  -- served_key_default_v1: an end user's own statement (PostgREST runs it as anon or authenticated); a SECURITY DEFINER
  -- writer runs as its owner and is not judged here.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  v_keys := public.image_scan_served_keys();
  IF TG_OP = 'INSERT' THEN
    IF jsonb_typeof(NEW.ai_scan_metadata) = 'object' THEN
      SELECT k INTO v_k FROM jsonb_object_keys(NEW.ai_scan_metadata) k WHERE k = ANY (v_keys) ORDER BY k LIMIT 1;
    END IF;
  ELSE
    -- -> on an array, a scalar or NULL is NULL, so replacing the document with a non-object counts as a change
    SELECT k INTO v_k FROM unnest(v_keys) k
     WHERE (NEW.ai_scan_metadata -> k) IS DISTINCT FROM (OLD.ai_scan_metadata -> k) ORDER BY k LIMIT 1;
  END IF;
  IF v_k IS NOT NULL THEN
    RAISE EXCEPTION 'vehicle_images.ai_scan_metadata: % is a pipeline reading; an end user cannot set or change it', v_k
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_end_user_scan_reading() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.guard_end_user_scan_reading() IS
  'BEFORE INSERT OR UPDATE OF ai_scan_metadata on vehicle_images (trigger a000_guard_end_user_scan_reading): 42501 when anon or authenticated sets or changes a served key (image_scan_served_keys()).';

DROP TRIGGER IF EXISTS a000_guard_end_user_scan_reading ON public.vehicle_images;
CREATE TRIGGER a000_guard_end_user_scan_reading
  BEFORE INSERT OR UPDATE OF ai_scan_metadata ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.guard_end_user_scan_reading();

-- 7. Verify.
DO $verify$
DECLARE v_first text;
BEGIN
  IF position('served_key_default_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])'::regprocedure)) = 0
     OR position('served_key_default_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.image_scan_rules(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'a body was not replaced';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.image_scan_rules_compiled c, unnest(c.rules) r
                  WHERE c.surface = 'vehicle_images.ai_scan_metadata' AND r.kind = 'served' AND 'byok_deep_analysis' = ANY (r.keys)) THEN
    RAISE EXCEPTION 'the compiled rules hold no served list';
  END IF;
  SELECT t.tgname INTO v_first FROM pg_trigger t
   WHERE t.tgrelid = 'public.vehicle_images'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2
   ORDER BY t.tgname COLLATE "C" LIMIT 1;
  IF v_first IS DISTINCT FROM 'a000_guard_end_user_scan_reading' THEN
    RAISE EXCEPTION 'the guard is not the first BEFORE trigger on vehicle_images (first: %)', v_first;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.image_scan_served_keys()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot read the served list the guard needs';
  END IF;
END
$verify$;
COMMIT;
