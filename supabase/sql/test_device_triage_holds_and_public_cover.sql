-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_device_holds -f this-file.sql
-- Contract for 20261016151000_device_triage_holds_and_public_cover.sql. Synthetic rows only; never production.
-- Starts from recompute_vehicle_primary_image as production held it on 2026-10-15 and proves its hole: it makes a
-- frame the vision gate holds (or a sensitive one) the cover, because its confirmed and last-resort tiers never read
-- the gate. After the migration every tier picks only frames the public read policy shows, and a vehicle with none
-- has its cover cleared. hold_frames_by_device_triage moves public frames (approved, pending, null) to
-- rejected_personal with the rule, engine, labels, prior status and prior reasoning; it never touches a frame already
-- held, counts unknown ids, refuses malformed input, recomputes the touched vehicle's cover, and only service_role may
-- run it. A second apply is a no-op and a drifted cover picker stops the migration unchanged.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- raises(sql) is true when the statement fails.
CREATE FUNCTION pg_temp.raises(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN others THEN RETURN true;
END $$;

-- The shapes the two functions touch.
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, primary_image_url text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, image_url text, source text,
  taken_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), is_primary boolean DEFAULT false,
  is_superseded boolean, is_duplicate boolean, is_sensitive boolean, vision_gate_status public.vision_gate_status,
  vision_gate_agent_reasoning text, vision_gate_processed_at timestamptz, apple_ml_labels text[],
  image_vehicle_match_status text, ai_scan_metadata jsonb, file_size bigint, vehicle_zone text);
-- Stand-in for production's hero score: the fixture states each frame's score.
CREATE FUNCTION public.image_hero_score(meta jsonb, fsize bigint) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce((meta->>'score')::numeric, 0) $$;
\ir helpers/recompute_vehicle_primary_image_live_20261015.sql

-- Vehicle A (the K5 case): its best-scored confirmed frame is held as misattributed and is the cover; a3 is clutter.
-- Vehicle B: every frame held. Vehicle C: ungated frames, the best of them sensitive.
INSERT INTO public.vehicles (id, is_public, primary_image_url) VALUES
  ('00000000-0000-4000-8000-00000000000a', true, 'https://x/a1.jpg'),
  ('00000000-0000-4000-8000-00000000000b', true, 'https://x/b1.jpg'),
  ('00000000-0000-4000-8000-00000000000c', true, NULL);
INSERT INTO public.vehicle_images (id, vehicle_id, image_url, source, taken_at, is_primary, vision_gate_status,
  vision_gate_agent_reasoning, image_vehicle_match_status, ai_scan_metadata, is_sensitive) VALUES
  ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'https://x/a1.jpg', 'iphoto', '2024-08-25', true,
   'rejected_misattributed', 'LS-series bellhousing close-up, not a 1977 original', 'confirmed', '{"byok_deep_analysis": {}, "score": 9}', false),
  ('00000000-0000-4000-a000-0000000000a2', '00000000-0000-4000-8000-00000000000a', 'https://x/a2.jpg', 'iphoto', '2025-01-01', false,
   'approved', 'K5 exterior', 'confirmed', '{"byok_deep_analysis": {}, "score": 5}', false),
  ('00000000-0000-4000-a000-0000000000a3', '00000000-0000-4000-8000-00000000000a', 'https://x/a3.jpg', 'iphoto', '2025-10-06', false,
   'approved', 'parts invoice', 'confirmed', '{"byok_deep_analysis": {}, "score": 7}', false),
  ('00000000-0000-4000-a000-0000000000a4', '00000000-0000-4000-8000-00000000000a', 'https://x/a4.jpg', 'iphoto', '2026-02-01', false,
   NULL, NULL, 'confirmed', NULL, false),
  ('00000000-0000-4000-a000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'https://x/b1.jpg', 'iphoto', '2024-01-01', true,
   'rejected_personal', 'two dogs on the shop floor', 'confirmed', '{"byok_deep_analysis": {}, "score": 8}', false),
  ('00000000-0000-4000-a000-0000000000b2', '00000000-0000-4000-8000-00000000000b', 'https://x/b2.jpg', 'iphoto', '2024-02-01', false,
   'review_needed', NULL, 'confirmed', NULL, false),
  ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'https://x/c1.jpg', 'bat', '2023-01-01', false,
   NULL, NULL, 'confirmed', '{"byok_deep_analysis": {}, "score": 3}', false),
  ('00000000-0000-4000-a000-0000000000c2', '00000000-0000-4000-8000-00000000000c', 'https://x/c2.jpg', 'bat', '2023-01-02', false,
   NULL, NULL, 'confirmed', '{"byok_deep_analysis": {}, "score": 6}', false),
  ('00000000-0000-4000-a000-0000000000c3', '00000000-0000-4000-8000-00000000000c', 'https://x/c3.jpg', 'bat', '2023-01-03', false,
   NULL, NULL, 'confirmed', '{"byok_deep_analysis": {}, "score": 10}', true);

-- The hole, on the live definition.
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-00000000000a');
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-00000000000c');
SELECT pg_temp.ok('before: the live cover picker keeps a frame the gate holds as misattributed, and picks a sensitive one',
  (SELECT primary_image_url FROM public.vehicles WHERE id = '00000000-0000-4000-8000-00000000000a') = 'https://x/a1.jpg'
  AND (SELECT primary_image_url FROM public.vehicles WHERE id = '00000000-0000-4000-8000-00000000000c') = 'https://x/c3.jpg');

\ir ../migrations/20261016151000_device_triage_holds_and_public_cover.sql
\ir ../migrations/20261016151000_device_triage_holds_and_public_cover.sql

SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-00000000000a');
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-00000000000c');
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-00000000000b') AS b_result \gset
SELECT pg_temp.ok('after: the cover is the best-scored frame the public may read (a3 over the held a1; c2 over the sensitive c3)',
  (SELECT primary_image_url FROM public.vehicles WHERE id = '00000000-0000-4000-8000-00000000000a') = 'https://x/a3.jpg'
  AND (SELECT id FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-4000-8000-00000000000a' AND is_primary) = '00000000-0000-4000-a000-0000000000a3'
  AND (SELECT primary_image_url FROM public.vehicles WHERE id = '00000000-0000-4000-8000-00000000000c') = 'https://x/c2.jpg');
SELECT pg_temp.ok('after: a vehicle with no frame the public may read loses its held cover instead of keeping it',
  (SELECT primary_image_url FROM public.vehicles WHERE id = '00000000-0000-4000-8000-00000000000b') IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-4000-8000-00000000000b' AND is_primary)
  AND (:'b_result')::jsonb->>'reason' = 'no_public_frame');

SELECT public.hold_frames_by_device_triage(jsonb_build_array(
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000a3', 'hold', 'clutter', 'engine', 'abc123',
                     'labels', jsonb_build_array('document', 'printed_page', 'receipt', 'text')),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000a1', 'hold', 'clutter', 'engine', 'abc123',
                     'labels', jsonb_build_array('document')),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000ff', 'hold', 'personal', 'engine', 'abc123',
                     'labels', jsonb_build_array('people'))))::text AS hold_result \gset
SELECT pg_temp.ok('the writer holds the public clutter frame and counts the held and unknown ones as not public',
  (:'hold_result')::jsonb->'held' = '1'::jsonb AND (:'hold_result')::jsonb->'received' = '3'::jsonb
  AND (:'hold_result')::jsonb->'not_public_or_unknown' = '2'::jsonb AND (:'hold_result')::jsonb->'vehicles' = '1'::jsonb);
SELECT pg_temp.ok('the held frame records the rule, engine, labels, prior status and prior reasoning',
  (SELECT vision_gate_status = 'rejected_personal'
          AND vision_gate_agent_reasoning LIKE 'Held by the iOS VisionEngine rule (a document, receipt, screenshot or product capture; VisionEngine.swift abc123%'
          AND vision_gate_agent_reasoning LIKE '%top labels document, printed_page, receipt.%'
          AND vision_gate_agent_reasoning LIKE '%Was approved, visible to the public. Prior reasoning: parts invoice'
          AND apple_ml_labels = ARRAY['document', 'printed_page', 'receipt', 'text']
          AND vision_gate_processed_at IS NOT NULL
   FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000a3'));
SELECT pg_temp.ok('a frame already held is never touched (status and reasoning as they were)',
  (SELECT vision_gate_status = 'rejected_misattributed' AND vision_gate_agent_reasoning = 'LS-series bellhousing close-up, not a 1977 original'
          AND apple_ml_labels IS NULL
   FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000a1'));
SELECT pg_temp.ok('holding the cover recomputes it from what the public may still read',
  (SELECT primary_image_url FROM public.vehicles WHERE id = '00000000-0000-4000-8000-00000000000a') = 'https://x/a2.jpg'
  AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-4000-8000-00000000000a' AND is_primary) = 1);
SELECT public.hold_frames_by_device_triage(jsonb_build_array(jsonb_build_object(
  'image_id', '00000000-0000-4000-a000-0000000000a4', 'hold', 'personal', 'engine', 'abc123', 'labels', '[]'::jsonb)))::text AS personal_result \gset
SELECT pg_temp.ok('an ungated frame is public and can be held too; a personal hold says so',
  (:'personal_result')::jsonb->'held' = '1'::jsonb
  AND (SELECT vision_gate_agent_reasoning LIKE '%(a prominent face and no vehicle;%top labels none. Was ungated, visible to the public.'
       FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000a4'));
SELECT pg_temp.ok('malformed verdicts are refused whole',
  pg_temp.raises($q$SELECT public.hold_frames_by_device_triage('{"image_id": "x"}'::jsonb)$q$)
  AND pg_temp.raises($q$SELECT public.hold_frames_by_device_triage('[{"image_id": "00000000-0000-4000-a000-0000000000a2", "hold": "ugly", "engine": "e"}]'::jsonb)$q$)
  AND pg_temp.raises($q$SELECT public.hold_frames_by_device_triage('[{"image_id": "00000000-0000-4000-a000-0000000000a2", "hold": "clutter"}]'::jsonb)$q$)
  AND pg_temp.raises($q$SELECT public.hold_frames_by_device_triage('[{"image_id": "not-a-uuid", "hold": "clutter", "engine": "e"}]'::jsonb)$q$)
  AND pg_temp.raises($q$SELECT public.hold_frames_by_device_triage('[{"image_id": "00000000-0000-4000-a000-0000000000a2", "hold": "clutter", "engine": "e", "labels": "document"}]'::jsonb)$q$)
  AND pg_temp.raises($q$SELECT public.hold_frames_by_device_triage((SELECT jsonb_agg(jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000a2', 'hold', 'clutter', 'engine', 'e')) FROM generate_series(1, 2001)))$q$)
  AND (SELECT vision_gate_status = 'approved' FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000a2'));
SELECT pg_temp.ok('only service_role may run the writer; it runs with definer rights',
  NOT has_function_privilege('public', 'public.hold_frames_by_device_triage(jsonb)', 'execute')
  AND NOT has_function_privilege('anon', 'public.hold_frames_by_device_triage(jsonb)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.hold_frames_by_device_triage(jsonb)', 'execute')
  AND has_function_privilege('service_role', 'public.hold_frames_by_device_triage(jsonb)', 'execute')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.hold_frames_by_device_triage(jsonb)'::regprocedure));

-- A drifted cover picker stops the migration and leaves it as it was.
CREATE OR REPLACE FUNCTION public.recompute_vehicle_primary_image(p_vehicle_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN RETURN '{"drifted": true}'::jsonb; END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261016151000_device_triage_holds_and_public_cover.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted cover picker stops the migration unchanged',
  public.recompute_vehicle_primary_image('00000000-0000-4000-8000-00000000000a') = '{"drifted": true}'::jsonb);
