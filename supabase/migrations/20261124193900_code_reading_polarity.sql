-- code_reading_polarity_v1: a text span becomes a membership of an exclusive kind only when it asserts the value of this
-- vehicle; a negated, changed-from or candidates span does not, by rule rows over the words around it.
--
-- WHY. vehicle_code_readings is a pattern match over free text, and data_set_code_candidates_v1 admits every match. On
-- the proof vehicle the trans_type automatic spans are 'Turbo 400' inside a parts-chart reference to another body and
-- 'Hydra-matic optional' inside a description of what the factory offered for the series; trans_speeds 3 is '3-speed
-- manual standard' in the same factory list. None says what this car has. Owner order 2026-11-24: polarity asserted /
-- negated / alternatives / changed_from, only asserted become members, a text enumerating candidates is one candidates
-- reading.
--
-- WHAT.
-- 1. code_reading_polarity_rules (rule_key PK, polarity negated | changed_from | candidates, side before | after,
--    pattern, priority, note): the rule rows, matched case-insensitively against the 80 characters before the span (to
--    the start of its sentence) or the 40 after it (to the end of its sentence).
-- 2. code_reading_polarity_v1(reading id): the span's origin text (vehicle_observations.content_text, the vehicles
--    column named by origin_column, auction_comments.comment_text, field_evidence.proposed_value) cut around
--    match_offset, the first matching rule by priority, else asserted. An unreadable origin is asserted (no change).
-- 3. data_set_code_candidates_v1 admits a reading of a kind whose data_set_kind_properties row is exclusive only when
--    its polarity is asserted. Non-exclusive kinds (option codes, documentation) are unchanged. data_set_code_candidates_v1
--    is part of model_fold_logic_key, so the fold loop re-folds its scoped vehicles and the planner supersedes the
--    memberships that are no longer candidates; vehicles outside the fold scopes keep theirs until they are folded.
--
-- REVERT. Restore data_set_code_candidates_v1 from pg_get_functiondef before this migration (one anchored line); DROP
-- FUNCTION code_reading_polarity_v1(uuid); DROP TABLE code_reading_polarity_rules. The next fold re-admits the spans.
-- Contract: supabase/sql/test_code_reading_polarity.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.code_reading_polarity_rules (
  rule_key text PRIMARY KEY,
  polarity text NOT NULL CHECK (polarity IN ('negated', 'changed_from', 'candidates')),
  side text NOT NULL CHECK (side IN ('before', 'after')),
  pattern text NOT NULL,
  priority integer NOT NULL,
  note text NOT NULL
);
ALTER TABLE public.code_reading_polarity_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_reading_polarity_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.code_reading_polarity_rules TO service_role;
COMMENT ON TABLE public.code_reading_polarity_rules IS
  'Rule rows: words before or after a text code span that make it not an assertion about this vehicle. Read by code_reading_polarity_v1. 20261124193900.';
INSERT INTO public.code_reading_polarity_rules (rule_key, polarity, side, pattern, priority, note) VALUES
  ('negation_before', 'negated', 'before', '\y(no|not|never|without|non|isn''t|wasn''t|is not|was not)\W+(\w+\W+){0,2}$', 10,
   'not a 4-speed; without the TH400'),
  ('changed_from_before', 'changed_from', 'before',
   '\y(converted|swapped|changed|switched|replaced|upgraded)\W+(\w+\W+){0,2}from\W+(\w+\W+){0,3}$|\y(in place of|instead of|replacing|originally( had| was| a)?)\W+(\w+\W+){0,2}$', 20,
   'converted from a TH400; originally an automatic'),
  ('changed_from_after', 'changed_from', 'after', '^\W*(\w+\W+){0,2}(was|were)?\W*(removed|swapped out|replaced|converted)\y', 21,
   'the Turbo 400 was swapped out'),
  ('candidates_or', 'candidates', 'after', '^\s*(or\W|and/or\W|/)', 30, 'M20 or M21; M20/M21/M22: one of several, not this car''s value'),
  ('candidates_or_before', 'candidates', 'before', '(\y(or|either|and/or)\W+|/\s*)$', 31, 'a Muncie or an M21; M20/M21'),
  ('candidates_reference', 'candidates', 'before',
   '\y(optional|option(al)? on|standard|available|availability|offered|lists?|listed|chart|only for|came with either|could be ordered|choice of)\y[^.;]*$', 40,
   'a factory or parts reference: what was offered, not what this car has'),
  ('candidates_reference_after', 'candidates', 'after', '^\W*(\w+\W+){0,1}(optional|standard(?!\W+(shift|trans))|available|offered)\y', 41,
   'Hydra-matic optional; not 3-speed standard shift (a manual)')
ON CONFLICT (rule_key) DO UPDATE SET polarity = excluded.polarity, side = excluded.side, pattern = excluded.pattern,
  priority = excluded.priority, note = excluded.note;

CREATE OR REPLACE FUNCTION public.code_reading_polarity_v1(p_reading_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r record; txt text; pos int; len int; pre text; post text; pol text;
BEGIN
  SELECT * INTO r FROM public.vehicle_code_readings WHERE id = p_reading_id;
  IF NOT FOUND OR r.match_offset IS NULL OR r.match_text IS NULL THEN RETURN 'asserted'; END IF;
  txt := CASE r.origin_table
    WHEN 'vehicle_observations' THEN (SELECT o.content_text FROM public.vehicle_observations o WHERE o.id = r.origin_id)
    WHEN 'auction_comments' THEN (SELECT c.comment_text FROM public.auction_comments c WHERE c.id = r.origin_id)
    WHEN 'field_evidence' THEN (SELECT f.proposed_value FROM public.field_evidence f WHERE f.id = r.origin_id)
    WHEN 'vehicles' THEN (SELECT CASE r.origin_column WHEN 'description' THEN v.description WHEN 'listing_title' THEN v.listing_title
                                   WHEN 'title' THEN v.title WHEN 'highlights' THEN v.highlights WHEN 'bat_listing_title' THEN v.bat_listing_title
                                   WHEN 'equipment' THEN v.equipment WHEN 'modifications' THEN v.modifications
                                   WHEN 'numbers_quote' THEN v.numbers_quote END
                            FROM public.vehicles v WHERE v.id = r.origin_id) END;
  IF txt IS NULL THEN RETURN 'asserted'; END IF;
  len := length(r.match_text);
  -- match_offset is 0-based or 1-based by decoder; take the occurrence of the span nearest the offset
  pos := r.match_offset + 1;
  IF substring(txt FROM pos FOR len) IS DISTINCT FROM r.match_text THEN
    pos := r.match_offset;
    IF pos < 1 OR substring(txt FROM pos FOR len) IS DISTINCT FROM r.match_text THEN RETURN 'asserted'; END IF;
  END IF;
  pre := substring(txt FROM greatest(1, pos - 80) FOR pos - greatest(1, pos - 80));
  pre := regexp_replace(pre, '^.*[.!?;\n]\s*', '');            -- to the start of the sentence
  post := substring(txt FROM pos + len FOR 40);
  post := regexp_replace(post, '[.!?;\n].*$', '');               -- to the end of the sentence
  SELECT k.polarity INTO pol FROM public.code_reading_polarity_rules k
   WHERE (k.side = 'before' AND pre ~* k.pattern) OR (k.side = 'after' AND post ~* k.pattern)
   ORDER BY k.priority LIMIT 1;
  RETURN coalesce(pol, 'asserted');
END;
$$;
REVOKE ALL ON FUNCTION public.code_reading_polarity_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.code_reading_polarity_v1(uuid) TO service_role;
COMMENT ON FUNCTION public.code_reading_polarity_v1(uuid) IS
  'asserted | negated | changed_from | candidates for one text code reading, by code_reading_polarity_rules over the words around its span in its origin text. 20261124193900.';

DO $patch$
DECLARE d text;
  a1 text := $a$     WHERE r.state = 'active' AND (p_kinds IS NULL OR r.kind = ANY (p_kinds))),$a$;
  r1 text := $a$     WHERE r.state = 'active' AND (p_kinds IS NULL OR r.kind = ANY (p_kinds))
       -- code_reading_polarity_v1: an exclusive kind admits only a span that asserts this vehicle's value
       AND (NOT EXISTS (SELECT 1 FROM public.data_set_kind_properties kp
                         WHERE kp.set_kind = CASE WHEN r.kind = 'build_date' THEN 'build_month' ELSE r.kind END AND kp.exclusive)
            OR public.code_reading_polarity_v1(r.id) = 'asserted')),$a$;
BEGIN
  d := pg_get_functiondef('public.data_set_code_candidates_v1(uuid[], text[])'::regprocedure);
  IF position('code_reading_polarity_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'data_set_code_candidates_v1: anchor not found exactly once'; END IF;
  EXECUTE replace(d, a1, r1);
END $patch$;
