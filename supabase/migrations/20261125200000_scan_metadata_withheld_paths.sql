-- Withheld paths of vehicle_images.ai_scan_metadata: rule rows, applied wherever anon reads that jsonb.
--
-- The defect (measured 2026-11-25, read-only). latitude, longitude, location_name and exif_data are revoked from anon,
-- but the jsonb ai_scan_metadata is not, and the deep image reader writes a place description into it. As anon on one
-- public car (83f6f033), 20 of 20 sampled shown photos returned byok_deep_analysis.presence.place_hint through
-- vehicle_images_public, and vehicle_image_findings returned license_plate on 9 frames (it reads the table with no
-- gallery test, so it also served frames the gallery hides: 2,387 frames against the gallery's 2,157).
--
-- Basis: a key census of ai_scan_metadata by key name and count, never values (32,386 rows of the 5 uploaders whose
-- metadata is an object, 14,574 of them on shown photos, paths to depth 4; then depth 8 for place, person, contact,
-- OCR-text and money leaf names over 32,374 of those rows, one dense week re-run in 6-hour slices; a 0.02% block
-- sample of every uploader's rows to depth 5 found no further name; posted on the TransAm board 2026-11-25). Every
-- path that names a place, a plate, a person, OCR text, a document's personal fields or money became a rule row; each
-- row carries its census count.
-- After review (2026-11-25, attacks on #3935): model-written free text restates places, OCR and plates (street-address
-- shapes in agent_notes, open_questions and open_facts on 20 of 2,500 frames; the plate in classification.description,
-- agent_notes and a v2 vehicle_fields element on 5 shown photos of 4 cars). Free text is now withheld by class.
-- Not withheld (checked): classification.v2.vin* and classification.vin_detected (the VIN is a public column of the
-- view), plate_fields.* (a data/trim plate), presence.person/dog and on_device_vision flags (booleans), scene, phase and
-- component labels (components_seen, rendered on the logged-out gallery; the plate rule still applies inside them),
-- classifier cost receipts and other system-written strings (reviewed_keep rows).
--
-- The fix, in one transaction:
--   0. Guards: the view, vehicle_image_findings and get_image_deep_analysis must be the 2026-11-25 live bodies
--      (view: pg_get_viewdef md5; functions: prosrc md5, which for findings is 3f3b6242..., not the functiondef md5).
--   1. public.image_scan_withheld_paths (surface, rule_kind, path, match_key, match_value, min_alnum, reason, basis): the
--      rule rows, service_role only. rule_kind path / free_text: remove the value at path; array_element: drop array
--      elements whose match_key equals match_value; vehicle_value: replace the car's own vehicles.license_plate, inside
--      any string that survives, by [withheld] (letters and digits in order, spaces and dashes between, either case,
--      at least min_alnum 4 of them, the threshold image_privacy_rules already uses for plates; plates in a 0.05% sample
--      ran 5 to 11); reviewed_keep: a long-string path read and kept.
--   2. image_scan_rules(surface): the rows of a surface as one array, the removals as a tree so a photo is rewritten
--      once per level it touches (vehicle_value rows included; the worker skips one whose column the request role may
--      select). image_scan_rules_compiled holds that array per surface, recompiled by a statement trigger on the rule
--      table, so a reader takes it with one key lookup instead of rebuilding it per photo. Both service_role only.
--   3. image_scan_metadata_for_viewer(meta, uploader, vehicle, rules), the worker, INTERNAL: EXECUTE revoked from PUBLIC,
--      anon and authenticated, both forms. A function that takes a document and a vehicle id from its caller and answers
--      with or without [withheld] is an oracle for that car's plate (guess a plate, see whether it is replaced), so no
--      anon- or authenticated-executable function takes scan text, a jsonb document or a rule array. It returns meta
--      unchanged for service_role, a direct database session (no request claims, not PostgREST's authenticator: the
--      idiom of vehicle_image_privacy_withheld), the photo's uploader, or a caller tied to its vehicle
--      (vehicle_viewer_tied, looked up only for a row the rules change); otherwise the rules applied. A plate redaction
--      that would break the JSON text withholds the whole analysis. The plate scan has no early exit: a car with no
--      plate on file runs the same serialisation and regex over a decoy that jsonb text never contains, so the time
--      taken does not say whether a plate is on file. The plate pattern also matches after a JSON escape (\n, \t, ...)
--      and with spaces, dashes, slashes, dots or escaped newlines and tabs between its characters.
--   3b. vehicle_image_scan_metadata(image_id), the callable surface (SECURITY DEFINER, search_path pg_catalog, public;
--      anon, authenticated, service_role): reads the photo's row and metadata itself, re-checks the shown-photo test
--      (definer_readers_visibility_v1: shown on a public, non-deleted car and gallery-eligible by the vehicle_images
--      overload, or the caller uploaded it, or the caller is tied; each term COALESCEd) and returns NULL when it fails,
--      then applies the worker with the compiled rules. It restates the vehicle_images read policy, so the copy is
--      registered in private_row_policy_copies. COST 1, so a whole-row use of the view still inlines and never calls it.
--      Cost of the re-check, read-only on prod 2026-11-25 (claims anon, a 481-photo public car): the gallery test per
--      photo took 279 ms over the 481 rows, almost all of it vehicle_image_privacy_withheld (274 ms with the row fetch);
--      on PG17 the 468-row fixture gallery with the column projected went from 36 to 94 ms (anon) and 47 to 106 ms (a
--      signed-in stranger); a whole-row gallery test alone never calls it.
--   4. image_scan_text_path_gaps(meta, 40): long strings no rule covers, service_role only, for the hourly probe. 40: in
--      the string-leaf census (0.03% sample) every label, enum, id and timestamp path tops out at 40 characters while
--      model sentences run longer (classification.description p90 107, agent_notes p90 161); three 3,000-row prod
--      samples on 2026-11-25 held 1,481 to 1,753 long strings, 0 uncovered.
--   5. CREATE OR REPLACE VIEW vehicle_images_public: the live column list, names, order and types unchanged,
--      security_invoker kept; ai_scan_metadata is vehicle_image_scan_metadata(vi.id), once per row (lateral). The view no
--      longer names vi.ai_scan_metadata. No DDL on vehicle_images.
--   6. vehicle_image_findings reads vehicle_images_public and states the gallery test; get_image_deep_analysis
--      (SECURITY DEFINER) reads byok_deep_analysis through the worker (place_hint, notes, questions, narrative and damage
--      text withheld from an untied caller; the uploader and a tied caller unchanged).
--
-- Not in this migration (named in the PR): the table itself still serves the raw jsonb. anon holds a column grant on
-- vehicle_images.ai_scan_metadata and authenticated holds table SELECT, and logged-out pages (the lightbox, the
-- analysis stream) select it from the table. Since the view now reads the jsonb through the id-keyed definer function,
-- the grant can be revoked once those pages read the view (order: this migration live, the web move merged and live,
-- then the revoke). The same deep verdict is copied into vehicle_observations.structured_data (image_deep_byok), which
-- anon also reads; that is a table and gets its own fix.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Replace only the bodies this migration was written from (2026-11-25 live text).
DO $guard$
BEGIN
  IF md5(pg_get_viewdef('public.vehicle_images_public'::regclass)) IS DISTINCT FROM '21ad7028a04d54602de5c195f175cdf2' THEN
    RAISE EXCEPTION 'vehicle_images_public live body is not the one this migration replaces (expected md5 21ad7028...)';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_image_findings(uuid)'::regprocedure)
     IS DISTINCT FROM '3f3b62421cfc0b516106029ecf0945a9' THEN
    RAISE EXCEPTION 'vehicle_image_findings live body is not the one this migration replaces (expected prosrc md5 3f3b6242...)';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_image_deep_analysis(uuid)'::regprocedure)
     IS DISTINCT FROM '35593b09f682203f625e5c058740a29d' THEN
    RAISE EXCEPTION 'get_image_deep_analysis live body is not the one this migration replaces (expected md5 35593b09...)';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.image_scan_withheld_paths (
  surface text NOT NULL DEFAULT 'vehicle_images.ai_scan_metadata'
    CHECK (surface IN ('vehicle_images.ai_scan_metadata', 'vehicle_observations.structured_data')),
  rule_kind text NOT NULL DEFAULT 'path'
    CHECK (rule_kind IN ('path', 'free_text', 'array_element', 'vehicle_value', 'reviewed_keep')),
  path text[] NOT NULL CHECK (cardinality(path) <= 8 AND array_position(path, NULL) IS NULL),
  match_key text NOT NULL DEFAULT '',
  match_value text NOT NULL DEFAULT '',
  min_alnum integer,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  basis text NOT NULL CHECK (btrim(basis) <> ''),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (surface, rule_kind, path, match_key, match_value),
  CONSTRAINT image_scan_withheld_paths_kind_shape CHECK (CASE rule_kind
    -- a path, or the whole value at a path that a model writes as free text, removed for an untied caller
    WHEN 'path' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
    WHEN 'free_text' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
    -- the elements of the array at path whose match_key equals match_value, dropped
    WHEN 'array_element' THEN cardinality(path) >= 1 AND match_key <> '' AND match_value <> '' AND min_alnum IS NULL
    -- the car's own value of vehicles.<match_key>, replaced inside every string that survives, when the caller's role
    -- cannot select that column; min_alnum keeps a short value from blanking ordinary text
    -- license_plate only: the helper is callable directly (anon executes it for the view), so every value it redacts is
    -- also a yes/no oracle for a guessed value; the plate is printed on the car in its own photos, a name or contact
    -- is not. Another column needs this list and the helper changed together.
    WHEN 'vehicle_value' THEN cardinality(path) = 0 AND match_value = '' AND min_alnum >= 4 AND match_key = 'license_plate'
    -- a path whose long strings were read and kept (system-written), so the free-text check does not flag it
    WHEN 'reviewed_keep' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
  END)
);
ALTER TABLE public.image_scan_withheld_paths ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_scan_withheld_paths FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.image_scan_withheld_paths TO service_role;
COMMENT ON TABLE public.image_scan_withheld_paths IS
  'Rule rows for what an untied caller (not the uploader, not tied to the vehicle, not service_role) reads of a photo''s analysis. rule_kind: path and free_text remove the value at path (free_text marks model-written text, withheld by class); array_element drops array elements whose match_key equals match_value; vehicle_value replaces the car''s own vehicles.<match_key> value inside surviving strings when the caller cannot select that column; reviewed_keep marks a long-string path read and kept. Applied by image_scan_metadata_for_viewer (vehicle_images_public, vehicle_image_findings, get_image_deep_analysis); image_scan_text_path_gaps lists long strings no row covers. basis cites the census (counts only).';

INSERT INTO public.image_scan_withheld_paths (surface, rule_kind, path, match_key, match_value, min_alnum, reason, basis) VALUES
  -- Places, plates, people, money: structured identifiers.
  ('vehicle_images.ai_scan_metadata', 'path', '{license_plate}', '', '', NULL, 'plate: vehicles.license_plate is revoked from anon (#3902)',
   'census 2026-11-25: 16 rows, 16 non-empty text, 9 on shown photos'),
  ('vehicle_images.ai_scan_metadata', 'path', '{location}', '', '', NULL, 'place',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', 'path', '{full_classification,person_visible}', '', '', NULL, 'person: a visible person''s name and identifiers',
   'census 2026-11-25: 1 row (person_visible.name non-empty), on a shown photo'),
  ('vehicle_images.ai_scan_metadata', 'path', '{recipient}', '', '', NULL, 'person: a shipment recipient',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', 'path', '{shipment_number}', '', '', NULL, 'shipping identifier',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', 'path', '{price}', '', '', NULL, 'money amount read off a document',
   'census 2026-11-25: 1 row, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', 'path', '{cost_basis_input}', '', '', NULL, 'money amount',
   'census 2026-11-25: 1 row, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', 'path', '{classification,v2,document,fields}', '', '', NULL, 'document fields read off a paper: names, addresses, phones, emails, birth places, bank details, amounts, plates',
   'census 2026-11-25 (depth 8): fields.names 217 rows, amounts 149, vendor_address 38, owner_address 31, owner_names 27, vendor_phone 27, addresses 20, buyer_name 7, license_plate 6 (per key, rows can overlap); on shown photos: 1 in the first pass, names 2 and amounts 2 in the re-run week'),
  ('vehicle_images.ai_scan_metadata', 'array_element', '{classification,v2,vehicle_fields}', 'field_name', 'license_plate', NULL,
   'plate: a v2 classifier field element naming the car''s license plate (value and evidence)',
   'attack on #3935 2026-11-25 (ta-skeptic): the plate in vehicle_fields[] on shown photos of 4 cars; 0.05% sample: elements color, series, body_style, trim'),
  -- Model-written free text, withheld by class: OCR reads, place descriptions, notes, questions, narratives, descriptions.
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,presence,place_hint}', '', '', NULL, 'place: the deep reader''s description of where the photo was taken (latitude, longitude and location_name are already revoked from anon)',
   'census 2026-11-25: 12,941 rows carry it, 12,703 non-empty text, 10,550 on shown photos'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,text_regions}', '', '', NULL, 'OCR text read off the frame (plates, signs, addresses)',
   'census 2026-11-25: 12,940 rows carry it, 4,769 with regions and text, 3,680 on shown photos'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,agent_notes}', '', '', NULL, 'model notes: restate OCR, place and plate text',
   'attack on #3935 2026-11-25 (ta-skeptic2): street-address-shaped text in 20 of 2,500 sampled frames across agent_notes, open_questions, open_facts, 18 shown on public cars; two cars 2026-11-25: 63 of 4,582 agent_notes address-shaped, place_hint restated in 132'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,open_questions}', '', '', NULL, 'model questions: restate OCR and place text',
   'attack on #3935 2026-11-25 (ta-skeptic2): part of the 20 of 2,500 address-shaped frames'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,saturation,open_facts}', '', '', NULL, 'model facts: restate OCR and place text',
   'attack on #3935 2026-11-25 (ta-skeptic2): part of the 20 of 2,500 address-shaped frames'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,narrative_one_line}', '', '', NULL, 'model narrative: restates place text',
   'two cars 2026-11-25: 5 of 1,582 narratives address-shaped on one, place_hint restated in 2 of 3,000 on the other; 0.03% sample p90 106 characters'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,state_observations,damage_callouts}', '', '', NULL, 'model text about the frame',
   'string-leaf census 2026-11-25 (0.03% sample): max 51 characters'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{byok_deep_analysis,camera_pose,framing}', '', '', NULL, 'model text about the frame',
   'string-leaf census 2026-11-25 (0.03% sample): p90 72 characters'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{classification,detected_text}', '', '', NULL, 'OCR text read off the frame by the classifier (plates, signs, addresses)',
   'census 2026-11-25: 20,210 rows carry it, 8,062 with text, 2,450 of those on shown photos'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{classification,v2,text_lines}', '', '', NULL, 'OCR text lines read off the frame by the v2 classifier (plates, signs, addresses)',
   'census 2026-11-25: 18,417 rows carry it, 6,905 with lines (6,523 with text at depth 8), 1,803 of those on shown photos'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{classification,description}', '', '', NULL, 'model description of the frame: restates the plate',
   'attack on #3935 2026-11-25 (ta-skeptic): the plate in classification.description on shown photos; string-leaf census (0.03% sample): 2,622 rows, p90 107 characters'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{classification,medium_context}', '', '', NULL, 'model text about the frame',
   'string-leaf census 2026-11-25 (0.03% sample): 40 rows, max 103 characters'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{deep_analysis,subject,text_visible}', '', '', NULL, 'OCR text read off the frame by the older deep reader',
   'census 2026-11-25: 624 rows carry it, 440 with text, 139 of those on shown photos'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{extracted_text}', '', '', NULL, 'OCR text read off the frame',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{appraiser,description}', '', '', NULL, 'text composed from model outputs by the tiering writer',
   'string-leaf census 2026-11-25 (0.03% sample): 33 rows, 23 distinct, max 58 characters'),
  ('vehicle_images.ai_scan_metadata', 'free_text', '{appraiser,context}', '', '', NULL, 'text composed from model outputs by the tiering writer',
   'string-leaf census 2026-11-25 (0.03% sample): 29 rows, max 50 characters'),
  -- The car's own private values, wherever a string still carries them.
  ('vehicle_images.ai_scan_metadata', 'vehicle_value', '{}', 'license_plate', '', 4, 'the car''s plate inside any surviving string',
   'min_alnum 4: the threshold image_privacy_rules already uses for license_plate; attack on #3935 2026-11-25 (ta-skeptic): the plate on 5 shown photos of 4 cars'),
  -- Long strings read and kept: system-written, not model text (string-leaf census 2026-11-25, 0.03% sample, values not read).
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{byok_deep_analysis,components_seen}', '', '', NULL, 'component labels the logged-out gallery renders; the vehicle_value rules still apply',
   'labels max 46 characters; two cars 2026-11-25: 0 of 4,582 frames with an address-shaped label'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{provenance_corrections}', '', '', NULL, 'written by correct_image_provenance', 'reason, ref and method: 1,620 rows, 1 distinct value each'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{image_intake}', '', '', NULL, 'intake writer status', 'reason: 632 rows, 1 distinct value'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{route_result}', '', '', NULL, 'router outcome code', '2,600 rows, 10 distinct values, max 166 characters'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{supersession}', '', '', NULL, 'supersession writer probe and ids', '36 rows; probe.method max 204 characters'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{photo_pipeline}', '', '', NULL, 'pipeline receipt ids and methods', 'receipt ids max 83 characters'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{classification,classifier_receipt}', '', '', NULL, 'classifier receipt: hashes, model, quota ids', 'sha256 64 characters, quota strings max 69'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{deep_byok_enqueued}', '', '', NULL, 'queue writer', 'enqueued_by 27 characters'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{cited_page_url}', '', '', NULL, 'the public listing page the photo was taken from', '18 rows, 2 distinct values'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{basis}', '', '', NULL, 'writer basis code', '18 rows, 1 distinct value'),
  ('vehicle_images.ai_scan_metadata', 'reviewed_keep', '{requeue_nocls_20261103}', '', '', NULL, 'requeue job stamp', '2 rows, 48 characters')
ON CONFLICT DO NOTHING;

DO $type$
BEGIN
  IF to_regtype('public.image_scan_rule') IS NULL THEN
    -- kind 'node': a level of the removal tree (path), the keys removed there, the array position of its parent node
    -- (0 for the root); 'array_element' and 'vehicle_value' as in image_scan_withheld_paths.
    CREATE TYPE public.image_scan_rule AS (kind text, path text[], keys text[], parent integer, match_key text, match_value text,
                                           min_alnum integer);
  END IF;
END
$type$;

-- The rules that apply to this request, read once per statement (the view calls it as an uncorrelated subquery).
-- path and free_text rows become a tree of 'node' entries, root first and every parent before its children: each node
-- holds the keys removed at that level, so a photo is rewritten once per level it touches, not once per rule (a #- per
-- rule re-serialised the whole 4.7 KB verdict 11 times a frame on the proof car). Then array_element rows, then
-- vehicle_value rows, these only when the request role cannot select that vehicles column (role mapped from
-- auth.role() as in #3926: 'authenticated' stays, anything else is anon).
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
  ), other AS (
    SELECT row_number() OVER (ORDER BY (r.rule_kind = 'vehicle_value'), r.path, r.match_key, r.match_value) AS i,
           ROW(r.rule_kind, r.path, '{}'::text[], 0, r.match_key, r.match_value, r.min_alnum)::public.image_scan_rule AS rule
      FROM public.image_scan_withheld_paths r
     WHERE r.surface = p_surface AND r.rule_kind IN ('array_element', 'vehicle_value')
  )
  SELECT coalesce((SELECT array_agg(t.rule ORDER BY t.i) FROM tree t), '{}')
         || coalesce((SELECT array_agg(o.rule ORDER BY o.i) FROM other o), '{}')
$function$;
REVOKE ALL ON FUNCTION public.image_scan_rules(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_scan_rules(text) TO service_role;
COMMENT ON FUNCTION public.image_scan_rules(text) IS
  'The image_scan_withheld_paths rows of a surface as one array (reviewed_keep left out), removals as a tree, vehicle_value last. Compiled into image_scan_rules_compiled by the rule table''s trigger.';

-- The compiled rules: one row per surface, rebuilt whenever the rule table changes (statement trigger).
CREATE TABLE IF NOT EXISTS public.image_scan_rules_compiled (
  surface text PRIMARY KEY CHECK (surface IN ('vehicle_images.ai_scan_metadata', 'vehicle_observations.structured_data')),
  rules public.image_scan_rule[] NOT NULL,
  rule_rows integer NOT NULL,
  compiled_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.image_scan_rules_compiled ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_scan_rules_compiled FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.image_scan_rules_compiled TO service_role;
COMMENT ON TABLE public.image_scan_rules_compiled IS
  'image_scan_rules(surface) per surface, rebuilt by the image_scan_withheld_paths statement trigger (grain: one surface). Read by vehicle_image_scan_metadata so the rules are one key lookup per photo. Written only by image_scan_rules_compile().';

CREATE OR REPLACE FUNCTION public.image_scan_rules_compile()
RETURNS integer
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH s(surface) AS (VALUES ('vehicle_images.ai_scan_metadata'), ('vehicle_observations.structured_data')),
  up AS (
    INSERT INTO public.image_scan_rules_compiled (surface, rules, rule_rows, compiled_at)
    SELECT s.surface, public.image_scan_rules(s.surface),
           (SELECT count(*) FROM public.image_scan_withheld_paths w WHERE w.surface = s.surface), now()
      FROM s
    ON CONFLICT (surface) DO UPDATE SET rules = EXCLUDED.rules, rule_rows = EXCLUDED.rule_rows, compiled_at = EXCLUDED.compiled_at
    RETURNING 1)
  SELECT count(*)::integer FROM up
$function$;
REVOKE ALL ON FUNCTION public.image_scan_rules_compile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_scan_rules_compile() TO service_role;

CREATE OR REPLACE FUNCTION public.image_scan_rules_recompile_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.image_scan_rules_compile();
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.image_scan_rules_recompile_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS image_scan_withheld_paths_recompile ON public.image_scan_withheld_paths;
CREATE TRIGGER image_scan_withheld_paths_recompile
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.image_scan_withheld_paths
  FOR EACH STATEMENT EXECUTE FUNCTION public.image_scan_rules_recompile_trg();
SELECT public.image_scan_rules_compile();

CREATE OR REPLACE FUNCTION public.image_scan_metadata_for_viewer(p_meta jsonb, p_user_id uuid, p_vehicle_id uuid, p_rules public.image_scan_rule[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER COST 1
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_out jsonb := p_meta;
  v_hit boolean := false;
  r public.image_scan_rule;
  v_arr jsonb;
  v_role text;
  v_uid uuid;
  v_base text;
  v_txt text;
  v_new text;
  v_val text;
  v_alnum text;
  v_plate text;
  v_veh_read boolean := false;
  v_nn integer;
  v_i integer;
  v_node jsonb[];
  v_patch jsonb[];
  v_patch_keys text[];
  v_x jsonb;
  v_pat text;
  v_ch text;
  v_real boolean;
BEGIN
  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' OR p_rules IS NULL THEN
    RETURN p_meta;
  END IF;
  v_role := auth.role();
  -- service_role, or a direct database session (cron, a job, a fold): no request claims and not PostgREST's authenticator
  IF v_role = 'service_role' OR (v_role IS NULL AND session_user <> 'authenticator') THEN
    RETURN p_meta;
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND p_user_id = v_uid THEN
    RETURN p_meta;
  END IF;
  -- Removal tree: copy each node's object down from the root, then rewrite bottom-up, each touched level once
  -- (its children's rewritten values merged in, its own keys removed).
  v_nn := 0;
  WHILE v_nn < coalesce(array_length(p_rules, 1), 0) AND (p_rules[v_nn + 1]).kind = 'node' LOOP
    v_nn := v_nn + 1;
  END LOOP;
  IF v_nn > 0 THEN
    v_node := array_fill(NULL::jsonb, ARRAY[v_nn]);
    v_patch := array_fill(NULL::jsonb, ARRAY[v_nn]);
    v_patch_keys := array_fill(NULL::text, ARRAY[v_nn]);
    v_node[1] := v_out;
    FOR v_i IN 2 .. v_nn LOOP
      r := p_rules[v_i];
      v_x := v_node[r.parent];
      IF jsonb_typeof(v_x) = 'object' THEN
        v_node[v_i] := v_x -> r.path[cardinality(r.path)];
      END IF;
    END LOOP;
    FOR v_i IN REVERSE v_nn .. 1 LOOP
      v_x := v_node[v_i];
      CONTINUE WHEN jsonb_typeof(v_x) IS DISTINCT FROM 'object';
      r := p_rules[v_i];
      -- one delete of this level's own keys and of the children about to be replaced, then one merge
      IF v_patch[v_i] IS NOT NULL THEN
        v_x := (v_x - (r.keys || string_to_array(v_patch_keys[v_i], E'\x1f'))) || v_patch[v_i];
      ELSIF v_x ?| r.keys THEN
        v_x := v_x - r.keys;
      ELSE
        CONTINUE;
      END IF;
      IF v_i = 1 THEN
        v_out := v_x;
        v_hit := true;
      ELSIF v_patch[r.parent] IS NULL THEN
        v_patch[r.parent] := jsonb_build_object(r.path[cardinality(r.path)], v_x);
        v_patch_keys[r.parent] := r.path[cardinality(r.path)];
      ELSE
        v_patch[r.parent] := v_patch[r.parent] || jsonb_build_object(r.path[cardinality(r.path)], v_x);
        v_patch_keys[r.parent] := v_patch_keys[r.parent] || E'\x1f' || r.path[cardinality(r.path)];
      END IF;
    END LOOP;
  END IF;
  FOREACH r IN ARRAY p_rules[v_nn + 1:] LOOP
    IF r.kind = 'node' THEN
      NULL;
    ELSIF r.kind = 'array_element' THEN
      v_arr := v_out #> r.path;
      IF jsonb_typeof(v_arr) = 'array' AND v_arr @> jsonb_build_array(jsonb_build_object(r.match_key, r.match_value)) THEN
        SELECT coalesce(jsonb_agg(x.e ORDER BY x.o), '[]'::jsonb) INTO v_arr
          FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS x(e, o)
         WHERE NOT (x.e @> jsonb_build_object(r.match_key, r.match_value));
        v_out := jsonb_set(v_out, r.path, v_arr);
        v_hit := true;
      END IF;
    ELSIF r.kind = 'vehicle_value' THEN
      -- a vehicles column the request role may select is not withheld (role mapping as in #3926)
      CONTINUE WHEN has_column_privilege(CASE v_role WHEN 'authenticated' THEN 'authenticated' ELSE 'anon' END,
                                         'public.vehicles', r.match_key, 'SELECT');
      IF NOT v_veh_read THEN
        SELECT v.license_plate INTO v_plate FROM public.vehicles v WHERE v.id = p_vehicle_id;
        v_veh_read := true;
      END IF;
      -- license_plate only, whatever the caller passed as rules (see the table's CHECK)
      v_val := CASE r.match_key WHEN 'license_plate' THEN v_plate END;
      v_alnum := regexp_replace(upper(coalesce(v_val, '')), '[^A-Z0-9]', '', 'g');
      -- No early exit: with no plate on file (or one shorter than min_alnum) the same serialisation and regex run over
      -- a decoy of seven U+0001 characters, which jsonb text output never holds (it escapes control characters), so
      -- the time taken does not say whether a plate is on file.
      v_real := length(v_alnum) >= coalesce(r.min_alnum, 4);
      IF NOT v_real THEN
        v_alnum := repeat(chr(1), 7);
      END IF;
      v_base := coalesce(v_txt, v_base, v_out::text);
      -- the value's letters and digits in order, either case (spelled as [Xx] classes: the 'i' flag ran 4x slower on a
      -- 4.7 KB verdict), with spaces, dashes, slashes, dots or an escaped newline or tab between them; not inside a
      -- longer token; after the start, a non-word character other than a backslash, or a JSON escape (\n, \t, ...),
      -- which is captured and put back
      v_pat := '';
      FOR v_i IN 1 .. length(v_alnum) LOOP
        v_ch := substr(v_alnum, v_i, 1);
        v_pat := v_pat || CASE WHEN v_i > 1 THEN '(?:[\s./-]|\\[nt])*' ELSE '' END
                       || CASE WHEN v_ch BETWEEN 'A' AND 'Z' THEN '[' || v_ch || lower(v_ch) || ']' ELSE v_ch END;
      END LOOP;
      v_new := regexp_replace(v_base, '(^|[^[:alnum:]\\]|\\[bfnrt])' || v_pat || '(?![[:alnum:]])', '\1[withheld]', 'g');
      IF v_new <> v_base AND v_real THEN
        v_txt := v_new;
        v_hit := true;
      END IF;
    END IF;
  END LOOP;
  IF NOT v_hit THEN
    RETURN p_meta;
  END IF;
  IF v_uid IS NOT NULL AND public.vehicle_viewer_tied(p_vehicle_id) THEN
    RETURN p_meta;
  END IF;
  IF v_txt IS NOT NULL THEN
    BEGIN
      v_out := v_txt::jsonb;
    EXCEPTION WHEN others THEN
      -- a redaction that broke the JSON text: withhold the whole analysis rather than serve the value
      RETURN jsonb_build_object('withheld', true);
    END;
  END IF;
  RETURN v_out;
END
$function$;
-- Internal: a caller-supplied document would make it a plate oracle.
REVOKE ALL ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[]) TO service_role;
COMMENT ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[]) IS
  'Internal (not executable by anon or authenticated). A photo''s ai_scan_metadata as the caller may read it, under the given rules (image_scan_rules): unchanged for service_role, a direct database session, the uploader (p_user_id) or a caller tied to the vehicle; otherwise path and free_text values removed, matching array elements dropped and the car''s private vehicles values replaced by [withheld]. Reached by anon and authenticated only through vehicle_image_scan_metadata(image_id) and get_image_deep_analysis.';

CREATE OR REPLACE FUNCTION public.image_scan_metadata_for_viewer(p_meta jsonb, p_user_id uuid, p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE COST 1
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.image_scan_metadata_for_viewer(p_meta, p_user_id, p_vehicle_id, public.image_scan_rules('vehicle_images.ai_scan_metadata'))
$function$;
REVOKE ALL ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid) IS
  'Internal. One photo''s ai_scan_metadata as the caller may read it, reading the rules itself (for definer readers such as get_image_deep_analysis).';

-- The callable surface: keyed by photo id, reads the metadata itself, re-checks the shown-photo test.
CREATE OR REPLACE FUNCTION public.vehicle_image_scan_metadata(p_image_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER COST 1
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  vi public.vehicle_images;
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_rules public.image_scan_rule[];
BEGIN
  SELECT * INTO vi FROM public.vehicle_images i WHERE i.id = p_image_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_role = 'service_role' OR (v_role IS NULL AND session_user <> 'authenticator') THEN
    RETURN vi.ai_scan_metadata;
  END IF;
  -- definer_readers_visibility_v1 (scan_metadata_withheld_paths): the uploader, or shown on a public non-deleted car
  -- and gallery-eligible, or tied; every term COALESCEd so a NULL never admits
  IF NOT (COALESCE(v_uid IS NOT NULL AND vi.user_id = v_uid, false)
          OR COALESCE(COALESCE(vi.is_sensitive, false) = false
                      AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL)
                      AND public.vehicle_image_gallery_eligible(vi), false)
          OR COALESCE(public.vehicle_viewer_tied(vi.vehicle_id), false)) THEN
    RETURN NULL;
  END IF;
  SELECT c.rules INTO v_rules FROM public.image_scan_rules_compiled c WHERE c.surface = 'vehicle_images.ai_scan_metadata';
  IF v_rules IS NULL THEN
    v_rules := public.image_scan_rules('vehicle_images.ai_scan_metadata');
  END IF;
  RETURN public.image_scan_metadata_for_viewer(vi.ai_scan_metadata, vi.user_id, vi.vehicle_id, v_rules);
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_image_scan_metadata(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_scan_metadata(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_scan_metadata(uuid) IS
  'One photo''s ai_scan_metadata as the caller may read it, by photo id: NULL unless the caller may see the photo (shown on a public, non-deleted car and gallery-eligible, or the uploader, or tied); then withheld paths removed for an untied caller. Takes no document from the caller. ai_scan_metadata of vehicle_images_public.';

DO $reg$
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    EXECUTE $i$INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
      VALUES ('vehicle_image_scan_metadata(uuid)', 'vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')',
              '3af9ebbc1bebf423e3bd1e0b7c45a194', 'ta-policies',
              '20261125200000 restates the vehicle_images read policy (shown, uploader, tied) before returning a photo''s analysis')
      ON CONFLICT (reader, relation, policy_filter) DO NOTHING$i$;
  END IF;
END $reg$;

-- Long strings that no rule covers: the check that a new model-written text path gets a rule row. A string leaf longer
-- than p_min_len whose path (array steps as []) has no path, free_text or reviewed_keep rule as a prefix. 40: in the
-- 2026-11-25 string-leaf census (0.03% sample) every label, enum, id and timestamp path tops out at 40 characters
-- (vehicle_hints.color 40, uuids 36) while model sentences run longer (description p90 107, agent_notes p90 161).
CREATE OR REPLACE FUNCTION public.image_scan_text_path_gaps(p_meta jsonb, p_min_len integer DEFAULT 40,
                                                            p_surface text DEFAULT 'vehicle_images.ai_scan_metadata')
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH RECURSIVE w(path, v) AS (
    SELECT ARRAY[e.key], e.value
      FROM jsonb_each(CASE WHEN jsonb_typeof(p_meta) = 'object' THEN p_meta ELSE '{}'::jsonb END) e
    UNION ALL
    SELECT w.path || CASE WHEN c.key LIKE '[]%' THEN '[]' ELSE c.key END, c.value
      FROM w
      CROSS JOIN LATERAL jsonb_each(CASE jsonb_typeof(w.v)
                                      WHEN 'object' THEN w.v
                                      WHEN 'array' THEN (SELECT jsonb_object_agg('[]' || x.o, x.e) FROM jsonb_array_elements(w.v) WITH ORDINALITY x(e, o))
                                      ELSE '{}'::jsonb END) c
     WHERE cardinality(w.path) < 12
  )
  SELECT DISTINCT array_to_string(w.path, '.')
    FROM w
   WHERE jsonb_typeof(w.v) = 'string' AND length(w.v #>> '{}') > p_min_len
     AND NOT EXISTS (SELECT 1 FROM public.image_scan_withheld_paths r
                      WHERE r.surface = p_surface AND r.rule_kind IN ('path', 'free_text', 'reviewed_keep')
                        AND (array_remove(w.path, '[]'))[1:cardinality(r.path)] = r.path)
$function$;
REVOKE ALL ON FUNCTION public.image_scan_text_path_gaps(jsonb, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_scan_text_path_gaps(jsonb, integer, text) TO service_role;
COMMENT ON FUNCTION public.image_scan_text_path_gaps(jsonb, integer, text) IS
  'Paths (array steps as []) of string leaves longer than p_min_len that no path, free_text or reviewed_keep rule covers. The hourly watch runs it over a sample of photos and expects none; a new one needs a rule row.';

-- The live view (2026-11-25), column for column; only ai_scan_metadata goes through the helper, once per row: the
-- LATERAL (... OFFSET 0) keeps the call out of each projection (a gallery read projects ai_scan_metadata 13 times;
-- inlined, that was 13 calls a row: 394 ms against 48 ms raw on a 3,040-photo PG17 fixture, 60 ms this way). A read
-- that never names ai_scan_metadata (the whole-row gallery test, a count) drops the unused call.
CREATE OR REPLACE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
 SELECT vi.id,
    vi.vehicle_id,
    vi.user_id,
    vi.image_url,
    vi.image_type,
    vi.category,
    vi."position",
    vi.caption,
    vi.is_primary,
    vi.created_at,
    vi.updated_at,
    vi.timeline_event_id,
    vi.image_context,
    vi.file_hash,
    vi.file_name,
    vi.file_size,
    vi.taken_at,
    vi.source,
    vi.source_url,
    vi.is_external,
    vi.mime_type,
    vi.is_sensitive,
    vi.sensitive_type,
    vi.storage_path,
    vi.safe_preview_url,
    vi.process_stage,
    vi.workflow_role,
    vi.area,
    vi.part,
    vi.damage_type,
    vi.operation,
    vi.materials,
    vi.labels,
    vi.task_id,
    vi.event_id,
    vi.angle,
    vi.perspective,
    vi.thumbnail_url,
    vi.medium_url,
    vi.large_url,
    vi.optimization_status,
    vi.optimized_at,
    vi.variants,
    vi.spatial_tags,
    s.ai_scan_metadata,
    vi.ai_last_scanned,
    vi.ai_component_count,
    vi.ai_avg_confidence,
    vi.filename,
    vi.temp_session_id,
    vi.is_approved,
    vi.approved_by,
    vi.approved_at,
    vi.imported_by,
    vi.ghost_user_id,
    vi.verification_status,
    vi.pending_submission_id,
    vi.image_category,
    vi.approval_status,
    vi.submitted_by,
    vi.redaction_level,
    vi.redacted_by,
    vi.redacted_at,
    vi.redaction_reason,
    vi.uploaded_at,
    vi.analysis_history,
    vi.context_score,
    vi.processing_models_used,
    vi.total_processing_cost,
    vi.rotation,
    vi.document_classification,
    vi.is_document,
    vi.document_category,
    vi.manual_priority,
    vi.display_order,
    vi.user_tags,
    vi.user_notes,
    vi.ai_processing_status,
    vi.ai_processing_started_at,
    vi.ai_processing_completed_at,
    vi.ai_suggestions,
    vi.organization_status,
    vi.organized_at,
    vi.ai_detected_vehicle,
    vi.ai_detected_angle,
    vi.ai_detected_angle_confidence,
    vi.suggested_vehicle_id,
    vi.perceptual_hash,
    vi.dhash,
    vi.duplicate_of,
    vi.is_duplicate,
    vi.documented_by_user_id,
    vi.photographer_attribution,
    vi.user_confirmed_vehicle,
    vi.user_confirmed_vehicle_by,
    vi.user_confirmed_vehicle_at,
    vi.auto_suggested_vehicle_id,
    vi.auto_suggestion_confidence,
    vi.auto_suggestion_reasons,
    vi.angle_confidence,
    vi.yaw_deg,
    vi.yaw_confidence,
    vi.angle_source,
    vi.bbox,
    vi.doc_flag,
    vi.doc_confidence,
    vi.components,
    vi.vehicle_vin,
    vi.vehicle_vin_confidence,
    vi.vehicle_make,
    vi.vehicle_model,
    vi.vehicle_year,
    vi.vehicle_confidence,
    vi.vehicle_source,
    vi.stale,
    vi.last_rerun_at,
    vi.tags,
    vi.ai_extractions,
    vi.ai_extraction_consensus,
    vi.phash,
    vi.condition_score,
    vi.damage_flags,
    vi.modification_flags,
    vi.photo_quality_score,
    vi.vision_analyzed_at,
    vi.vision_model_version,
    vi.surface_coord_v,
    vi.surface_coord_u,
    vi.camera_pose,
    vi.vehicle_zone,
    vi.zone_confidence,
    vi.yono_queued_at,
    vi.interior_quality,
    vi.zone_source,
    vi.fabrication_stage,
    vi.stage_confidence,
    vi.duration_seconds,
    vi.video_codec,
    vi.video_resolution,
    vi.is_video,
    vi.image_vehicle_match_status,
    vi.image_medium,
    vi.apple_ml_labels,
    vi.vehicle_score,
    vi.upload_batch_id,
    vi.work_session_id,
    vi.merged_from_vehicle_id,
    vi.vision_gate_status,
    vi.vision_gate_processed_at,
    vi.vision_gate_agent_reasoning,
    vi.vision_gate_attribution_confidence,
    vi.is_superseded,
    vi.superseded_by,
    vi.superseded_at,
    vi.ai_retry_count,
    vi.image_identity_id
   FROM public.vehicle_images vi
     CROSS JOIN LATERAL (SELECT public.vehicle_image_scan_metadata(vi.id) AS ai_scan_metadata OFFSET 0) s;


-- vehicle_image_findings: the same {total, rows} shape and keys, read from the view (rule paths removed for untied
-- callers), with the gallery test stated for a caller who is neither tied to the vehicle nor the frame's uploader.
CREATE OR REPLACE FUNCTION public.vehicle_image_findings(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH viewer AS (
    SELECT (SELECT auth.uid()) AS uid,
           coalesce((SELECT auth.role()) = 'service_role', false)
           OR ((SELECT auth.role()) IS NULL AND session_user <> 'authenticator')
           OR ((SELECT auth.uid()) IS NOT NULL AND public.vehicle_viewer_tied(p_vehicle_id)) AS tied
  ),
  frames AS (
    SELECT j.*, vi.vision_analyzed_at
      FROM public.vehicle_images_public vi
      CROSS JOIN viewer w
      LEFT JOIN LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(vi.ai_scan_metadata) = 'object' THEN vi.ai_scan_metadata END) AS j(
             classifier jsonb, error jsonb, vin jsonb, license_plate jsonb, engine jsonb, engine_guess jsonb, engine_badge jsonb,
             transmission jsonb, color_visible jsonb, interior_trim jsonb, odometer jsonb, mileage_at_listing jsonb, source jsonb,
             part_number jsonb, critical jsonb, privacy_concern jsonb, attribution_concern jsonb, phase jsonb, scene_class jsonb,
             make_guess jsonb, model_guess jsonb, year_guess jsonb, confidence jsonb, byok_deep_analysis jsonb) ON true
     WHERE vi.vehicle_id = p_vehicle_id
       AND (w.tied OR (w.uid IS NOT NULL AND vi.user_id = w.uid) OR public.vehicle_image_gallery_eligible(vi))
     LIMIT 5000
  ),
  reported AS (
    SELECT o.row
      FROM frames f
      CROSS JOIN LATERAL (
        SELECT coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb) AS row
          FROM (VALUES
                 ('classifier', f.classifier), ('error', f.error), ('vin', f.vin), ('license_plate', f.license_plate),
                 ('engine', f.engine), ('engine_guess', f.engine_guess), ('engine_badge', f.engine_badge),
                 ('transmission', f.transmission), ('color_visible', f.color_visible), ('interior_trim', f.interior_trim),
                 ('odometer', f.odometer), ('mileage_at_listing', f.mileage_at_listing), ('source', f.source),
                 ('part_number', f.part_number), ('critical', f.critical), ('privacy_concern', f.privacy_concern),
                 ('attribution_concern', f.attribution_concern), ('phase', f.phase), ('scene_class', f.scene_class),
                 ('make_guess', f.make_guess), ('model_guess', f.model_guess), ('year_guess', f.year_guess),
                 ('confidence', f.confidence),
                 ('byok_scene_type', f.byok_deep_analysis -> 'scene_type'),
                 ('byok_build_phase_guess', f.byok_deep_analysis -> 'build_phase_guess'),
                 ('byok_confidence', f.byok_deep_analysis -> 'confidence'),
                 ('vision_analyzed_at', to_jsonb(f.vision_analyzed_at))
               ) AS t(k, v)
         WHERE t.v IS NOT NULL AND t.v <> 'null'::jsonb
      ) o
     WHERE o.row <> '{}'::jsonb
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM frames),
           'rows', coalesce((SELECT jsonb_agg(row) FROM reported), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.vehicle_image_findings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_findings(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_findings(uuid) IS
  'The Image analysis card''s read: {total, rows} for the frames of one vehicle the caller may read, at most 5,000 (SECURITY INVOKER over vehicle_images_public, so the vehicle_images row policies and the image_scan_withheld_paths rules apply). A caller who is neither tied to the vehicle nor the frame''s uploader gets gallery-eligible frames only. rows holds, per frame with anything to report, the non-null scalar keys of ai_scan_metadata the card aggregates plus vision_analyzed_at.';

-- get_image_deep_analysis: the live body (20261125160500, md5 35593b09...), reading byok_deep_analysis through
-- image_scan_metadata_for_viewer, so an untied caller gets no place_hint, agent_notes, open_questions, narrative or
-- damage text on a shown photo; the uploader (iOS AnalyzedPhotosView) and a tied caller still get every field.
CREATE OR REPLACE FUNCTION public.get_image_deep_analysis(p_image_id uuid)
 RETURNS TABLE(image_id uuid, narrative text, intent text, intent_confidence numeric, scene_type text, build_phase text, place_hint text, confidence numeric, agent_model text, agent_notes text, analyzed_at timestamp with time zone, paint_state text, rust_severity text, completeness text, damage_callouts jsonb, components jsonb, open_questions jsonb, needs_review boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 -- definer_readers_visibility_v1: shown, uploader or tied (20261125160500)
 -- scan_metadata_withheld_paths: fields as the caller may read them (20261125200000)
 SELECT vi.id,b->>'narrative_one_line',b->>'intent',nullif(b->>'intent_confidence','')::numeric,
  b->>'scene_type',b->>'build_phase_guess',b->'presence'->>'place_hint',nullif(b->>'confidence','')::numeric,
  b->>'agent_model',b->>'agent_notes',nullif(b->>'analyzed_at','')::timestamptz,
  b->'state_observations'->>'paint_state',b->'state_observations'->>'rust_severity',
  b->'state_observations'->>'completeness',b->'state_observations'->'damage_callouts',
  b->'components_seen',b->'open_questions',nullif(b->>'needs_review','')::boolean
 FROM public.vehicle_images vi
 CROSS JOIN LATERAL(SELECT public.image_scan_metadata_for_viewer(vi.ai_scan_metadata, vi.user_id, vi.vehicle_id)->'byok_deep_analysis' AS b) j
 WHERE vi.id=p_image_id AND vi.ai_scan_metadata ? 'byok_deep_analysis'
   AND (coalesce(b->>'prompt_version','')<>'reviewed_image_analysis_v1' OR EXISTS(
     SELECT 1 FROM public.image_observations io WHERE io.image_id=vi.id AND io.is_active
       AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=b->>'observation_id'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,image_url}'=vi.image_url
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,vehicle_id}'=vi.vehicle_id::text))
   AND (
     coalesce((
       SELECT true
       FROM public.vehicle_images_public vip
       JOIN public.vehicles v ON v.id = vip.vehicle_id
       WHERE vip.id = vi.id
         AND coalesce(vip.is_sensitive, false) = false
         AND v.is_public = true
         AND v.deleted_at IS NULL
         AND public.vehicle_image_gallery_eligible(vip)), false)
     OR ((SELECT auth.uid()) IS NOT NULL AND vi.user_id = (SELECT auth.uid()))
     OR public.vehicle_viewer_tied(vi.vehicle_id));
$function$;

DO $verify$
DECLARE
  v_sig text;
BEGIN
  SELECT md5(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v_sig
    FROM pg_attribute WHERE attrelid = 'public.vehicle_images_public'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_sig IS DISTINCT FROM '7baba6813c194888fb4aec5e60a050d7' THEN
    RAISE EXCEPTION 'vehicle_images_public columns changed (signature %)', v_sig;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.vehicle_images_public'::regclass), false) THEN
    RAISE EXCEPTION 'vehicle_images_public lost security_invoker';
  END IF;
  IF NOT has_table_privilege('anon', 'public.vehicle_images_public', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.vehicle_images_public', 'SELECT') THEN
    RAISE EXCEPTION 'vehicle_images_public grants changed';
  END IF;
  IF has_table_privilege('anon', 'public.image_scan_withheld_paths', 'SELECT')
     OR has_table_privilege('authenticated', 'public.image_scan_withheld_paths', 'SELECT') THEN
    RAISE EXCEPTION 'image_scan_withheld_paths is readable by anon or authenticated';
  END IF;
  IF (SELECT count(*) FROM public.image_scan_withheld_paths WHERE surface = 'vehicle_images.ai_scan_metadata'
        AND rule_kind IN ('path', 'free_text', 'array_element', 'vehicle_value')) < 26 THEN
    RAISE EXCEPTION 'image_scan_withheld_paths is missing rule rows';
  END IF;
  IF NOT (SELECT prosecdef AND procost = 1 AND provolatile = 's' FROM pg_proc
            WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure)
     OR NOT has_function_privilege('anon', 'public.vehicle_image_scan_metadata(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'vehicle_image_scan_metadata is not SECURITY DEFINER, STABLE, COST 1, anon-executable';
  END IF;
  -- no anon- or authenticated-executable function takes a document, scan text or rules and reaches the worker
  IF EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon', 'authenticated']) r(role)
              WHERE p.pronamespace = 'public'::regnamespace
                AND (p.proname IN ('image_scan_metadata_for_viewer', 'image_scan_rules', 'image_scan_rules_compile')
                     OR p.prosrc LIKE '%image_scan_metadata_for_viewer%')
                AND has_function_privilege(r.role, p.oid, 'EXECUTE')
                AND EXISTS (SELECT 1 FROM unnest(p.proargtypes::oid[]) t
                             WHERE t IN ('jsonb'::regtype, 'json'::regtype, 'text'::regtype, 'public.image_scan_rule[]'::regtype))) THEN
    RAISE EXCEPTION 'an anon- or authenticated-executable function takes a document or rules and reaches the worker';
  END IF;
  IF position('vehicle_image_scan_metadata(vi.id)' IN pg_get_viewdef('public.vehicle_images_public'::regclass)) = 0
     OR position('ai_scan_metadata, vi.user_id' IN pg_get_viewdef('public.vehicle_images_public'::regclass)) > 0
     OR NOT EXISTS (SELECT 1 FROM public.image_scan_rules_compiled WHERE surface = 'vehicle_images.ai_scan_metadata' AND cardinality(rules) > 0) THEN
    RAISE EXCEPTION 'vehicle_images_public does not read through vehicle_image_scan_metadata, or the rules are not compiled';
  END IF;
  IF NOT has_function_privilege('anon', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.vehicle_image_findings(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'vehicle_image_findings is not security invoker with anon, authenticated and service_role grants';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_image_deep_analysis(uuid)', 'EXECUTE')
     OR (SELECT prosrc NOT LIKE '%image_scan_metadata_for_viewer%' OR NOT prosecdef FROM pg_proc WHERE oid = 'public.get_image_deep_analysis(uuid)'::regprocedure)
     OR has_function_privilege('anon', 'public.image_scan_text_path_gaps(jsonb,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_image_deep_analysis or image_scan_text_path_gaps not as expected';
  END IF;
END
$verify$;

COMMIT;

-- Live verification (after apply), counts only, with request.jwt.claims = {"role":"anon"} and role anon (and again as
-- authenticated with a random sub: a stranger):
--   select count(*) from (select ai_scan_metadata m from vehicle_images_public where vehicle_id = <83f6f033...>
--     and vehicle_image_gallery_eligible(vehicle_images_public) limit 2000) x
--    where m #> '{byok_deep_analysis,presence,place_hint}' is not null or m #> '{byok_deep_analysis,text_regions}' is not null
--       or m #> '{classification,detected_text}' is not null or m #> '{classification,v2,text_lines}' is not null
--       or m #> '{classification,v2,document,fields}' is not null or m #> '{deep_analysis,subject,text_visible}' is not null
--       or m ?| array['license_plate','location','extracted_text','recipient','shipment_number','price','cost_basis_input']
--       or m #> '{full_classification,person_visible}' is not null                                          -- 0
--   rpc vehicle_image_findings(<83f6f033...>): rows with license_plate 0; total <= the anon gallery count (2,157)
--   The same count FROM vehicle_images (the table) stays above 0 until the follow-up described in the header.
