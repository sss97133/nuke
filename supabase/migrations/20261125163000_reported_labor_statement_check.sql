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
--   schema_proposals + one modify_property row (open) superseding the ratified labor_speaker_role text: the role is
--     derived from the source row, never the reader, and 'unknown' is added for a speaker the source cannot establish
--     (lead ruling 2026-11-25).
--   schema_proposal_quote_rules (labor row) + figure_term_pattern, exclude_pattern, exclude_basis: the figure recorded
--     is the number directly before the hour term; time-left / time-since phrasing is refused (ta-skeptic2 2026-11-25).
--   labor_statement_values (property_key FK observation_properties, value, proposal_id FK schema_proposals,
--     system_key FK receipt_line_systems): 13 values of the 4 prose enum keys, each a whole token of its ratified
--     key's 'Allowed values:' text (labor_scope 2, labor_speaker_role 4, labor_statement_kind 3, labor_time_basis
--     4), speaker_role 'unknown' citing its open superseding proposal, and one row per receipt_line_systems key for
--     labor_system_key with system_key = value: a key the ratified text names cites the ratified proposal, any
--     other (hardware, supplies) cites the open superseding one.
--   labor_statement_value_admitted(key, value): a value admits a statement only while its proposal is approved, or
--     was and is superseded by an approved one. A ruling is not a ratification (ta-skeptic2 must-fix 4): hardware,
--     supplies and speaker 'unknown' are listed and wait.
--   labor_statement_null_reasons (property_key FK observation_properties, reason, basis): why a key is absent. One
--     row: labor_system_key / names_no_one_system (the ratified text's 'a job that names no one system: teardown,
--     detailing, general').
--   reported_labor_statement_check(source_table, source_row_id, quote, low, high, qualifiers) -> jsonb
--     {ok, reasons[], contract, quote_hash, text_md5, page_vehicle_id, speaker_role, speaker_role_basis,
--     speaker_role_read}. Same source rules as gate A (schema_proposal_witness_sources: allowed table, row exists,
--     not generated) and the same quote rule row (schema_proposal_quote_rules 'labor': min_quote_chars, term_pattern,
--     figure_required, whole-token verbatim), plus: quote <= 300 chars; no exclude_pattern match; low is the first
--     figure of a figure_term_pattern match and high, when given, the same match's second (never any number in the
--     sentence); qualifiers only the 6 labor keys and labor_system_key_null_reason; scope, statement_kind and
--     time_basis required, listed and admitted; for task a system key or a null reason, never both; neither for
--     whole_build; stated_subject <= 80 chars, a whole-token run of the quote, 2+ words, one a name (capital or digit).
--     Figures and time phrases are read on the row text at the quote's span (a trimmed quote cannot cut a figure or a
--     time phrase). Thousands separators are read as printed.
--     speaker_role is derived from the source row: auction_comments.is_seller and build_posts author = build_threads
--     author give owner_seller; vehicles.description names no author (description_source: null or source_imported),
--     so it gives nothing; a quote naming another car (labor_stated_subject) gives commenter_other_car; anything else
--     is 'unknown'. The reader's role is returned
--     as speaker_role_read and decides nothing.
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
  ADD COLUMN IF NOT EXISTS exclude_basis text;
UPDATE public.schema_proposal_quote_rules
   SET figure_term_pattern = '\m([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\+?\s*(?:(?:-|to)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\+?\s*)?(?:man[- ]?)?(?:hours?|hrs?)\M',
       exclude_pattern = '\m(?:ends?|ending|closes?|closing|over|starts?|starting)\s+in\s+(?:about\s+|around\s+|less than\s+|under\s+)?[0-9][0-9.,]*\s*(?:hours?|hrs?)\M|\m[0-9][0-9.,]*\s*(?:more\s+)?(?:hours?|hrs?)\s+(?:left|remaining|to\s+go|ago|from\s+now)\M',
       exclude_basis = 'auction_comments TABLESAMPLE SYSTEM (0.2) REPEATABLE (7), read 2026-11-25: 138 comments hold a figure directly before an hour term; 48 of them match this pattern (auction time left or time since: ends in N hours, N hours left / ago); 0 of the 4 with labor phrasing (man hours, hours of work, hours in it) match it. Case found by ta-skeptic2: Bidding ends in 2 hours, good luck.'
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
         'null_reasons_from', 'labor_statement_null_reasons',
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

-- labor_speaker_role comes from the source row, not the reader (lead ruling 2026-11-25); a role the source cannot support
-- is 'unknown', the weakest. Filed open beside the ratified text, as for the system key.
INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, status, supersedes_proposal_id, payload, evidence)
SELECT 'claude-reported-labor-hours', 'modify_property', 'open', o.proposed_by_proposal_id,
       jsonb_build_object(
         'property_key', 'labor_speaker_role',
         'field', 'description',
         'adds_values', jsonb_build_array('unknown'),
         'derived_from', 'the source row: auction_comments.is_seller; build_posts author = build_threads author; vehicles.description has no author column, so its speaker is unknown',
         'description', 'Who made the statement, derived from the source row, never from the reader. owner_seller: the seller of the lot '
           || '(auction_comments.is_seller) or the author of the build thread (build_posts.author_handle = build_threads.author_handle). '
           || 'commenter_other_car: anyone else whose quote names the other car '
           || '(labor_stated_subject, verbatim in the quote). unknown: any other speaker; the weakest role, counted by no baseline that '
           || 'needs the speaker. shop_builder and third_party stay in the list for a source that can establish them.'),
       jsonb_build_array(jsonb_build_object('role', 'measurement', 'measured_on', '2026-11-25',
         'what', 'auction_comments.is_seller is populated: a 0.2% sample held 50,843 rows, 7,184 true, 0 null (ta-skeptic2); build_posts 1% sample: 250 of 629 posts by the thread author (author_handle)',
         'basis', 'a reader-asserted role passed the check as owner_seller for a commenter (ta-skeptic2 2026-11-25)'))
  FROM public.observation_properties o
 WHERE o.property_key = 'labor_speaker_role' AND o.proposed_by_proposal_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.schema_proposals p
                    WHERE p.proposal_type = 'modify_property' AND p.supersedes_proposal_id = o.proposed_by_proposal_id
                      AND p.payload -> 'adds_values' ? 'unknown');

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

INSERT INTO public.labor_statement_values (property_key, value, proposal_id)
SELECT 'labor_speaker_role', 'unknown', p.id
  FROM public.observation_properties o
  JOIN public.schema_proposals p ON p.proposal_type = 'modify_property' AND p.supersedes_proposal_id = o.proposed_by_proposal_id
                                AND p.payload -> 'adds_values' ? 'unknown'
 WHERE o.property_key = 'labor_speaker_role'
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
  IF n_enum <> 14 OR n_sys <> n_keys THEN
    RAISE EXCEPTION 'reported_labor_hours_v1: expected 14 prose values and % system rows, found % and % (are the 8 keys ratified?)',
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

-- A value admits a statement only while its proposal is ratified (approved), or was ratified and then superseded by a
-- ratified proposal. Values citing an open proposal are listed and wait.
CREATE OR REPLACE FUNCTION public.labor_statement_value_admitted(p_property_key text, p_value text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.labor_statement_values l JOIN public.schema_proposals p ON p.id = l.proposal_id
     WHERE l.property_key = p_property_key AND l.value = p_value
       AND (p.status = 'approved'
            OR (p.status = 'superseded' AND EXISTS (SELECT 1 FROM public.schema_proposals n
                                                     WHERE n.supersedes_proposal_id = p.id AND n.status = 'approved'))))
$fn$;
REVOKE ALL ON FUNCTION public.labor_statement_value_admitted(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_statement_value_admitted(text, text) TO service_role;

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
  subj text;
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
  -- labor_stated_subject names the other car: a whole-token run of the quote, at least two words, one of them a name
  -- (a capital or a digit: '1970 Pontiac GTO', 'my GTO'; not 'I', 'my car'). The floor is ta-labor's judgment, not a
  -- measured rule; it is what lets commenter_other_car be derived, so a skeptic attacks it.
  IF q ? 'labor_stated_subject' THEN
    subj := CASE WHEN jsonb_typeof(q -> 'labor_stated_subject') = 'string' THEN q ->> 'labor_stated_subject' END;
    pos := CASE WHEN subj IS NULL OR p_quote IS NULL THEN 0 ELSE position(subj IN p_quote) END;
    IF subj IS NULL OR length(subj) > 80 OR subj <> btrim(subj) OR array_length(regexp_split_to_array(subj, '\s+'), 1) < 2
       OR subj !~ '\m[A-Z0-9]' OR pos = 0
       OR substr(p_quote, pos - 1, 1) ~ '[[:alnum:]]' OR substr(p_quote, pos + length(subj), 1) ~ '[[:alnum:]]' THEN
      reasons := reasons || 'stated_subject_not_in_quote'::text;
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
  IF role IS NULL AND q ->> 'labor_speaker_role' = 'commenter_other_car' AND q ? 'labor_stated_subject'
     AND NOT ('stated_subject_not_in_quote' = ANY (reasons)) THEN
    role := 'commenter_other_car';
    role_basis := 'labor_stated_subject: the quote names another car';
  END IF;
  role := coalesce(role, 'unknown');
  role_basis := coalesce(role_basis, 'the source row does not establish the speaker');
  IF NOT public.labor_statement_value_admitted('labor_speaker_role', role) THEN
    reasons := reasons || 'speaker_role_unratified'::text;
  END IF;

  RETURN jsonb_build_object('ok', cardinality(reasons) = 0, 'reasons', to_jsonb(reasons),
    'contract', 'reported_labor_hours_v1', 'quote_hash', md5(coalesce(p_quote, '')), 'text_md5', md5(txt),
    'page_vehicle_id', page_veh, 'speaker_role', role, 'speaker_role_basis', role_basis,
    'speaker_role_read', q -> 'labor_speaker_role');
END $fn$;
COMMENT ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) IS
  'reported_labor_hours_v1: the one check a reported labor statement passes before ingest-observation lands it. Reads schema_proposal_witness_sources, schema_proposal_quote_rules (labor) and labor_statement_values; ok false with reasons otherwise.';
REVOKE ALL ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) TO service_role;
