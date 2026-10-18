-- Phone rows that point at another photo's bytes: hide them, and stop dedupe from treating them as originals.
--
-- Cause. The iOS app (source capture_relay_ios) stored each photo at users/<uid>/capture-relay/<camera filename>.
-- iPhone filenames wrap at IMG_9999 and repeat across years, and the upload used upsert:false and took "already
-- exists" as success, so a later photo's row was written pointing at an earlier photo's object. #1552 moved new
-- uploads to users/<uid>/capture-relay/<sha256>/<filename>, where the path is the bytes.
--
-- Measured 2026-10-15 (scripts/photos/hold-wrong-byte-rows.mjs --build; receipts in ~/nuke-logs/wrong-bytes-20261015):
-- the owner's 5,480 capture_relay_ios rows point at 4,223 objects (271 more rows hold no object). Every object was
-- downloaded and hashed, and every download matched its storage size and MD5 eTag. 794 rows carry a file_hash (the
-- SHA-256 of the bytes the phone uploaded) that is not the object's SHA-256: 626 photos on 608 paths, 22 of those
-- paths holding one row only, so path sharing alone undercounts. Byte size separates them exactly (all 794 differ
-- from the object's size; all 4,281 matching rows are equal). The 134 rows without a file_hash all match their
-- object's size and are not held. 187 of the 794 are filed on two vehicles; anon reads none of them today (one
-- vehicle is not public, the other's 46 rows are superseded). For 174 of the 626 photos an iphoto row (photo-sync
-- path, object hashed to the same SHA-256) holds the right bytes, and flag_duplicate_image made each of those a
-- duplicate of the wrong row.
--
-- 1. vehicle_image_byte_mismatches: one row per held image, the audit and the marker. It keeps the image_url the
--    row had when held (it serves object_sha256's photo), both hashes, the row's prior gate status, reasoning and
--    duplicate link, and any canonical link made later. New-table justification: vehicle_images has no column for
--    "these bytes are another photo", reattribution_audit records vehicle moves only, and a marker inside
--    vision_gate_agent_reasoning would be lost the next time the gate writes. Service role only (RLS on, no policy).
-- 2. hold_wrong_byte_images(p_items, p_apply, p_run): the writer. Each item names an image, the storage path it
--    points at and the SHA-256 the runner read from that object. A row is held only when its path is a filename
--    path (users/<uid>/capture-relay/<name>, the colliding scheme), it carries a file_hash and the object's SHA-256
--    is different. Held means vision_gate_status rejected_misattributed (the public read policy hides it) with the
--    cause in vision_gate_agent_reasoning, prior status and reasoning kept there and in the audit row. When a row
--    with the right bytes exists for the same user_id and file_hash (a content path, whose name is its hash, or a
--    copy the item names with the SHA-256 the runner read from it), that row becomes canonical: its duplicate flag
--    is cleared when it pointed at a wrong row, rows that pointed at a wrong row point at it, and the wrong row
--    becomes its duplicate. Rows are never deleted, file_hash and image_url are never edited. Dry run unless
--    p_apply; at most 500 items per call; a rerun is a no-op; covers of touched vehicles are recomputed.
--    service_role only.
-- 3. flag_duplicate_image (BEFORE INSERT): never picks a held row as the original, through
--    vehicle_image_holds_wrong_bytes(uuid) (security definer, so the phone's authenticated insert can read the
--    marker without reading the audit). The rest of the live body (guard below, read 2026-10-15) is unchanged.
-- Contract: supabase/sql/test_wrong_byte_image_holds.sql (db contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.flag_duplicate_image()'::regprocedure));
  IF f = 'a61ed2d3fb839e9dad6d66425a30f3ec' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'flag_duplicate_image already skips held rows';
  ELSIF f <> '1646b35a2afde74919d53cc2d3041535' THEN -- gitleaks:allow (live fingerprint read 2026-10-15, not a secret)
    RAISE EXCEPTION 'flag_duplicate_image drifted from the definition this migration patches (md5 %)', f;
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.vehicle_image_byte_mismatches (
  image_id                          uuid PRIMARY KEY,
  user_id                           uuid,
  vehicle_id                        uuid,
  storage_path                      text NOT NULL,
  image_url                         text NOT NULL,
  row_file_hash                     text NOT NULL CHECK (row_file_hash ~ '^[0-9a-f]{64}$'),
  object_sha256                     text NOT NULL CHECK (object_sha256 ~ '^[0-9a-f]{64}$'),
  prior_vision_gate_status          text,
  prior_vision_gate_agent_reasoning text,
  prior_is_duplicate                boolean,
  prior_duplicate_of                uuid,
  canonical_image_id                uuid,
  canonical_via                     text CHECK (canonical_via IN ('content_path', 'hashed_copy')),
  canonical_linked_at               timestamptz,
  canonical_changes                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_label                         text,
  held_by                           text NOT NULL,
  held_at                           timestamptz NOT NULL DEFAULT now(),
  CHECK (row_file_hash <> object_sha256)
);
COMMENT ON TABLE public.vehicle_image_byte_mismatches IS
  'vehicle_images rows whose image_url points at another photo''s bytes (storage path shared through a camera-filename '
  'collision), one row per held image, written only by hold_wrong_byte_images. image_url is the URL the row had when '
  'held; object_sha256 is what that object holds, row_file_hash the photo the row records. canonical_image_id is the '
  'row with the right bytes the wrong row was made a duplicate of; canonical_changes lists each duplicate link moved, '
  'with its prior value. Read by flag_duplicate_image through vehicle_image_holds_wrong_bytes. Service role only.';
ALTER TABLE public.vehicle_image_byte_mismatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_image_byte_mismatches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.vehicle_image_byte_mismatches TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_image_holds_wrong_bytes(p_image_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_image_byte_mismatches WHERE image_id = p_image_id)
$function$;
COMMENT ON FUNCTION public.vehicle_image_holds_wrong_bytes(uuid) IS
  'True when hold_wrong_byte_images held this vehicle_images row for pointing at another photo''s bytes. Security '
  'definer so a trigger running as the inserting role can ask without reading the audit table. 2026-10-15.';

CREATE OR REPLACE FUNCTION public.hold_wrong_byte_images(p_items jsonb, p_apply boolean DEFAULT false, p_run text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_items int;
  it record;
  w record;
  c record;
  v_path text;
  v_held boolean;
  v_outcome text;
  v_link text;
  v_canon uuid;
  v_prior_canon uuid;
  v_record boolean;
  v_clear boolean;
  v_point boolean;
  v_kids jsonb;
  v_changes jsonb;
  v_actor text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
  v_vehicles uuid[] := '{}';
  v_vehicle uuid;
  v_covers jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_tally jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_items must be a json array of {image_id, storage_path, object_sha256[, canonical_id, canonical_storage_path, canonical_sha256]}';
  END IF;
  v_items := jsonb_array_length(p_items);
  IF v_items > 500 THEN
    RAISE EXCEPTION 'at most 500 items per call (got %)', v_items;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
             WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
                OR coalesce(x->>'image_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR coalesce(x->>'storage_path', '') = ''
                OR coalesce(x->>'object_sha256', '') !~ '^[0-9a-f]{64}$'
                OR (x ? 'canonical_id' AND (
                      coalesce(x->>'canonical_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      OR coalesce(x->>'canonical_storage_path', '') = ''
                      OR coalesce(x->>'canonical_sha256', '') !~ '^[0-9a-f]{64}$'))) THEN
    RAISE EXCEPTION 'each item needs image_id (uuid), storage_path and object_sha256 (64 lowercase hex); a canonical_id needs canonical_storage_path and canonical_sha256';
  END IF;

  FOR it IN
    SELECT DISTINCT ON ((x->>'image_id')::uuid)
           (x->>'image_id')::uuid AS image_id, x->>'storage_path' AS storage_path, x->>'object_sha256' AS object_sha256,
           (x->>'canonical_id')::uuid AS canonical_id, x->>'canonical_storage_path' AS canonical_storage_path,
           x->>'canonical_sha256' AS canonical_sha256
      FROM jsonb_array_elements(p_items) x
     ORDER BY (x->>'image_id')::uuid
  LOOP
    v_link := NULL;
    v_canon := NULL;
    IF p_apply THEN
      SELECT id, user_id, vehicle_id, image_url, storage_path, file_hash, vision_gate_status, vision_gate_agent_reasoning,
             is_duplicate, duplicate_of
        INTO w FROM vehicle_images WHERE id = it.image_id FOR UPDATE;
    ELSE
      SELECT id, user_id, vehicle_id, image_url, storage_path, file_hash, vision_gate_status, vision_gate_agent_reasoning,
             is_duplicate, duplicate_of
        INTO w FROM vehicle_images WHERE id = it.image_id;
    END IF;
    IF NOT FOUND THEN
      v_outcome := 'unknown_image';
    ELSE
      v_path := coalesce(w.storage_path, regexp_replace(w.image_url, '^https?://[^/]+/storage/v1/object/public/vehicle-photos/', ''));
      v_held := public.vehicle_image_holds_wrong_bytes(w.id);
      IF v_path IS DISTINCT FROM it.storage_path THEN
        v_outcome := 'path_changed';
      ELSIF v_path !~ '^users/[0-9a-f-]{36}/capture-relay/[^/]+$' THEN
        v_outcome := 'not_filename_path';
      ELSIF w.file_hash IS NULL THEN
        v_outcome := 'no_file_hash';
      ELSIF w.file_hash = it.object_sha256 THEN
        v_outcome := 'bytes_match';
      ELSIF v_held THEN
        v_outcome := 'already_held';
      ELSE
        v_outcome := 'held';
        IF p_apply THEN
          INSERT INTO vehicle_image_byte_mismatches (image_id, user_id, vehicle_id, storage_path, image_url, row_file_hash,
                 object_sha256, prior_vision_gate_status, prior_vision_gate_agent_reasoning, prior_is_duplicate,
                 prior_duplicate_of, run_label, held_by)
          VALUES (w.id, w.user_id, w.vehicle_id, v_path, w.image_url, w.file_hash, it.object_sha256,
                  w.vision_gate_status::text, w.vision_gate_agent_reasoning, w.is_duplicate, w.duplicate_of, p_run, v_actor);
          UPDATE vehicle_images
             SET vision_gate_status = 'rejected_misattributed',
                 vision_gate_agent_reasoning = format(
                   'Held: wrong bytes. Storage path %s is shared with a different photo (camera filename collision: '
                   'names wrap at IMG_9999 and the upload took "already exists" as success), so image_url shows sha256 '
                   '%s, not the photo this row records (file_hash %s). Was %s.%s',
                   v_path, it.object_sha256, w.file_hash, coalesce(w.vision_gate_status::text, 'ungated'),
                   CASE WHEN w.vision_gate_agent_reasoning IS NOT NULL
                        THEN ' Prior reasoning: ' || w.vision_gate_agent_reasoning ELSE '' END),
                 vision_gate_processed_at = now()
           WHERE id = w.id;
          v_held := true;
        END IF;
      END IF;

      -- The right bytes for this photo: the canonical row an earlier run linked, else a content-path row (its path
      -- names its hash), else the copy the item names with the SHA-256 the runner read from it. Never a held row,
      -- never a superseded one.
      IF v_outcome IN ('held', 'already_held') THEN
        SELECT b.canonical_image_id INTO v_prior_canon FROM vehicle_image_byte_mismatches b WHERE b.image_id = w.id;
        SELECT x.id, x.is_duplicate, x.duplicate_of, x.vehicle_id,
               CASE WHEN x.storage_path LIKE 'users/' || x.user_id || '/capture-relay/' || x.file_hash || '/%'
                    THEN 'content_path' ELSE 'hashed_copy' END AS via
          INTO c
          FROM vehicle_images x
         WHERE x.file_hash = w.file_hash AND x.user_id = w.user_id AND x.id <> w.id
           AND coalesce(x.is_superseded, false) = false
           AND NOT public.vehicle_image_holds_wrong_bytes(x.id)
           AND (x.id = v_prior_canon
                OR x.storage_path LIKE 'users/' || x.user_id || '/capture-relay/' || x.file_hash || '/%'
                OR (x.id = it.canonical_id AND it.canonical_sha256 = x.file_hash
                    AND coalesce(x.storage_path, regexp_replace(x.image_url, '^https?://[^/]+/storage/v1/object/public/vehicle-photos/', ''))
                        = it.canonical_storage_path))
         ORDER BY (x.id = v_prior_canon) IS TRUE DESC,
                  coalesce(x.storage_path LIKE 'users/' || x.user_id || '/capture-relay/' || x.file_hash || '/%', false) DESC,
                  x.created_at, x.id
         LIMIT 1;
        IF NOT FOUND THEN
          v_link := CASE WHEN it.canonical_id IS NOT NULL THEN 'canonical_refused' END;
        ELSE
          v_canon := c.id;
          -- The canonical row stops being a duplicate when its original is a wrong row (this one or another held).
          v_clear := c.is_duplicate IS TRUE
                     AND (c.duplicate_of IS NULL OR c.duplicate_of = w.id OR public.vehicle_image_holds_wrong_bytes(c.duplicate_of));
          v_point := w.is_duplicate IS NOT TRUE OR w.duplicate_of IS DISTINCT FROM c.id;
          SELECT coalesce(jsonb_agg(jsonb_build_object('image_id', k.id, 'duplicate_of_was', k.duplicate_of) ORDER BY k.id), '[]'::jsonb)
            INTO v_kids
            FROM vehicle_images k
           WHERE k.file_hash = w.file_hash AND k.user_id = w.user_id AND k.id NOT IN (w.id, c.id)
             AND k.duplicate_of IS NOT NULL
             AND (k.duplicate_of = w.id OR public.vehicle_image_holds_wrong_bytes(k.duplicate_of));
          v_record := NOT EXISTS (SELECT 1 FROM vehicle_image_byte_mismatches b
                                   WHERE b.image_id = w.id AND b.canonical_image_id = c.id);
          IF NOT (v_clear OR v_point OR v_record OR jsonb_array_length(v_kids) > 0) THEN
            v_link := 'linked_already';
          ELSE
            v_link := 'linked';
            IF p_apply THEN
              v_changes := '[]'::jsonb;
              IF v_clear THEN
                UPDATE vehicle_images SET is_duplicate = false, duplicate_of = NULL WHERE id = c.id;
                v_changes := v_changes || jsonb_build_array(jsonb_build_object('image_id', c.id, 'change', 'made_canonical',
                               'is_duplicate_was', c.is_duplicate, 'duplicate_of_was', c.duplicate_of));
              END IF;
              IF jsonb_array_length(v_kids) > 0 THEN
                UPDATE vehicle_images k SET duplicate_of = c.id
                  FROM jsonb_array_elements(v_kids) e
                 WHERE k.id = (e->>'image_id')::uuid;
                v_changes := v_changes || (SELECT jsonb_agg(e || jsonb_build_object('change', 'duplicate_of_moved'))
                                             FROM jsonb_array_elements(v_kids) e);
              END IF;
              IF v_point THEN
                UPDATE vehicle_images SET is_duplicate = true, duplicate_of = c.id WHERE id = w.id;
                v_changes := v_changes || jsonb_build_array(jsonb_build_object('image_id', w.id, 'change', 'wrong_row_points_at_canonical',
                               'is_duplicate_was', w.is_duplicate, 'duplicate_of_was', w.duplicate_of));
              END IF;
              UPDATE vehicle_image_byte_mismatches
                 SET canonical_image_id = c.id, canonical_via = c.via, canonical_linked_at = now(),
                     canonical_changes = canonical_changes || v_changes
               WHERE image_id = w.id;
              IF c.vehicle_id IS NOT NULL THEN v_vehicles := v_vehicles || c.vehicle_id; END IF;
            END IF;
          END IF;
        END IF;
      END IF;
      IF p_apply AND w.vehicle_id IS NOT NULL AND (v_outcome = 'held' OR v_link = 'linked') THEN
        v_vehicles := v_vehicles || w.vehicle_id;
      END IF;
    END IF;

    v_tally := jsonb_set(v_tally, ARRAY[v_outcome], to_jsonb(coalesce((v_tally->>v_outcome)::int, 0) + 1));
    IF v_link IS NOT NULL THEN
      v_tally := jsonb_set(v_tally, ARRAY[v_link], to_jsonb(coalesce((v_tally->>v_link)::int, 0) + 1));
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'image_id', it.image_id, 'outcome', v_outcome, 'link', v_link,
      'canonical_id', v_canon)));
  END LOOP;

  -- A held frame is never a cover: recompute each touched vehicle's cover from what the public may still read.
  FOREACH v_vehicle IN ARRAY ARRAY(SELECT DISTINCT unnest(v_vehicles)) LOOP
    v_covers := v_covers || jsonb_build_array(public.recompute_vehicle_primary_image(v_vehicle));
  END LOOP;

  RETURN jsonb_build_object('apply', p_apply, 'received', v_items, 'tally', v_tally,
                            'vehicles', cardinality(ARRAY(SELECT DISTINCT unnest(v_vehicles))), 'covers', v_covers,
                            'items', v_results);
END
$function$;
REVOKE ALL ON FUNCTION public.hold_wrong_byte_images(jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_wrong_byte_images(jsonb, boolean, text) TO service_role;
COMMENT ON FUNCTION public.hold_wrong_byte_images(jsonb, boolean, text) IS
  'Hide vehicle_images rows that point at another photo''s bytes (filename-path collision on the phone''s capture '
  'relay): rejected_misattributed with the cause, audited in vehicle_image_byte_mismatches; when a row with the right '
  'bytes exists for the same user and file_hash, make it canonical and the wrong row its duplicate. Items carry the '
  'SHA-256 read from each object (scripts/photos/hold-wrong-byte-rows.mjs). Dry run unless p_apply, 500 items per '
  'call, rerun is a no-op, never deletes, never edits file_hash or image_url. service_role only. 2026-10-15.';

CREATE OR REPLACE FUNCTION public.flag_duplicate_image()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE existing uuid;
BEGIN
  IF NEW.file_hash IS NOT NULL AND NEW.is_duplicate IS NOT TRUE THEN
    -- A row held for pointing at another photo's bytes is never the original (hold_wrong_byte_images).
    SELECT id INTO existing
      FROM vehicle_images
      WHERE user_id = NEW.user_id AND file_hash = NEW.file_hash
        AND NOT public.vehicle_image_holds_wrong_bytes(id)
      LIMIT 1;
    IF existing IS NOT NULL THEN
      NEW.is_duplicate := true;
      NEW.duplicate_of := existing;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

COMMIT;
