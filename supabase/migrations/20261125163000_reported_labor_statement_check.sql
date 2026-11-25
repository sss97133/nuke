-- reported_labor_hours_v1, SQL half: the allowed qualifier values and the one check every reported labor statement
-- passes before it lands.
--
-- WHY. Lead ruling 1 (2026-11-25): between gate A (the 8 labor keys, ratified live 00:58 PT by
-- schema_proposal_key_gate) and gate B (thresholds per baseline cell), "the 138 statements land through
-- ingest-observation with their source keys". The writer mode (ingest-observation reported_labor_hours_v1) calls
-- reported_labor_statement_check and refuses on any reason, so the edge function holds no copy of the rules.
--
-- ROWS.
--   receipt_line_systems + ('tires', 'Tires', expects_operation true), the way 'paint' came in (20261125114500):
--     receipt lines already name tires (5 receipt_items lines on 1 car whose description holds the word, none keyed
--     to a system, read 2026-11-25); labor_operations has 0 tire operations, so a tire line is a book hole, said as
--     one. No rule row: one goes through receipt_line_rule_propose / _promote when a line qualifies.
--   schema_proposals + one modify_property row (agent claude-reported-labor-hours, status open) superseding the
--     ratified labor_system_key text (proposal f1e80fb0): its values are receipt_line_systems.system_key, not a list
--     in prose; 'unplaced' is not a system but a NULL system with a reason (labor_statement_null_reasons). Lead
--     ruling 2026-11-25. It is filed, not ratified: it waits for its gate.
--   schema_proposal_quote_rules (labor row) + figure_term_pattern, exclude_pattern, exclude_basis,
--     labor_context_pattern, labor_context_basis, stated_subject_basis (lead ruling and ta-skeptic2, 2026-11-25): the
--     figure recorded is the number directly before the hour term; time-left, time-since, travel and meter phrasing is
--     refused; a statement counts only when the figure's sentence holds a work word. Each pattern carries its measured
--     basis on the row (n sampled, n matched, n labor on ta-labor's read; a skeptic's read replaces the counts).
--   labor_statement_values (property_key FK observation_properties, value, proposal_id FK schema_proposals,
--     system_key FK receipt_line_systems): 13 values of the 4 prose enum keys, each a whole token of its ratified
--     key's 'Allowed values:' text (labor_scope 2, labor_speaker_role 4, labor_statement_kind 3, labor_time_basis
--     4), and one row per receipt_line_systems key for labor_system_key with system_key = value: a key the ratified
--     text names cites the ratified proposal, any other (hardware, supplies) cites the open superseding one.
--   labor_statement_value_admitted(key, value): a value admits a statement only while the key's current approved
--     proposal covers it (the newest approved supersession, else the ratified proposal; its Allowed values text, its
--     values_from key table, or a whole token of its description). A ruling is not a ratification (ta-skeptic2
--     must-fix 4): hardware and supplies are listed and wait; a value an approved successor drops stops admitting.
--   labor_statement_null_reasons (property_key FK observation_properties, reason, basis): why a key is absent.
--     labor_system_key / names_no_one_system (the ratified text's 'a job that names no one system: teardown,
--     detailing, general'); labor_speaker_role / source_does_not_establish_speaker (the role is derived from the source
--     row; a speaker it cannot establish is NULL with this reason, the weakest weight, never a value: lead ruling).
--   labor_stated_subject_key(subject, text_before) -> {kind, key, token} | NULL: the make or model key the subject
--     names (canonical_makes, make_alias_ref, canonical_models), written with a digit or with a capital that does not
--     open its sentence, and not directly after a preposition (text_before is the row text before the subject).
--   reported_labor_statement_check(source_table, source_row_id, quote, low, high, qualifiers) -> jsonb
--     {ok, disposition, reasons[], held_reasons[], contract, quote_hash, text_md5, page_vehicle_id, speaker_role,
--     speaker_role_null_reason, speaker_role_basis, speaker_role_read, stated_subject_key}.
--     disposition refused (any reason; nothing lands), held (well formed, but no work word in the figure's clause (its sentence cut at then / and then / but) or a
--     stated subject that names no key: held_reasons no_labor_context / stated_subject_unresolved; it lands, admits
--     nothing and reaches no baseline) or admitted (ok true).
--     Same source rules as gate A (schema_proposal_witness_sources: allowed table, row exists, not generated) and the
--     same quote rule row (min_quote_chars, term_pattern, figure_required, whole-token verbatim), plus: quote <= 300
--     chars; no exclude_pattern match touching the quote; low is the first figure of a figure_term_pattern match and
--     high, when given, the same match's second (never any number in the sentence); qualifiers only the 6 labor keys
--     and labor_system_key_null_reason; scope, statement_kind and time_basis required, listed and admitted; for task a
--     system key or a null reason, never both; neither for whole_build; stated_subject <= 80 chars, a whole-token run
--     of the quote holding no hour figure that resolves through labor_stated_subject_key; a subject that resolves to
--     nothing is held (held_reasons stated_subject_unresolved), never admitted as commenter_other_car. Figures, time phrases and the work word are read on the row text at the quote's span
--     (a trimmed quote cannot cut a figure or a time phrase). Thousands separators are read as printed.
--     speaker_role is derived from the source row: auction_comments.is_seller and build_posts author = build_threads
--     author give owner_seller; vehicles.description names no author (description_source: null or source_imported),
--     so it gives nothing; a resolved stated subject with the reader's commenter_other_car gives commenter_other_car;
--     anything else is NULL with speaker_role_null_reason. The reader's role is returned as speaker_role_read and
--     decides nothing.
--     page_vehicle_id is the car of the page the statement appeared on (auction_comments.vehicle_id; build_posts ->
--     build_threads.vehicle_id; vehicles.id). It is never the subject: hours reach a vehicle only through a subject
--     edge with its own evidence. The writer lands the observation with vehicle_id NULL: proj_disposition marks a
--     car in_progress on any work_record row and vehicle_build_log_public prints every work_record on a public car,
--     so a commenter's hours about another car must not sit on this car's row (board 01:24 PT).
-- Test: supabase/sql/test_reported_labor_statement_check.sql (PG17, chained after the gate A test).

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- The quote rule row gains the two patterns a VALUE needs (skeptic2 / lead 2026-11-25): the figure recorded must be the
-- number directly before the hour term, and time-left / time-since phrasing is not labor.
ALTER TABLE public.schema_proposal_quote_rules
  ADD COLUMN IF NOT EXISTS figure_term_pattern text,
  ADD COLUMN IF NOT EXISTS exclude_pattern text,
  ADD COLUMN IF NOT EXISTS exclude_basis text,
  ADD COLUMN IF NOT EXISTS labor_context_pattern text,
  ADD COLUMN IF NOT EXISTS labor_context_basis text,
  ADD COLUMN IF NOT EXISTS stated_subject_basis text;
UPDATE public.schema_proposal_quote_rules
   SET figure_term_pattern = '\m([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\+?\s*(?:(?:-|to)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\+?\s*)?(?:man[- ]?)?(?:hours?|hrs?)\M',
       exclude_pattern = '\m(?:ends?|ending|closes?|closing|over|starts?|starting)\s+in\s+(?:about\s+|around\s+|less than\s+|under\s+)?[0-9][0-9.,]*\s*(?:hours?|hrs?)\M|\m[0-9][0-9.,]*\s*(?:more\s+)?(?:hours?|hrs?)\s+(?:left|remaining|remain|to\s+go|ago|from\s+now|until|till|before|away|drive|driving|trip|flight|between|of\s+(?:use|sleep|idling|driving)|on\s+the\s+(?:engine|clock|meter))\M|\m[0-9][0-9.,]*\s*(?:hours?|hrs?)\s+(?:on\s+(?:it|her|him|the\s+\w+)\s+)?since\M',
       exclude_basis = 'auction_comments TABLESAMPLE SYSTEM (0.2) REPEATABLE (7), sentences split on .!?; read 2026-11-25: 142 hold a figure directly before an hour term; 70 match this pattern (time left or since in an auction, distance or travel time, run interval, hours on a meter), 0 of them labor on ta-labor''s read. Cases: Bidding ends in 2 hours (ta-skeptic2), N hours until / remain (ta-skeptic2), N hours between rebuilds, N hours on it since the rebuild (ta-skeptic2; the since alternative matches 0 more of the 142). ta-skeptic2''s read of the same 142 (01:42 PT): 70 excluded, 0 labor.',
       labor_context_pattern = '\m(labou?r\w*|man[- ]?hours?|(re)?build\w*|(re)?built|restor\w*|resto|fabricat\w*|weld\w*|paint(ed|ing|work)?|bodywork|sand(ed|ing)|install\w*|swap\w*|conver(sion|ted|ting)|replac\w*|repair\w*|(dis)?assembl\w*|tear(ing)?\s+down|tore\s+down|detail(ed|ing)|polish\w*|machin\w*|fix\w*|rewir\w*|wir(ed|ing)|upholster\w*|chang(ed|ing)\s+out|servic\w*|test(ed|ing)|overhaul\w*|refinish\w*)\M',
       labor_context_basis = 'same sample: of the 72 sentences the exclude pattern leaves, 12 hold a work word in the sentence of the figure (10 labor on ta-labor''s read; 2 not: a test mode, a pressure test) and 60 hold none (2 labor on ta-labor''s read: N hours with one person, a shop N hours to do; 1 unclear). A statement with no work word lands held (no_labor_context) and admits nothing (lead ruling 2026-11-25). The work word is read in the figure''s clause: its sentence cut at then / and then / but (0 of the 142 change). ta-skeptic2''s read of the same 142 (01:42 PT, own sentence split): 10 with a work word, 9 labor; 62 without, 2 labor, 1 unclear.'
 WHERE category = 'labor';
UPDATE public.schema_proposal_quote_rules
   SET stated_subject_basis = 'labor_stated_subject_key: a word run of the subject equal to a make or model key (canonical_makes names and aliases, make_alias_ref aliases not retired, canonical_models names and aliases; 13,664 distinct keys holding a letter, read 2026-11-25), written as the subject writes it starting with a digit or with a capital that does not open its sentence in the row text, and not directly after a preposition (at, in, to, of, for, from, with, near, by; optionally the/a/an); both rules are ta-skeptic2''s (01:42 PT). Sample: possessive phrases (my/our/his/her and up to four words) in auction_comments TABLESAMPLE SYSTEM (0.5) REPEATABLE (11) holding an hour figure, 256 distinct; 46 resolve, of which 33 name a car on ta-labor''s read and 13 do not (a place, a site, a collection, a dealer); of 60 unresolved sampled, 6 name a car (a digits-only model, or a model written in lower case). Without the capital test, car, motor, engine, truck, project and one resolve as canonical_models names. One call reads the key tables in 98 ms (EXPLAIN ANALYZE). ta-skeptic2''s read (live key tables loaded into PG17: 403 makes, 169 aliases, 4,497 models; 269 possessive phrases, TABLESAMPLE SYSTEM (0.5) REPEATABLE (11), hour-bearing): before the two rules 47 resolve, 32 a vehicle, 13 not, 2 unclear; the preposition rule removes 6 of the 13 and 0 vehicles; projected after both rules 41 resolve, 7 not a vehicle. canonical_models holds BAT, FL, Junior, Speed, Touring, Truck, One and Car as model keys; a false resolution would set commenter_other_car, so an unresolved subject is held.'
 WHERE category = 'labor';

INSERT INTO public.receipt_line_systems (system_key, label, expects_operation)
VALUES ('tires', 'Tires', true)
ON CONFLICT (system_key) DO NOTHING;

-- The superseding text for labor_system_key (filed open; the ratified row stays as it is until a gate decides).
INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, status, supersedes_proposal_id, payload, evidence)
SELECT 'claude-reported-labor-hours', 'modify_property', 'open', o.proposed_by_proposal_id,
       jsonb_build_object(
         'property_key', 'labor_system_key',
         'field', 'description',
         'values_from', 'receipt_line_systems.system_key',
         'stored_in', 'labor_statement_values.system_key',
         'null_reasons_from', 'labor_statement_null_reasons',
         'qualifier_of', jsonb_build_array('labor_hours_reported_low', 'labor_hours_reported_high'),
         'dropped_values', jsonb_build_object('unplaced', 'names_no_one_system'),
         'description', 'The car system the hours were spent on: a receipt_line_systems.system_key (the key table is the list; '
           || 'no values are named here). Required for labor_scope=task unless the sentence names no one system (teardown, '
           || 'detailing, general), in which case it is absent and the statement carries labor_system_key_null_reason = '
           || 'names_no_one_system from labor_statement_null_reasons. Absent for whole_build. Written as the qualifier of one '
           || 'work_record observation whose property_key is labor_hours_reported_low; never an observation of its own.'),
       jsonb_build_array(jsonb_build_object('role', 'measurement', 'measured_on', '2026-11-25',
         'what', 'ratified text lists 18 values; receipt_line_systems held 18 keys; 16 shared; text-only: tires, unplaced; table-only: hardware, supplies',
         'basis', 'two sources of truth for one key; the key table wins (lead ruling 2026-11-25)'))
  FROM public.observation_properties o
 WHERE o.property_key = 'labor_system_key' AND o.proposed_by_proposal_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.schema_proposals p
                    WHERE p.proposal_type = 'modify_property' AND p.supersedes_proposal_id = o.proposed_by_proposal_id
                      AND p.payload ->> 'values_from' = 'receipt_line_systems.system_key');

CREATE TABLE IF NOT EXISTS public.labor_statement_values (
  property_key text NOT NULL REFERENCES public.observation_properties(property_key),
  value text NOT NULL CHECK (value ~ '^[a-z][a-z_]*$'),
  proposal_id uuid NOT NULL REFERENCES public.schema_proposals(id),
  system_key text REFERENCES public.receipt_line_systems(system_key),
  PRIMARY KEY (property_key, value),
  CHECK ((property_key = 'labor_system_key') = (system_key IS NOT NULL)),
  CHECK (system_key IS NULL OR value = system_key)
);
COMMENT ON TABLE public.labor_statement_values IS
  'reported_labor_hours_v1: allowed values of the labor statement qualifier keys (grain: key x value). Prose enums cite their ratifying proposal and are whole tokens of its Allowed values text; labor_system_key values are receipt_line_systems keys (system_key FK) citing the superseding proposal.';
ALTER TABLE public.labor_statement_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.labor_statement_values FROM anon, authenticated;
GRANT SELECT ON public.labor_statement_values TO service_role;

CREATE TABLE IF NOT EXISTS public.labor_statement_null_reasons (
  property_key text NOT NULL REFERENCES public.observation_properties(property_key),
  reason text NOT NULL CHECK (reason ~ '^[a-z][a-z_]*$'),
  basis text NOT NULL,
  PRIMARY KEY (property_key, reason)
);
ALTER TABLE public.labor_statement_null_reasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.labor_statement_null_reasons FROM anon, authenticated;
GRANT SELECT ON public.labor_statement_null_reasons TO service_role;
INSERT INTO public.labor_statement_null_reasons (property_key, reason, basis)
SELECT 'labor_system_key', 'names_no_one_system',
       'labor_system_key text (proposal f1e80fb0): ''unplaced for a job that names no one system (teardown, detailing, general)''; lead ruling 2026-11-25: not a system, a NULL system with a reason'
 WHERE EXISTS (SELECT 1 FROM public.observation_properties WHERE property_key = 'labor_system_key')
ON CONFLICT (property_key, reason) DO NOTHING;
-- labor_speaker_role is derived from the source row (lead ruling 2026-11-25); a speaker the source cannot establish is
-- NULL with this reason, the weakest weight, never a vocabulary value (lead ruling 2026-11-25, ta-skeptic2 must-fix 4).
INSERT INTO public.labor_statement_null_reasons (property_key, reason, basis)
SELECT 'labor_speaker_role', 'source_does_not_establish_speaker',
       'lead rulings 2026-11-25: the role comes from the source row (auction_comments.is_seller; build_posts author = build_threads author); vehicles.description names no author (description_source null or source_imported on 9,417 of 9,418 sampled); any other speaker is NULL with this reason'
 WHERE EXISTS (SELECT 1 FROM public.observation_properties WHERE property_key = 'labor_speaker_role')
ON CONFLICT (property_key, reason) DO NOTHING;

INSERT INTO public.labor_statement_values (property_key, value, proposal_id)
SELECT o.property_key, v.value, o.proposed_by_proposal_id
  FROM (VALUES
    ('labor_scope', 'whole_build'), ('labor_scope', 'task'),
    ('labor_speaker_role', 'owner_seller'), ('labor_speaker_role', 'shop_builder'),
    ('labor_speaker_role', 'commenter_other_car'), ('labor_speaker_role', 'third_party'),
    ('labor_statement_kind', 'actual'), ('labor_statement_kind', 'estimate'), ('labor_statement_kind', 'hearsay'),
    ('labor_time_basis', 'own'), ('labor_time_basis', 'paid_shop'), ('labor_time_basis', 'book_quote'),
    ('labor_time_basis', 'unknown')
  ) v(property_key, value)
  JOIN public.observation_properties o ON o.property_key = v.property_key
 WHERE o.proposed_by_proposal_id IS NOT NULL AND o.data_type = 'enum'
ON CONFLICT (property_key, value) DO NOTHING;

-- A key the ratified text names cites the ratified proposal; any other key cites the open superseding proposal and
-- admits nothing until that proposal is ratified (skeptic2 must-fix 4, 2026-11-25: a ruling is not a ratification).
INSERT INTO public.labor_statement_values (property_key, value, proposal_id, system_key)
SELECT 'labor_system_key', s.system_key,
       CASE WHEN coalesce(substring(o.description FROM 'Allowed values:(.*)$'), '') ~ ('\m' || s.system_key || '\M')
            THEN o.proposed_by_proposal_id ELSE p.id END,
       s.system_key
  FROM public.receipt_line_systems s
  JOIN public.observation_properties o ON o.property_key = 'labor_system_key'
  JOIN public.schema_proposals p ON p.proposal_type = 'modify_property' AND p.supersedes_proposal_id = o.proposed_by_proposal_id
                                AND p.payload ->> 'values_from' = 'receipt_line_systems.system_key'
ON CONFLICT (property_key, value) DO NOTHING;

DO $guard$
DECLARE n_enum int; n_sys int; n_keys int; bad text;
BEGIN
  SELECT count(*) FILTER (WHERE system_key IS NULL), count(*) FILTER (WHERE system_key IS NOT NULL)
    INTO n_enum, n_sys FROM public.labor_statement_values;
  SELECT count(*) INTO n_keys FROM public.receipt_line_systems;
  IF n_enum <> 13 OR n_sys <> n_keys THEN
    RAISE EXCEPTION 'reported_labor_hours_v1: expected 13 prose values and % system rows, found % and % (are the 8 keys ratified?)',
      n_keys, n_enum, n_sys;
  END IF;
  SELECT string_agg(l.property_key || '.' || l.value, ', ') INTO bad
    FROM public.labor_statement_values l
    JOIN public.observation_properties o ON o.property_key = l.property_key
   WHERE NOT (o.proposed_by_proposal_id = l.proposal_id
              AND coalesce(substring(o.description FROM 'Allowed values:(.*)$'), '') ~ ('\m' || l.value || '\M'))
     AND NOT EXISTS (SELECT 1 FROM public.schema_proposals p WHERE p.id = l.proposal_id AND p.proposal_type = 'modify_property'
                        AND p.supersedes_proposal_id = o.proposed_by_proposal_id
                        AND (p.payload -> 'adds_values' ? l.value
                             OR (l.system_key IS NOT NULL AND p.payload ->> 'values_from' = 'receipt_line_systems.system_key')));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'reported_labor_hours_v1: values not in their ratified key''s Allowed values text: %', bad;
  END IF;
END $guard$;

-- A value admits a statement only while the key's CURRENT approved proposal covers it: the newest approved supersession
-- of the ratified proposal if there is one, else the ratified proposal itself. Coverage: the ratified 'Allowed values:'
-- text (whole token), a successor's values_from key table, or a whole token of the successor's own description. A value an approved successor drops stops admitting
-- (ta-skeptic2 should-fix 2026-11-25). Values citing an open proposal are listed and wait.
CREATE OR REPLACE FUNCTION public.labor_statement_value_admitted(p_property_key text, p_value text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  WITH o AS (SELECT op.proposed_by_proposal_id AS pid, op.description FROM public.observation_properties op
              WHERE op.property_key = p_property_key),
  cur AS (SELECT p.id, p.payload, (p.id = o.pid) AS is_original
            FROM public.schema_proposals p, o
           WHERE p.status = 'approved' AND (p.id = o.pid OR p.supersedes_proposal_id = o.pid)
           ORDER BY (p.id = o.pid), p.proposed_at DESC
           LIMIT 1)
  SELECT p_value ~ '^[a-z][a-z_]*$'
     AND EXISTS (SELECT 1 FROM public.labor_statement_values l WHERE l.property_key = p_property_key AND l.value = p_value)
     AND EXISTS (SELECT 1 FROM cur, o WHERE CASE
           WHEN cur.is_original THEN coalesce(substring(o.description FROM 'Allowed values:(.*)$'), '') ~ ('\m' || p_value || '\M')
           WHEN cur.payload ->> 'values_from' = 'receipt_line_systems.system_key'
             THEN EXISTS (SELECT 1 FROM public.receipt_line_systems r WHERE r.system_key = p_value)
           ELSE coalesce(substring(cur.payload ->> 'description' FROM 'Allowed values:(.*)$'), cur.payload ->> 'description', '')
                  ~ ('\m' || p_value || '\M') END)
$fn$;
REVOKE ALL ON FUNCTION public.labor_statement_value_admitted(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_statement_value_admitted(text, text) TO service_role;

-- labor_stated_subject must name a car by a key (ta-skeptic2 must-fix 5, 2026-11-25): a run of whole words of the
-- subject equal to a key of canonical_makes (canonical_name, display_name, short_name, aliases), make_alias_ref
-- (alias_text, not retired) or canonical_models (canonical_model, aliases), holding a letter, written starting with a
-- digit, or with a capital that does not open its sentence ('A very clean...', 'Truck took...' do not count), and not
-- directly after a preposition (at, in, to, of, for, from, with, near, by; optionally the/a/an: 'in Phoenix', 'era of
-- Porsche'). p_before is the row text before the subject (the check passes it). Basis:
-- schema_proposal_quote_rules.stated_subject_basis. Returns {kind, key, token} for the longest key, or NULL.
CREATE OR REPLACE FUNCTION public.labor_stated_subject_key(p_subject text, p_before text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  cand record;
  st int;
  before text;
  first text;
BEGIN
  IF p_subject IS NULL THEN RETURN NULL; END IF;
  FOR cand IN
    WITH s AS (SELECT ' ' || btrim(regexp_replace(lower(p_subject), '[^a-z0-9]+', ' ', 'g')) || ' ' AS cs),
    c(kind, key, token) AS (
      SELECT 'canonical_makes', m.id::text, t FROM public.canonical_makes m,
             unnest(array_remove(ARRAY[m.canonical_name, m.display_name, m.short_name] || coalesce(m.aliases, '{}'::text[]), NULL)) t
      UNION ALL
      SELECT 'make_alias_ref', a.id::text, a.alias_text FROM public.make_alias_ref a WHERE a.retired_at IS NULL
      UNION ALL
      SELECT 'canonical_models', cm.id::text, t FROM public.canonical_models cm,
             unnest(array_remove(ARRAY[cm.canonical_model] || coalesce(cm.aliases, '{}'::text[]), NULL)) t),
    k AS MATERIALIZED (SELECT kind, key, btrim(regexp_replace(lower(token), '[^a-z0-9]+', ' ', 'g')) AS token
                         FROM c WHERE token ~ '[A-Za-z]')
    SELECT k.kind, k.key, k.token FROM k, s
     WHERE length(k.token) >= 2 AND strpos(s.cs, ' ' || k.token || ' ') > 0
     GROUP BY k.kind, k.key, k.token
     ORDER BY length(k.token) DESC, k.kind, k.key
  LOOP
    st := regexp_instr(p_subject, '\m' || replace(cand.token, ' ', '[^[:alnum:]]+') || '\M', 1, 1, 0, 'i');
    CONTINUE WHEN st = 0;
    first := substr(p_subject, st, 1);
    before := coalesce(p_before, '') || substr(p_subject, 1, st - 1);
    CONTINUE WHEN first !~ '[A-Z0-9]';
    CONTINUE WHEN first ~ '[A-Z]' AND before ~ '(^|[.!?;:])["'')\]]*\s*$';
    CONTINUE WHEN before ~* '\m(at|in|to|of|for|from|with|near|by)\s+((the|a|an)\s+)?$';
    RETURN jsonb_build_object('kind', cand.kind, 'key', cand.key, 'token', cand.token);
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.labor_stated_subject_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_stated_subject_key(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reported_labor_statement_check(
  p_source_table text, p_source_row_id uuid, p_quote text, p_low numeric, p_high numeric, p_qualifiers jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  src public.schema_proposal_witness_sources%ROWTYPE;
  qr public.schema_proposal_quote_rules%ROWTYPE;
  reasons text[] := '{}';
  txt text;
  generated boolean;
  pos int;
  q jsonb := coalesce(p_qualifiers, '{}'::jsonb);
  k text;
  page_veh uuid;
  role text;
  role_basis text;
  qend int;
  n int;
  ms int;
  me int;
  f1 numeric;
  f2 numeric;
  at_low boolean := false;
  at_high boolean := false;
  cut boolean := false;
  timed boolean := false;
  ctx boolean := false;
  sent_start int;
  sent_end int;
  e int;
  k2 int;
  cl_start int;
  subj text;
  subj_key jsonb;
  role_null_reason text;
  disposition text;
  held text[] := '{}';
BEGIN
  SELECT * INTO qr FROM public.schema_proposal_quote_rules WHERE category = 'labor';
  IF NOT FOUND THEN reasons := reasons || 'no_quote_rule'::text; END IF;
  SELECT * INTO src FROM public.schema_proposal_witness_sources WHERE source_table = p_source_table;
  IF NOT FOUND THEN
    reasons := reasons || 'source_not_allowed'::text;
  ELSIF p_source_row_id IS NULL THEN
    reasons := reasons || 'row_missing'::text;
  ELSE
    EXECUTE format('SELECT %I::text FROM public.%I WHERE id = $1', src.text_column, src.source_table)
       INTO txt USING p_source_row_id;
    IF txt IS NULL THEN
      reasons := reasons || 'row_missing'::text;
    ELSIF src.generated_marker_column IS NOT NULL THEN
      EXECUTE format('SELECT %I IS NOT NULL FROM public.%I WHERE id = $1', src.generated_marker_column, src.source_table)
         INTO generated USING p_source_row_id;
      IF generated THEN reasons := reasons || 'row_generated'::text; END IF;
    END IF;
  END IF;

  IF p_quote IS NULL OR length(btrim(p_quote)) < coalesce(qr.min_quote_chars, 1) THEN
    reasons := reasons || 'quote_too_short'::text;
  ELSE
    IF length(p_quote) > 300 THEN reasons := reasons || 'quote_too_long'::text; END IF;
    IF qr.category IS NOT NULL AND p_quote !~* qr.term_pattern THEN reasons := reasons || 'quote_no_term'::text; END IF;
    IF qr.figure_required AND p_quote !~ '[0-9]' THEN reasons := reasons || 'quote_no_figure'::text; END IF;
    IF txt IS NOT NULL THEN
      pos := position(p_quote IN txt);
      IF pos = 0 OR substr(txt, pos - 1, 1) ~ '[[:alnum:]]' OR substr(txt, pos + length(p_quote), 1) ~ '[[:alnum:]]' THEN
        reasons := reasons || 'quote_not_in_row'::text;
      END IF;
    END IF;
  END IF;

  -- Figures and time phrases are read on the ROW text at the quote's span, never on the quote alone, so trimming a quote
  -- cannot cut a figure out of '1,200' or '40-60 hrs', or a time phrase down to its hours (ta-labor advisor review
  -- 2026-11-25). A figure_term_pattern match wholly inside the span gives the figures: low is its first figure and high,
  -- when given, the same match's second (or the first, for a single figure). A match the span cuts refuses
  -- figure_term_cut. Any exclude_pattern match touching the span refuses quote_time_phrase.
  IF pos > 0 THEN
    qend := pos + length(p_quote);
    IF qr.exclude_pattern IS NOT NULL THEN
      n := 1;
      LOOP
        ms := regexp_instr(txt, qr.exclude_pattern, 1, n, 0, 'i');
        EXIT WHEN ms = 0 OR n > 200;
        me := regexp_instr(txt, qr.exclude_pattern, 1, n, 1, 'i');
        IF ms < qend AND me > pos THEN timed := true; END IF;
        n := n + 1;
      END LOOP;
    END IF;
    IF qr.figure_term_pattern IS NOT NULL THEN
      n := 1;
      LOOP
        ms := regexp_instr(txt, qr.figure_term_pattern, 1, n, 0, 'i');
        EXIT WHEN ms = 0 OR n > 200;
        me := regexp_instr(txt, qr.figure_term_pattern, 1, n, 1, 'i');
        IF ms < qend AND me > pos THEN
          IF ms < pos OR me > qend THEN
            cut := true;
          ELSE
            f1 := replace(regexp_substr(txt, qr.figure_term_pattern, 1, n, 'i', 1), ',', '')::numeric;
            f2 := replace(coalesce(regexp_substr(txt, qr.figure_term_pattern, 1, n, 'i', 2),
                                   regexp_substr(txt, qr.figure_term_pattern, 1, n, 'i', 1)), ',', '')::numeric;
            IF f1 = p_low THEN
              at_low := true;
              IF f2 = p_high THEN at_high := true; END IF;
              -- the sentence of this figure (split on .!?; followed by space or end) holds a work word
              e := regexp_instr(reverse(substr(txt, 1, ms - 1)), '\s[.!?;]');
              sent_start := CASE WHEN e = 0 THEN 1 ELSE ms - e + 1 END;
              e := regexp_instr(substr(txt, me), '[.!?;](\s|$)');
              sent_end := CASE WHEN e = 0 THEN length(txt) + 1 ELSE me + e END;
              -- the figure's clause: the sentence cut at then / and then / but around the figure
              k2 := 1;
              LOOP
                e := regexp_instr(substr(txt, sent_start, ms - sent_start), '\m(?:and\s+)?then\M|\mbut\M', 1, k2, 1, 'i');
                EXIT WHEN e = 0 OR k2 > 50;
                cl_start := sent_start + e - 1;
                k2 := k2 + 1;
              END LOOP;
              cl_start := coalesce(cl_start, sent_start);
              e := regexp_instr(substr(txt, me, greatest(sent_end - me, 0)), '\m(?:and\s+)?then\M|\mbut\M', 1, 1, 0, 'i');
              sent_end := CASE WHEN e = 0 THEN sent_end ELSE me + e - 1 END;
              sent_start := cl_start;
              cl_start := NULL;
              IF qr.labor_context_pattern IS NOT NULL
                 AND substr(txt, sent_start, sent_end - sent_start) ~* qr.labor_context_pattern THEN
                ctx := true;
              END IF;
            END IF;
          END IF;
        END IF;
        n := n + 1;
      END LOOP;
    END IF;
  END IF;
  IF timed THEN reasons := reasons || 'quote_time_phrase'::text; END IF;
  IF cut THEN reasons := reasons || 'figure_term_cut'::text; END IF;
  IF p_low IS NULL OR p_low <= 0 THEN
    reasons := reasons || 'low_missing'::text;
  ELSIF qr.figure_term_pattern IS NULL THEN
    reasons := reasons || 'no_figure_term_rule'::text;
  ELSE
    IF NOT at_low THEN reasons := reasons || 'low_not_at_term'::text; END IF;
    IF p_high IS NOT NULL THEN
      IF p_high < p_low THEN reasons := reasons || 'high_below_low'::text; END IF;
      IF NOT at_high THEN reasons := reasons || 'high_not_at_term'::text; END IF;
    END IF;
  END IF;

  IF jsonb_typeof(q) <> 'object' THEN
    reasons := reasons || 'qualifiers_not_object'::text;
    q := '{}'::jsonb;
  END IF;
  FOR k IN SELECT jsonb_object_keys(q) LOOP
    IF k NOT IN ('labor_scope', 'labor_system_key', 'labor_speaker_role', 'labor_statement_kind', 'labor_time_basis',
                 'labor_stated_subject', 'labor_system_key_null_reason') THEN
      reasons := reasons || ('qualifier_unknown:' || k);
    ELSIF k = 'labor_system_key_null_reason' THEN
      IF jsonb_typeof(q -> k) <> 'string' OR NOT EXISTS (SELECT 1 FROM public.labor_statement_null_reasons r
                                                          WHERE r.property_key = 'labor_system_key' AND r.reason = q ->> k) THEN
        reasons := reasons || ('qualifier_value_unknown:' || k);
      END IF;
    ELSIF k <> 'labor_stated_subject' AND (jsonb_typeof(q -> k) <> 'string' OR NOT EXISTS (
            SELECT 1 FROM public.labor_statement_values l WHERE l.property_key = k AND l.value = q ->> k)) THEN
      reasons := reasons || ('qualifier_value_unknown:' || k);
    ELSIF k NOT IN ('labor_stated_subject', 'labor_speaker_role') AND NOT public.labor_statement_value_admitted(k, q ->> k) THEN
      reasons := reasons || ('qualifier_value_unratified:' || k);
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['labor_scope', 'labor_statement_kind', 'labor_time_basis'] LOOP
    IF NOT q ? k THEN reasons := reasons || ('qualifier_missing:' || k); END IF;
  END LOOP;
  IF q ? 'labor_system_key' AND q ? 'labor_system_key_null_reason' THEN
    reasons := reasons || 'system_key_and_null_reason'::text;
  ELSIF q ->> 'labor_scope' = 'task' AND NOT q ? 'labor_system_key' AND NOT q ? 'labor_system_key_null_reason' THEN
    reasons := reasons || 'system_key_missing'::text;
  ELSIF q ->> 'labor_scope' = 'whole_build' AND (q ? 'labor_system_key' OR q ? 'labor_system_key_null_reason') THEN
    reasons := reasons || 'system_key_on_whole_build'::text;
  END IF;
  -- labor_stated_subject names the other car: a whole-token run of the quote (else refused: the reader's text is not
  -- verbatim) that resolves to a make or model key (labor_stated_subject_key) and holds no hour figure. A subject that
  -- resolves to nothing ('I had', '2500 hours') is NULL with held reason stated_subject_unresolved: the statement lands
  -- held, never as commenter_other_car (lead ruling 2026-11-25).
  IF q ? 'labor_stated_subject' THEN
    subj := CASE WHEN jsonb_typeof(q -> 'labor_stated_subject') = 'string' THEN q ->> 'labor_stated_subject' END;
    pos := CASE WHEN subj IS NULL OR p_quote IS NULL THEN 0 ELSE position(subj IN p_quote) END;
    IF subj IS NULL OR length(subj) > 80 OR subj <> btrim(subj) OR pos = 0
       OR substr(p_quote, pos - 1, 1) ~ '[[:alnum:]]' OR substr(p_quote, pos + length(subj), 1) ~ '[[:alnum:]]' THEN
      reasons := reasons || 'stated_subject_not_in_quote'::text;
    ELSE
      -- the row text before the subject, so a capital opening its sentence and a preceding preposition are seen
      subj_key := public.labor_stated_subject_key(subj,
                    CASE WHEN txt IS NOT NULL AND position(p_quote IN txt) > 0
                         THEN substr(txt, 1, position(p_quote IN txt) + pos - 2) ELSE '' END);
      IF subj_key IS NULL OR (qr.figure_term_pattern IS NOT NULL AND subj ~* qr.figure_term_pattern) THEN
        held := held || 'stated_subject_unresolved'::text;
        subj_key := NULL;
      END IF;
    END IF;
  END IF;

  -- The page the statement appeared on, and the speaker's role as the source row says it. page_vehicle_id is never the
  -- subject: a commenter's hours are about the car the commenter names, which is often not the lot.
  IF txt IS NOT NULL THEN
    IF p_source_table = 'auction_comments' THEN
      SELECT c.vehicle_id, CASE WHEN c.is_seller IS TRUE THEN 'owner_seller' END
        INTO page_veh, role FROM public.auction_comments c WHERE c.id = p_source_row_id;
      role_basis := CASE WHEN role IS NOT NULL THEN 'auction_comments.is_seller' END;
    ELSIF p_source_table = 'build_posts' THEN
      SELECT t.vehicle_id, CASE WHEN b.author_handle IS NOT NULL AND b.author_handle = t.author_handle THEN 'owner_seller' END
        INTO page_veh, role FROM public.build_posts b JOIN public.build_threads t ON t.id = b.build_thread_id
       WHERE b.id = p_source_row_id;
      role_basis := CASE WHEN role IS NOT NULL THEN 'build_posts.author_handle = build_threads.author_handle' END;
    ELSIF p_source_table = 'vehicles' THEN
      page_veh := p_source_row_id;
      -- vehicles.description_source does not name the author (1% sample 2026-11-25: 6,656 null, 2,761
      -- source_imported, 1 user_input): a publisher's listing prose is not the seller speaking, so the role stays NULL.
      NULL;
    END IF;
  END IF;
  IF role IS NULL AND q ->> 'labor_speaker_role' = 'commenter_other_car' AND subj_key IS NOT NULL THEN
    role := 'commenter_other_car';
    role_basis := 'labor_stated_subject: the quote names another car';
  END IF;
  IF role IS NULL THEN
    role_null_reason := 'source_does_not_establish_speaker';
    role_basis := 'the source row does not establish the speaker';
  ELSIF NOT public.labor_statement_value_admitted('labor_speaker_role', role) THEN
    reasons := reasons || 'speaker_role_unratified'::text;
  END IF;

  -- refused: the statement is malformed or not labor (nothing lands). held: well-formed and verbatim but no work word in
  -- the figure's sentence; it lands, admits nothing and reaches no baseline (lead ruling 2026-11-25). admitted: counts.
  IF cardinality(reasons) > 0 THEN
    disposition := 'refused';
  ELSIF NOT ctx OR cardinality(held) > 0 THEN
    disposition := 'held';
    IF NOT ctx THEN held := 'no_labor_context'::text || held; END IF;
  ELSE
    disposition := 'admitted';
  END IF;

  RETURN jsonb_build_object('ok', disposition = 'admitted', 'disposition', disposition, 'reasons', to_jsonb(reasons),
    'held_reasons', to_jsonb(held),
    'contract', 'reported_labor_hours_v1', 'quote_hash', md5(coalesce(p_quote, '')), 'text_md5', md5(txt),
    'page_vehicle_id', page_veh, 'speaker_role', role, 'speaker_role_null_reason', role_null_reason,
    'speaker_role_basis', role_basis, 'speaker_role_read', q -> 'labor_speaker_role', 'stated_subject_key', subj_key);
END $fn$;
COMMENT ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) IS
  'reported_labor_hours_v1: the one check a reported labor statement passes before ingest-observation lands it. Reads schema_proposal_witness_sources, schema_proposal_quote_rules (labor) and labor_statement_values. disposition admitted (counts), held (lands, admits nothing: held_reasons) or refused (nothing lands: reasons).';
REVOKE ALL ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) TO service_role;
