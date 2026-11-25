-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_deep_reading_feed.sql
-- Proves 20261126103500_deep_reading_feed.sql (on top of 20261125200000_scan_metadata_withheld_paths.sql):
--   * before: anon reads image_deep_byok copies on a public car straight from vehicle_observations (the live
--     vo_authenticated_read and observation_is_public, md5 checked) with the place, the narrative, the OCR text, the
--     plate inside a label and the model's summary, including copies of photos the gallery hides (a document, a photo
--     the privacy rule withholds, a sensitive photo).
--   * vehicle_deep_reading_feed: anon and a signed-in stranger get only the copies of shown photos on a public
--     non-deleted car, each without place, narrative, text regions, open questions or summary, the plate withheld inside
--     the kept label; nothing on a private or a deleted car. The owner and a tied mechanic get every copy on the car
--     whole; an untied uploader on a private car gets their own photo's copy whole and no other; service_role reads all.
--     Superseded and automatic-tier copies (the page's standingReadings filter), copies whose image_id is not a uuid and copies naming a photo on another car never come back.
--     p_limit and p_before page newest first; p_observation_id returns one copy under the same tests. Registered as a policy copy of vehicle_images.
--   * the revert drops the reader and its registry row.
-- Which assertion fails if the fix is removed (mutation runs, scratchpad obs_mut.py): the gallery term ->
-- "anon on A"; the sensitive term -> "anon on A"; the worker call (raw structured_data) -> "anon on A"; the content_text
-- gate -> "anon on A"; the same-car join term -> "anon on A"; the uploader term -> "untied uploader"; the tied term ->
-- "owner and mechanic"; the is_public test -> "private car"; the deleted_at test -> "deleted car"; the superseded filter
-- -> "anon on A"; the automatic-tier filter -> "anon on A"; the early exit for anon only -> "untied uploader"; the
-- page stop, the p_before filter and oldest-first order -> "paging"; the registration -> "registered"; the live-hash
-- check -> "another live vehicle_images policy hash"; the p_observation_id filter -> "by id".
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/scan_metadata_schema.sql
\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql

-- vehicle_observations as live (2026-11-25): the enums, the columns the reader returns and filters on, the live
-- observation_is_public and vo_authenticated_read.
CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record', 'ownership',
  'specification', 'provenance', 'valuation', 'condition', 'media', 'social_mention', 'expert_opinion', 'splice', 'activity', 'offer',
  'contributor_answer');
CREATE TYPE public.confidence_level AS ENUM ('verified', 'high', 'medium', 'low', 'inferred');
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id),
  kind public.observation_kind NOT NULL, content_text text, structured_data jsonb, confidence public.confidence_level,
  confidence_score numeric, ingested_at timestamptz, observed_at timestamptz, is_superseded boolean DEFAULT false, agent_tier text);
-- The automatic reading tier: the live platform_config row shape and image_reading_tier_is_automatic's live body.
CREATE TABLE IF NOT EXISTS public.platform_config (config_key text PRIMARY KEY, config_value jsonb NOT NULL);
INSERT INTO public.platform_config VALUES ('image_reading_tiers', '{"automatic": {"tier": "subscription automatic"}}');
CREATE OR REPLACE FUNCTION public.image_reading_tier_is_automatic(p_tier text)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(p_tier, '') <> '' and coalesce((select c.config_value -> 'automatic' ->> 'tier' = p_tier
                                                    from public.platform_config c where c.config_key = 'image_reading_tiers'), false) $function$;
CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind observation_kind, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~* ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone'
                                         '|total_?paid|balance_?remaining|full_?name|first_?name|last_?name'
                                         '|given_?name|family_?name|legal_?name|buyer_?name|seller_?name'
                                         '|owner_?name|person_?name|technician_?name|participant_?name|contact_?name)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$function$;
DO $$ BEGIN
  IF md5(pg_get_functiondef('public.observation_is_public(public.observation_kind, jsonb)'::regprocedure))
     <> 'a19d4d1abf5af344878d05bf98be0f49' THEN
    RAISE EXCEPTION 'FAIL: fixture observation_is_public does not hash to production''s 2026-11-25 text';
  END IF;
END $$;
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vo_authenticated_read ON public.vehicle_observations FOR SELECT USING (EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = vehicle_observations.vehicle_id) AND ((v.user_id = ( SELECT auth.uid() AS uid)) OR (v.owner_id = ( SELECT auth.uid() AS uid))
    OR (v.uploaded_by = ( SELECT auth.uid() AS uid)) OR ((v.is_public = true) AND observation_is_public(vehicle_observations.kind, vehicle_observations.structured_data))))));
GRANT SELECT ON public.vehicle_observations TO anon, authenticated;
GRANT ALL ON public.vehicle_observations TO service_role;

-- A sensitive approved photo on public car A, uploaded by its owner u1.
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external, vision_gate_status, is_sensitive) VALUES
  ('10000000-0000-0000-0000-0000000000e8', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001',
   'https://x.invalid/8.jpg', 'user_upload', false, false, 'approved', true);

-- Deep-reading copies, each shaped as live (2026-11-25 keys): place, narrative, OCR text, open questions, the car's
-- plate inside a component label (fixture plate 'tst-pl8 9', written here 'TST PL8 9'), a summary in content_text.
CREATE FUNCTION pg_temp.copy(p_image text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', p_image, 'witness_image_id', p_image,
    'scene_type', 'body_exterior', 'presence', jsonb_build_object('place_hint', 'driveway on Elm St', 'person', 'false'),
    'narrative_one_line', 'red car in a driveway on Elm St', 'text_regions', jsonb_build_array(jsonb_build_object('text', 'TST PL8 9')),
    'open_questions', jsonb_build_array('is this Elm St?'),
    'components_seen', jsonb_build_array(jsonb_build_object('label', 'tag TST PL8 9 on the bumper', 'confidence', 0.9)),
    'workshop_signals', jsonb_build_object('lighting', 'daylight')) $$;
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, content_text, structured_data, confidence, confidence_score, ingested_at, observed_at, is_superseded) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000001'), 'medium', 0.6, '2026-11-20 10:00+00', '2026-11-20 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000001'), 'medium', 0.6, '2026-11-19 10:00+00', '2026-11-19 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000006'), 'medium', 0.6, '2026-11-18 10:00+00', '2026-11-18 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000007'), 'medium', 0.6, '2026-11-17 10:00+00', '2026-11-17 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-0000000000e8'), 'medium', 0.6, '2026-11-16 10:00+00', '2026-11-16 09:00+00', false),
  -- superseded, a non-uuid image_id, a photo on another car, and a condition row that is not a deep reading
  ('d0000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000001'), 'medium', 0.6, '2026-11-21 10:00+00', '2026-11-21 09:00+00', true),
  ('d0000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('not-a-uuid'), 'medium', 0.6, '2026-11-15 10:00+00', '2026-11-15 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000a8', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000003'), 'medium', 0.6, '2026-11-14 10:00+00', '2026-11-14 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'paint is faded',
   '{"domain": "paint"}', 'medium', 0.6, '2026-11-13 10:00+00', '2026-11-13 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000003'), 'medium', 0.6, '2026-11-20 10:00+00', '2026-11-20 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-00000000000b', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000004'), 'medium', 0.6, '2026-11-19 10:00+00', '2026-11-19 09:00+00', false),
  ('d0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-00000000000c', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000005'), 'medium', 0.6, '2026-11-20 10:00+00', '2026-11-20 09:00+00', false);
-- the newest copy of the shown photo, written by the automatic tier (not a standing reading)
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, content_text, structured_data, confidence, confidence_score, ingested_at, observed_at, is_superseded, agent_tier) VALUES
  ('d0000000-0000-0000-0000-0000000000a0', 'a0000000-0000-0000-0000-00000000000a', 'condition', 'red car parked on Elm St',
   pg_temp.copy('10000000-0000-0000-0000-000000000001'), 'medium', 0.6, '2026-11-22 10:00+00', '2026-11-22 09:00+00', false, 'subscription automatic');

-- One line per returned copy: the photo's label, then P place, N narrative, T text regions, Q open questions,
-- C summary, then the first component label.
CREATE FUNCTION public.t_feed_line(p_data jsonb, p_text text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(public.t_label(CASE WHEN p_data ->> 'image_id' ~ '^[0-9a-f-]{36}$' THEN (p_data ->> 'image_id')::uuid END),
                  CASE WHEN p_data ->> 'image_id' = '10000000-0000-0000-0000-0000000000e8' THEN 'sensitive_a' ELSE '?' END)
    || '[' || CASE WHEN p_data #> '{presence,place_hint}' IS NOT NULL THEN 'P' ELSE '' END
    || CASE WHEN p_data ? 'narrative_one_line' THEN 'N' ELSE '' END || CASE WHEN p_data ? 'text_regions' THEN 'T' ELSE '' END
    || CASE WHEN p_data ? 'open_questions' THEN 'Q' ELSE '' END || CASE WHEN p_text IS NOT NULL THEN 'C' ELSE '' END
    || '|' || coalesce(p_data #>> '{components_seen,0,label}', '-') || ']' $$;
CREATE FUNCTION public.t_feed(p_vehicle uuid, p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 50) RETURNS text
LANGUAGE plpgsql STABLE AS $$ BEGIN
  RETURN (SELECT coalesce(string_agg(public.t_feed_line(f.structured_data, f.content_text), ' ' ORDER BY f.ingested_at DESC, f.id DESC), '')
            FROM public.vehicle_deep_reading_feed(p_vehicle, p_before, p_limit) f);
END $$;
GRANT EXECUTE ON FUNCTION public.t_feed_line(jsonb, text), public.t_feed(uuid, timestamptz, integer) TO anon, authenticated, service_role;

-- Before: anon reads the copies directly, place and summary included, hidden photos' copies too.
SELECT public.t_claims(''); SET ROLE anon;
SELECT count(*) FILTER (WHERE structured_data #> '{presence,place_hint}' IS NOT NULL) AS before_place,
       count(*) FILTER (WHERE structured_data ->> 'image_id' IN ('10000000-0000-0000-0000-000000000006',
         '10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-0000000000e8')) AS before_hidden,
       count(content_text) AS before_text
  FROM public.vehicle_observations WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a'
   AND structured_data @> '{"analysis_kind": "image_deep_byok"}' \gset
RESET ROLE;
SELECT public.t_assert(:before_place = 9 AND :before_hidden = 3 AND :before_text = 9,
  format('before: anon reads %s deep copies on public car A with place and summary, %s of photos the gallery hides', :before_place, :before_hidden));

-- Another live policy hash (the pre-#3971 one): the migration stops and applies nothing.
SELECT set_config('test.vi_policy_hash', '3af9ebbc1bebf423e3bd1e0b7c45a194', false);
\set ON_ERROR_STOP 0
\ir ../migrations/20261126103500_deep_reading_feed.sql
\set ON_ERROR_STOP 1
SELECT public.t_assert(to_regprocedure('public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader LIKE 'vehicle_deep_reading_feed%'),
  'another live vehicle_images policy hash: the migration applies nothing');
SELECT set_config('test.vi_policy_hash', 'd00a311fd7235bb19240f3fd812493c4', false);
\ir ../migrations/20261126103500_deep_reading_feed.sql

\set A 'a0000000-0000-0000-0000-00000000000a'
\set B 'b0000000-0000-0000-0000-00000000000b'
\set C 'c0000000-0000-0000-0000-00000000000c'
\set shown '''shown_a[|tag [withheld] on the bumper]'''
\set fullA '''shown_a[PNTQC|tag TST PL8 9 on the bumper] shown_a[PNTQC|tag TST PL8 9 on the bumper] document_a[PNTQC|tag TST PL8 9 on the bumper] plate_a[PNTQC|tag TST PL8 9 on the bumper] sensitive_a[PNTQC|tag TST PL8 9 on the bumper]'''
\set fullB '''private_b[PNTQC|tag TST PL8 9 on the bumper] photog_b[PNTQC|tag TST PL8 9 on the bumper]'''

SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_feed(:'A') AS anon_a, public.t_feed(:'B') AS anon_b, public.t_feed(:'C') AS anon_c,
       public.t_feed(:'A', NULL, 1) AS anon_a_first,
       public.t_feed(:'A', '2026-11-20 10:00+00', 50) AS anon_a_before,
       (SELECT id FROM public.vehicle_deep_reading_feed(:'A', NULL, 1)) AS anon_a_first_id,
       (SELECT id FROM public.vehicle_deep_reading_feed(:'A', '2026-11-20 10:00+00', 1)) AS anon_a_before_id,
       (SELECT count(*) || ':' || coalesce(string_agg(public.t_feed_line(f.structured_data, f.content_text), ' '), '')
          FROM public.vehicle_deep_reading_feed(:'A', NULL, 50, 'd0000000-0000-0000-0000-0000000000a2') f) AS anon_by_id,
       (SELECT count(*) FROM public.vehicle_deep_reading_feed(:'A', NULL, 50, 'd0000000-0000-0000-0000-0000000000a3')) AS anon_by_id_hidden \gset
RESET ROLE;
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT public.t_feed(:'A') AS stranger_a, public.t_feed(:'B') AS stranger_b \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000001');
SELECT (SELECT count(*) FROM public.vehicle_deep_reading_feed(:'A', NULL, 50, 'd0000000-0000-0000-0000-0000000000a3')) AS owner_by_id_hidden \gset
SELECT public.t_feed(:'A') AS owner_a, public.t_feed(:'B') AS owner_b, public.t_feed(:'C') AS owner_c \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000004');
SELECT public.t_feed(:'A') AS mech_a, public.t_feed(:'B') AS mech_b \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000005');
SELECT public.t_feed(:'B') AS ownerid_b \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000003');
SELECT public.t_feed(:'B') AS photog_b, public.t_feed(:'A') AS photog_a \gset
RESET ROLE;
SELECT public.t_claims('service'); SET ROLE service_role;
SELECT public.t_feed(:'A') AS service_a \gset
RESET ROLE;

SELECT public.t_assert(:'anon_a' = :shown || ' ' || :shown,
  'anon on A: only the shown photo''s two copies, without place, narrative, text, questions or summary, plate withheld in the label (' || :'anon_a' || ')');
SELECT public.t_assert(:'stranger_a' = :'anon_a', 'a signed-in stranger on A reads what anon reads');
SELECT public.t_assert(:'anon_a_first' = :shown AND :'anon_a_before' = :shown
  AND :'anon_a_first_id' = 'd0000000-0000-0000-0000-0000000000a1' AND :'anon_a_before_id' = 'd0000000-0000-0000-0000-0000000000a2',
  'paging: p_limit 1 gives the newest copy, p_before gives the older one');
SELECT public.t_assert(:'anon_by_id' = '1:' || :shown AND :'anon_by_id_hidden' = '0' AND :'owner_by_id_hidden' = '1',
  'by id: anon gets one shown copy stripped and nothing for a hidden photo''s copy; the owner gets that one (' || :'anon_by_id' || ')');
SELECT public.t_assert(:'anon_b' = '' AND :'stranger_b' = '' AND :'mech_b' = '', 'private car: anon, a stranger and A''s mechanic read nothing on B');
SELECT public.t_assert(:'anon_c' = '', 'deleted car: anon reads nothing on C');
SELECT public.t_assert(:'owner_a' = :fullA AND :'mech_a' = :fullA AND :'service_a' = :fullA,
  'owner and mechanic (tied) and service_role read every copy on A whole (' || :'mech_a' || ')');
SELECT public.t_assert(:'owner_b' = :fullB AND :'ownerid_b' = :fullB, 'owner and recorded owner_id read every copy on private B whole');
SELECT public.t_assert(:'owner_c' = 'deleted_c[PNTQC|tag TST PL8 9 on the bumper]', 'the owner reads the copy on deleted C');
SELECT public.t_assert(:'photog_b' = 'photog_b[PNTQC|tag TST PL8 9 on the bumper]' AND :'photog_a' = :shown || ' ' || :shown,
  'untied uploader: their own photo''s copy on private B whole, nothing else there; on A what anon reads (' || :'photog_b' || ')');
SELECT public.t_assert(coalesce((SELECT recorded_hash = 'd00a311fd7235bb19240f3fd812493c4' AND owner_lane = 'ta-policies'
                                   AND to_regprocedure('public.' || reader) IS NOT NULL
                          FROM public.private_row_policy_copies
                         WHERE reader = 'vehicle_deep_reading_feed(uuid, timestamp with time zone, integer, uuid)' AND relation = 'vehicle_images'), false),
  'registered as a policy copy of vehicle_images, under a name the drift watch resolves');
SELECT public.t_assert(has_function_privilege('anon', 'public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid)', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid)'::regprocedure)
  AND (SELECT proconfig::text FROM pg_proc WHERE oid = 'public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid)'::regprocedure) ~ 'search_path',
  'definer with a fixed search_path, anon can execute');

\ir ../migrations/20261126103500_deep_reading_feed.sql
SELECT public.t_assert((SELECT count(*) FROM public.private_row_policy_copies WHERE reader LIKE 'vehicle_deep_reading_feed%') = 1,
  'second apply: one registry row');

\ir revert_20261126103500_deep_reading_feed.sql
SELECT public.t_assert(to_regprocedure('public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader LIKE 'vehicle_deep_reading_feed%'),
  'revert: reader and registry row gone');

SELECT 'deep_reading_feed contract: PASS' AS result;
