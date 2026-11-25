-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_definer_readers_scan_rules.sql
-- Proves 20261125234700_definer_readers_scan_rules.sql (on top of 20261125200000_scan_metadata_withheld_paths.sql):
--   * get_user_day_receipt (its live 2026-11-25 body, md5 checked by the migration's guard): before, anon and a signed-in
--     stranger read the day's shown photo with the deep reading's narrative, text regions (part_numbers) and the car's
--     plate inside a component label. After, they get no narrative and no text regions, the plate withheld inside the
--     kept label, the other labels, intent and the photo itself as before; p_user_id, a viewer tied to the car and
--     service_role still read every field. The image rule row is what withholds: without the narrative row, anon reads
--     the narrative again.
--   * vehicle_axle_type_evidence (live body, md5 checked): before, anon reads the printed words of a photo's text region.
--     After, anon and a stranger get the photo row with its axle type and image id and printed NULL; a component label
--     keeps its words with the plate withheld; the owner, a tied viewer and service_role read the text.
--   * the day receipt's other free-text carriers (ta-skeptic must-fix): before, anon reads a work session's own title,
--     the owner's note on the photo and its file name; after, anyone but p_user_id gets the work_type and NULL for the
--     note and the file name, and p_user_id reads all three.
--   * get_analysis_stream (live body, unchanged): anon and a stranger get no rows; the uploader gets their own reading.
--   * two private_row_probes rows (ranks 30, 31); the revert restores both live bodies (md5) and removes the probe rows.
--   * ta-skeptic's #3935 should-fixes: the worker withholds a plate split by a carriage return; the id-keyed reader
--     returns NULL to anon for a sensitive approved photo on a public car and for a photo on a deleted public car.
-- Which assertion fails if the fix is removed (mutation run 2026-11-25): the worker call removed from the day receipt
-- -> "day receipt: anon ..."; v_is_owner IS TRUE replaced by true -> "day receipt: anon ..."; the axle lateral replaced
-- by the raw words -> "axle: anon ..."; the rules read as an empty array -> "day receipt: anon ..."; the probe block
-- skipped -> "probes: ..."; the separator edit skipped -> "worker: a plate split by a carriage return ..."; the
-- reader's is_sensitive term removed -> "scan reader: anon gets NULL for a sensitive approved photo ..."; its deleted_at
-- term removed -> "scan reader: anon gets NULL for a photo on a deleted public car"; the title gate removed -> "day
-- receipt: anon and a stranger get the work type, no owner note and no file name"; the owner_note or the file_name gate
-- removed -> "day receipt: anon gets the photo, its labels ..." (its no-TST check on the whole photo), before that line.
-- Fixture: fixtures/scan_metadata_schema.sql (the #3935 schema), then the tables and live helper bodies these readers
-- read. Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/scan_metadata_schema.sql
\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql

-- What the two readers and get_analysis_stream read (live column names, 2026-11-25).
CREATE TABLE IF NOT EXISTS public.platform_config (config_key text PRIMARY KEY, config_value jsonb NOT NULL);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id),
  kind text, content_text text, structured_data jsonb, agent_model text, agent_tier text, extraction_method text,
  ingested_at timestamptz DEFAULT now(), observed_at timestamptz DEFAULT now(), is_superseded boolean, superseded_by uuid);
-- guardrail-allow(center-key-fk): receipts.vehicle_id: production has no foreign key on it (pg_constraint 2026-11-25)
CREATE TABLE public.receipts (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id), vehicle_id uuid, vendor_name text,
  total_amount numeric, transaction_date date, purchase_date date, receipt_date date, is_superseded boolean, duplicate_of uuid);
CREATE TABLE public.receipt_vehicle_links (receipt_id uuid, vehicle_id uuid REFERENCES public.vehicles(id), status text,
  retired_at timestamptz, page_date date);
CREATE TABLE public.receipt_items (id uuid PRIMARY KEY, receipt_id uuid, description text, part_number text, total_price numeric,
  hours numeric, line_date date, performer text);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id), vehicle_id uuid REFERENCES public.vehicles(id),
  session_date date, title text, work_type text, duration_minutes integer, total_job_cost numeric, session_type text,
  start_time timestamptz, end_time timestamptz);
-- guardrail-allow(center-key-fk): user_image_deep_reads.image_id: production has no foreign key on it (pg_constraint 2026-11-25)
-- guardrail-allow(center-key-fk): user_image_deep_reads.user_id: production has no foreign key on it (pg_constraint 2026-11-25)
CREATE TABLE public.user_image_deep_reads (user_id uuid, image_id uuid, updated_at timestamptz DEFAULT now());
-- private_row_probes, live shape 2026-11-25 (columns and the checks a row must pass).
CREATE TABLE public.private_row_probes (relation text NOT NULL, subject_kind text NOT NULL, subject_column text NOT NULL,
  row_key text NOT NULL, rank smallint NOT NULL, owner_lane text NOT NULL, note text NOT NULL CHECK (length(btrim(note)) >= 12),
  audiences text[] NOT NULL DEFAULT '{anon,authenticated}', sample_size integer NOT NULL DEFAULT 50, active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(), reader text NOT NULL DEFAULT '', reader_args text, reader_ids text,
  sample_filter text, reader_tail text,
  PRIMARY KEY (relation, subject_kind, subject_column, reader),
  CHECK (subject_kind = ANY (ARRAY['image', 'vehicle', 'user', 'flag', 'visibility', 'withheld_column'])),
  CHECK (((reader ~ '^([a-z_][a-z0-9_]*)?$') AND ((reader_args IS NULL) OR ((reader <> '') AND (reader_args ~ '^[0-9, ]*$') AND (reader_ids IS NOT NULL)))
    AND ((reader_ids IS NULL) OR ((reader <> '') AND ((reader_ids)::jsonpath IS NOT NULL)))
    AND ((reader_tail IS NULL) OR ((reader <> '') AND (reader_args IS NULL) AND (reader_tail ~ '^(, *''[a-z_]+'')+$')))
    AND ((sample_filter IS NULL) OR ((reader_args IS NULL) AND (POSITION((';') IN (sample_filter)) = 0)))
    AND ((subject_kind <> 'withheld_column') OR ((reader <> '') AND (reader_args IS NULL))))));
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Live helper bodies (pg_get_functiondef 2026-11-25); receipt_line_system is stubbed (its live body reads a rule table
-- this contract does not need) for the words used here.
CREATE OR REPLACE FUNCTION public.text_redact_contact(p_text text)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $function$
  SELECT regexp_replace(regexp_replace(p_text,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g'),
    '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', 'g')
$function$;
CREATE OR REPLACE FUNCTION public.axle_printed_words(p text)
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT left(btrim(regexp_replace(regexp_replace(public.text_redact_contact(p),
           '\$\s*[0-9][0-9,]*(\.[0-9]+)?|\m[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?\M', '[amount]', 'g'), '\s+', ' ', 'g')), 160)
$function$;
CREATE OR REPLACE FUNCTION public.axle_type_from_words(p text, p_allow_open boolean DEFAULT true)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE WHEN n = 1 THEN CASE WHEN ls THEN 'limited-slip' WHEN lk THEN 'locking' ELSE 'open' END END
  FROM (
    SELECT ls, lk, op, (ls::int + lk::int + op::int) AS n
    FROM (
      SELECT s !~ '\y(non|no|not|without)[ -]+(posi|limited|lsd|locker|positrac|traction)' AND s ~
               '(limited[ -]?slip|\yposi\y|positrac|\ylsd\y|safe[ -]?t[ -]?track|sure[ -]?grip|traction[ -]?lok|trac[ -]?lok|true[ -]?trac)' AS ls,
             s !~ '\y(non|no|not|without)[ -]+(locker|spool)' AND s ~ '\y(locker|spool)\y' AS lk,
             p_allow_open AND s ~ '\yopen[ -](diff|differential|carrier)\y'
               AND s !~ '\yopen[ -](diff|differential|carrier)\y[ ,-]*(cover|housing|case|and|&)'
               AND s !~ '\y(inspect|inspection|check|drain|remove|pull|clean|drop|unbolt)' AS op
      FROM (SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) AS s) x) y) z
$function$;
CREATE OR REPLACE FUNCTION public.image_reading_tier_is_automatic(p_tier text)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(p_tier, '') <> '' and coalesce((select c.config_value -> 'automatic' ->> 'tier' = p_tier
                                                    from public.platform_config c where c.config_key = 'image_reading_tiers'), false) $function$;
CREATE OR REPLACE FUNCTION public.receipt_line_kind(p_description text, p_part_number text, p_total numeric, p_hours numeric, p_line_date date, p_performer text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN p_hours IS NOT NULL OR nullif(btrim(coalesce(p_performer, '')), '') IS NOT NULL
         OR (p_part_number IS NULL AND p_total IS NULL AND p_line_date IS NOT NULL) THEN 'labor'
    WHEN p_part_number IS NULL AND p_total IS NULL THEN 'note'
    ELSE 'part' END
$function$;
CREATE OR REPLACE FUNCTION public.receipt_line_system(p_text text) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN lower(p_text) ~ '(rear end|axle|differential|posi|limited slip|locker)' THEN 'axle' END $$;
-- get_analysis_stream as live (unchanged by the migration).
CREATE OR REPLACE FUNCTION public.get_analysis_stream(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40)
 RETURNS TABLE(image_id uuid, vehicle_id uuid, vehicle text, thumbnail_url text, image_url text, landed_at timestamp with time zone, scene_type text, build_phase text, narrative text, components jsonb, text_regions jsonb, state jsonb, hashed boolean, sessioned boolean, is_duplicate boolean, match_status text, intent text, needs_clarification boolean, attribution_doubt text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT vi.id, vi.vehicle_id, NULL::text, coalesce(vi.thumbnail_url, vi.medium_url, vi.image_url), vi.image_url, vi.updated_at,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type', vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess',
    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line', vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen',
    vi.ai_scan_metadata->'byok_deep_analysis'->'text_regions', vi.ai_scan_metadata->'byok_deep_analysis'->'state_observations',
    (vi.phash IS NOT NULL), (vi.work_session_id IS NOT NULL), coalesce(vi.is_duplicate, false), vi.image_vehicle_match_status,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'intent', false, NULL::text
  FROM (SELECT dr.image_id, dr.updated_at FROM user_image_deep_reads dr WHERE dr.user_id = auth.uid()
          AND (p_since IS NULL OR dr.updated_at > p_since) ORDER BY dr.updated_at DESC OFFSET 0) d
  JOIN vehicle_images vi ON vi.id = d.image_id
  JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE (vi.user_id = auth.uid()) IS TRUE
    AND vi.ai_scan_metadata ? 'byok_deep_analysis'
    AND coalesce(vi.is_superseded, false) = false
  ORDER BY d.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 40), 100));
$function$;
GRANT EXECUTE ON FUNCTION public.get_analysis_stream(timestamptz, integer) TO anon, authenticated, service_role;
-- The two readers' live 2026-11-25 bodies: the revert file creates exactly them and checks their md5.
\ir revert_20261125234700_definer_readers_scan_rules.sql
GRANT EXECUTE ON FUNCTION public.get_user_day_receipt(uuid, date), public.vehicle_axle_type_evidence(uuid) TO anon, authenticated, service_role;

-- Rows. shown_a (u1's photo on public car A, taken 2026-11-20) carries a deep reading: its stored observation copy and
-- the photo's own ai_scan_metadata. A reviewed reading of shown_a prints POSITRACTION; one of plate_a names a posi
-- differential with the car's plate on its tag.
UPDATE public.vehicle_images SET taken_at = '2026-11-20 15:00+00', updated_at = now(),
  ai_scan_metadata = '{"byok_deep_analysis": {"scene_type": "engine_bay", "narrative_one_line": "TSTNARR at TSTPLACE-H",
     "text_regions": [{"text": "TSTOCR-T"}], "components_seen": [{"label": "plate reads TST PL8-9 on the bumper"}]}}'::jsonb
 WHERE id = '10000000-0000-0000-0000-000000000001';
INSERT INTO public.vehicle_observations (vehicle_id, kind, structured_data, agent_model, extraction_method) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'condition', '{"analysis_kind": "image_deep_byok", "image_id": "10000000-0000-0000-0000-000000000001",
     "scene_type": "engine_bay", "narrative_one_line": "TSTNARR at TSTPLACE-H", "intent": "restoration",
     "presence": {"place_hint": "TSTPLACE-H"}, "text_regions": [{"text": "TSTOCR-T"}],
     "components_seen": [{"label": "plate reads TST PL8-9 on the bumper"}, {"label": "chrome bumper"}]}', 'fixture-model', NULL),
  ('a0000000-0000-0000-0000-00000000000a', 'condition', '{"image_id": "10000000-0000-0000-0000-000000000001",
     "components_seen": [{"label": "rear differential"}], "text_regions": [{"text": "POSITRACTION 3.73 TSTOCR-AX"}]}',
     'fixture-model', 'reviewed_image_analysis_v1'),
  ('a0000000-0000-0000-0000-00000000000a', 'condition', '{"image_id": "10000000-0000-0000-0000-000000000007",
     "components_seen": [{"label": "posi differential tag TST PL8-9"}]}', 'fixture-model', 'reviewed_image_analysis_v1');
INSERT INTO public.user_image_deep_reads (user_id, image_id) VALUES ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
-- The day's three other free-text carriers (ta-skeptic must-fix): the photo's file name, the owner's comment on it and a
-- work session's own title (work_type is the closed vocabulary a stranger gets instead).
UPDATE public.vehicle_images SET file_name = 'TSTFILE-home.jpg' WHERE id = '10000000-0000-0000-0000-000000000001';
INSERT INTO public.vehicle_observations (vehicle_id, kind, content_text, structured_data) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'comment', 'TSTNOTE from the owner',
   '{"analysis_kind": "owner_comment", "image_id": "10000000-0000-0000-0000-000000000001"}');
INSERT INTO public.work_sessions (id, user_id, vehicle_id, session_date, title, work_type, duration_minutes, total_job_cost, session_type) VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
   '2026-11-20', 'TSTTITLE at TSTPLACE-W', 'bodywork', 90, 1200, 'work');

-- t_receipt(uid, 'field'): the day receipt's first photo field as the caller; t_axle(uid): the photo rows, one line.
CREATE FUNCTION public.t_receipt(p_uid text, p_field text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb; o text;
BEGIN
  PERFORM public.t_claims(p_uid);
  EXECUTE format('SET LOCAL ROLE %I', CASE p_uid WHEN '' THEN 'anon' WHEN 'service' THEN 'service_role' ELSE 'authenticated' END);
  r := public.get_user_day_receipt('00000000-0000-0000-0000-000000000001', '2026-11-20') -> 'photos' -> 0;
  RESET ROLE;
  o := CASE WHEN p_field = '*' THEN r::text ELSE coalesce(r ->> p_field, 'null') END;
  RETURN o;
END $$;
CREATE FUNCTION public.t_axle(p_uid text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE o text;
BEGIN
  PERFORM public.t_claims(p_uid);
  EXECUTE format('SET LOCAL ROLE %I', CASE p_uid WHEN '' THEN 'anon' WHEN 'service' THEN 'service_role' ELSE 'authenticated' END);
  SELECT string_agg(e.origin || ':' || coalesce(public.t_label(e.image_id), '?') || ':' || coalesce(e.axle_type, '-') || ':' || coalesce(e.printed, 'null'), ' | '
                    ORDER BY e.origin)
    INTO o FROM public.vehicle_axle_type_evidence('a0000000-0000-0000-0000-00000000000a') e WHERE e.origin LIKE 'photo%';
  RESET ROLE;
  RETURN coalesce(o, 'none');
END $$;
-- t_free(uid): the three free-text carriers as the caller: work title | owner_note | file_name.
CREATE FUNCTION public.t_free(p_uid text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.t_claims(p_uid);
  EXECUTE format('SET LOCAL ROLE %I', CASE p_uid WHEN '' THEN 'anon' WHEN 'service' THEN 'service_role' ELSE 'authenticated' END);
  r := public.get_user_day_receipt('00000000-0000-0000-0000-000000000001', '2026-11-20');
  RESET ROLE;
  RETURN coalesce(r #>> '{work_sessions,0,title}', 'null') || ' | ' || coalesce(r #>> '{photos,0,owner_note}', 'null') || ' | '
      || coalesce(r #>> '{photos,0,file_name}', 'null');
END $$;
GRANT EXECUTE ON FUNCTION public.t_receipt(text, text), public.t_axle(text), public.t_free(text) TO anon, authenticated, service_role;

-- Before: the defect, on the live bodies.
BEGIN;
SELECT public.t_receipt('', 'narrative') AS b_narr, public.t_axle('') AS b_axle, public.t_free('') AS b_free \gset
ROLLBACK;
SELECT public.t_assert(:'b_free' = 'TSTTITLE at TSTPLACE-W | TSTNOTE from the owner | TSTFILE-home.jpg',
  format('before: anon reads the work title, the owner note and the file name (%s)', :'b_free'));
SELECT public.t_assert(:'b_narr' = 'TSTNARR at TSTPLACE-H' AND :'b_axle' LIKE '%POSITRACTION%',
  format('before: anon reads the deep narrative from the day receipt and photo text from the axle reader (%s / %s)', :'b_narr', :'b_axle'));

\ir ../migrations/20261125234700_definer_readers_scan_rules.sql

-- 1. The day receipt: anon and a stranger lose the narrative and text regions, the plate inside a label; keep the rest.
BEGIN;
SELECT public.t_receipt('', 'narrative') AS a_narr, public.t_receipt('', 'part_numbers') AS a_parts,
       public.t_receipt('', 'components') AS a_comp, public.t_receipt('', 'intent') AS a_intent, public.t_receipt('', 'id') AS a_id,
       public.t_receipt('', '*') AS a_all,
       public.t_receipt('00000000-0000-0000-0000-000000000002', '*') AS s_all \gset
ROLLBACK;
SELECT public.t_assert(:'a_narr' = 'null' AND :'a_parts' = 'null' AND :'a_comp' = '["plate reads [withheld] on the bumper", "chrome bumper"]'
  AND :'a_intent' = 'restoration' AND :'a_id' = '10000000-0000-0000-0000-000000000001' AND :'a_all' !~ 'TST',
  format('day receipt: anon gets the photo, its labels (plate withheld) and intent, no narrative or text regions (%s)', :'a_all'));
SELECT public.t_assert(:'s_all' = :'a_all', 'day receipt: a signed-in stranger reads what anon reads');

-- 1b. The free-text carriers go to p_user_id only (ta-skeptic must-fix): anyone else gets the work_type for the title
--     and no owner note or file name; p_user_id reads all three as stored.
BEGIN;
SELECT public.t_free('') AS f_anon, public.t_free('00000000-0000-0000-0000-000000000002') AS f_str,
       public.t_free('00000000-0000-0000-0000-000000000001') AS f_own \gset
ROLLBACK;
SELECT public.t_assert(:'f_anon' = 'bodywork | null | null' AND :'f_str' = :'f_anon',
  format('day receipt: anon and a stranger get the work type, no owner note and no file name (%s / %s)', :'f_anon', :'f_str'));
SELECT public.t_assert(:'f_own' = 'TSTTITLE at TSTPLACE-W | TSTNOTE from the owner | TSTFILE-home.jpg',
  format('day receipt: p_user_id reads the title, owner note and file name as stored (%s)', :'f_own'));

-- 2. p_user_id, the car's mechanic (tied) and service_role read the reading as stored.
BEGIN;
SELECT public.t_receipt('00000000-0000-0000-0000-000000000001', 'narrative') AS o_narr,
       public.t_receipt('00000000-0000-0000-0000-000000000001', 'part_numbers') AS o_parts,
       public.t_receipt('00000000-0000-0000-0000-000000000004', 'narrative') AS m_narr,
       public.t_receipt('00000000-0000-0000-0000-000000000004', 'components') AS m_comp,
       public.t_receipt('service', 'narrative') AS v_narr \gset
ROLLBACK;
SELECT public.t_assert(:'o_narr' = 'TSTNARR at TSTPLACE-H' AND :'o_parts' = '["TSTOCR-T"]' AND :'m_narr' = :'o_narr'
  AND :'m_comp' LIKE '%TST PL8-9%' AND :'v_narr' = :'o_narr',
  'day receipt: the photographer, a tied mechanic and service_role read narrative, text regions and the plate');

-- 3. The rule row withholds: without the narrative row, anon reads the narrative again (rolled back).
BEGIN;
DELETE FROM public.image_scan_withheld_paths WHERE surface = 'vehicle_images.ai_scan_metadata' AND path = '{byok_deep_analysis,narrative_one_line}';
SELECT public.t_receipt('', 'narrative') AS r_narr \gset
ROLLBACK;
SELECT public.t_assert(:'r_narr' = 'TSTNARR at TSTPLACE-H', 'day receipt: the narrative rule row is what withholds it');

-- 4. The axle reader: the photo rows stay (type and image), the text region's words go to an untied caller, a label
--    keeps its words with the plate withheld; the owner, the mechanic and service_role read the text.
BEGIN;
SELECT public.t_axle('') AS x_anon, public.t_axle('00000000-0000-0000-0000-000000000002') AS x_str,
       public.t_axle('00000000-0000-0000-0000-000000000001') AS x_own, public.t_axle('00000000-0000-0000-0000-000000000004') AS x_mech,
       public.t_axle('service') AS x_svc \gset
ROLLBACK;
SELECT public.t_assert(:'x_anon' = 'photo_label:plate_a:limited-slip:posi differential tag [withheld] | photo_text:shown_a:limited-slip:null'
  AND :'x_str' = :'x_anon',
  format('axle: anon and a stranger get the photo rows, no printed text region, the plate withheld in a label (%s)', :'x_anon'));
SELECT public.t_assert(:'x_own' = 'photo_label:plate_a:limited-slip:posi differential tag TST PL8-9 | photo_text:shown_a:limited-slip:POSITRACTION 3.73 TSTOCR-AX'
  AND :'x_mech' = :'x_own' AND :'x_svc' = :'x_own',
  format('axle: the owner, a tied mechanic and service_role read the printed words (%s)', :'x_own'));

-- 5. get_analysis_stream (unchanged): anon and a stranger get nothing; the photographer gets their reading.
BEGIN;
SELECT public.t_claims(''); SET LOCAL ROLE anon;
SELECT count(*) AS g_anon FROM public.get_analysis_stream() \gset
RESET ROLE;
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET LOCAL ROLE authenticated;
SELECT count(*) AS g_str FROM public.get_analysis_stream() \gset
RESET ROLE;
SELECT public.t_claims('00000000-0000-0000-0000-000000000001'); SET LOCAL ROLE authenticated;
SELECT string_agg(narrative, ',') AS g_own FROM public.get_analysis_stream() \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(:'g_anon' = '0' AND :'g_str' = '0' AND :'g_own' = 'TSTNARR at TSTPLACE-H',
  'analysis stream: anon and a stranger get no rows; the photographer reads their own');

-- 6. The probe rows.
SELECT public.t_assert((SELECT count(*) FROM public.private_row_probes WHERE owner_lane = 'ta-policies'
  AND reader IN ('get_analysis_stream', 'vehicle_axle_type_evidence') AND active) = 2
  AND (SELECT array_agg(rank ORDER BY rank) FROM public.private_row_probes WHERE owner_lane = 'ta-policies'
       AND reader IN ('get_analysis_stream', 'vehicle_axle_type_evidence')) = '{30,31}'::smallint[],
  'probes: two private_row_probes rows, ranks 30 and 31');

-- 6b. ta-skeptic's #3935 should-fixes. A component label whose plate is split by a carriage return (jsonb text: \r).
BEGIN;
UPDATE public.vehicle_images SET ai_scan_metadata = jsonb_build_object('byok_deep_analysis', jsonb_build_object('components_seen',
    jsonb_build_array(jsonb_build_object('label', E'tag TST\rPL89 on the bumper'))))
 WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT public.t_claims(''); SET LOCAL ROLE anon;
SELECT coalesce(public.vehicle_image_scan_metadata('10000000-0000-0000-0000-000000000001')
                #>> '{byok_deep_analysis,components_seen,0,label}', 'null') AS cr_label \gset
ROLLBACK;
SELECT public.t_assert(:'cr_label' = 'tag [withheld] on the bumper', 'worker: a plate split by a carriage return is withheld');

-- The id-keyed reader: the photo reads for anon as it is (control); approved but sensitive, or on a deleted public car,
-- it reads NULL. The fixture's gallery test admits an approved photo whatever is_sensitive says, so only the reader's
-- own terms stand between anon and these documents.
BEGIN;
SELECT public.t_claims(''); SET LOCAL ROLE anon;
SELECT (public.vehicle_image_scan_metadata('10000000-0000-0000-0000-000000000001') IS NOT NULL)::text AS sr_ctl \gset
RESET ROLE;
UPDATE public.vehicle_images SET is_sensitive = true, vision_gate_status = 'approved' WHERE id = '10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE anon;
SELECT (public.vehicle_image_scan_metadata('10000000-0000-0000-0000-000000000001') IS NULL)::text AS sr_sens \gset
ROLLBACK;
BEGIN;
UPDATE public.vehicles SET deleted_at = now()
 WHERE id = (SELECT vehicle_id FROM public.vehicle_images WHERE id = '10000000-0000-0000-0000-000000000001') AND is_public;
SELECT public.t_claims(''); SET LOCAL ROLE anon;
SELECT (public.vehicle_image_scan_metadata('10000000-0000-0000-0000-000000000001') IS NULL)::text AS sr_del \gset
ROLLBACK;
SELECT public.t_assert(:'sr_ctl' = 'true', 'scan reader: anon reads the shown photo on a public car (control)');
SELECT public.t_assert(:'sr_sens' = 'true', 'scan reader: anon gets NULL for a sensitive approved photo on a public car');
SELECT public.t_assert(:'sr_del' = 'true', 'scan reader: anon gets NULL for a photo on a deleted public car');

-- 7. The revert restores the live bodies (its own md5 check) and the defect with them, and removes the probe rows.
\ir revert_20261125234700_definer_readers_scan_rules.sql
BEGIN;
SELECT public.t_receipt('', 'narrative') AS v_narr2 \gset
ROLLBACK;
SELECT public.t_assert(:'v_narr2' = 'TSTNARR at TSTPLACE-H'
  AND NOT EXISTS (SELECT 1 FROM public.private_row_probes WHERE owner_lane = 'ta-policies')
  AND position('\\[nrt]' IN (SELECT prosrc FROM pg_proc WHERE proname = 'image_scan_metadata_for_viewer' AND pronargs = 4)) = 0
  AND position('\\[nt]' IN (SELECT prosrc FROM pg_proc WHERE proname = 'image_scan_metadata_for_viewer' AND pronargs = 4)) > 0,
  'revert: the live bodies are back (anon reads the narrative again), the probe rows are gone, the separator is newline and tab again');

SELECT 'definer_readers_scan_rules contract: PASS' AS result;
