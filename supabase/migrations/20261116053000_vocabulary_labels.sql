-- Header facet items: plain labels for the codes the items print.
--
-- WHY. An anonymous inventory of the header popups (4 vehicles x 9 tokens, 2026-11-12) found exactly seven machine
-- codes reaching the screen raw: four rule keys (rule.key), one examined result glued from a reading's code
-- ('transmission on tag: not_recorded_on_1973_plate') and two reading values (sources[].value). The renderer must not
-- invent wording for them; the reader carries it.
--
-- WHAT.
--   1. public.vocabulary_labels(domain, code, label, note): one plain label per code. Domains here: 'rule' (a rule key a
--      reader names) and 'reading_value' (a closed value a photo reading answered). Readable by anyone; written only by
--      migrations. Seeded with the seven codes only.
--   2. vehicle_facet_items, anchor-patched on the deployed body:
--      - every item whose rule key has a label gains rule.label;
--      - every source whose value is a labelled reading_value code gains value_label;
--      - the examined result reads the label in place of the code.
--      Nothing else changes. A code with no label stays as it is, with no label field.
--
-- Anchor patches of the deployed body; they refuse drift and are skipped when already applied.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.vocabulary_labels (
  domain text NOT NULL,
  code text NOT NULL,
  label text NOT NULL CHECK (btrim(label) <> ''),
  note text,
  PRIMARY KEY (domain, code)
);
COMMENT ON TABLE public.vocabulary_labels IS
  'Plain labels for machine codes that readers return (rule keys, closed reading values). One label per (domain, code); '
  'read by vehicle_facet_items; written by migrations only. A code with no row is shown as it is.';
ALTER TABLE public.vocabulary_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vocabulary_labels FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vocabulary_labels TO anon, authenticated;
DROP POLICY IF EXISTS vocabulary_labels_read ON public.vocabulary_labels;
CREATE POLICY vocabulary_labels_read ON public.vocabulary_labels FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.vocabulary_labels (domain, code, label, note) VALUES
  ('rule', 'gm_1972_1980_car_vin_v1', 'VIN chart, GM cars 1972–1980',
   'Decodes a 13-character GM car VIN position by position.'),
  ('rule', 'tribute_badge_rule_v1', 'Tribute cars earn no factory badge',
   'A tribute (vehicles.is_replica) is not given a factory series or trim badge.'),
  ('rule', 'model_availability', 'Factory availability by series and engine',
   'Cited sources on what the factory offered for the VIN series and engine; bounds the build, never states it.'),
  ('rule', 'transmission_gear_ratios', 'Gear ratios by transmission model',
   'Cited ratio sets for an identified transmission model and year range.'),
  ('reading_value', 'not_recorded_on_1973_plate', 'not recorded on the 1973 body tag',
   'The reading found no transmission code on the cowl tag; 1973 tags do not carry one.'),
  ('reading_value', 'not_original_engine', 'not the original engine',
   'The reading found the installed engine is not the one the car was built with.'),
  ('reading_value', 'not_original_unit', 'not the original unit',
   'The reading found the installed transmission is not the one the car was built with.')
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, note = EXCLUDED.note;

CREATE OR REPLACE FUNCTION pg_temp.patch_once(p_text text, p_anchor text, p_replacement text, p_what text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE n integer := (length(p_text) - length(replace(p_text, p_anchor, ''))) / greatest(length(p_anchor), 1);
BEGIN
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted (found % times): %', p_what, n, p_anchor; END IF;
  RETURN replace(p_text, p_anchor, p_replacement);
END $f$;

DO $migration$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('vocabulary_labels_v1' in d) = 0 THEN
    -- The examined result: the label of the code it read, else the code.
    d := pg_temp.patch_once(d,
      $a$'result', coalesce('transmission on tag: ' || (o.sd->>'transmission_on_tag'),
                              'original transmission: ' || (o.sd->>'original_transmission')))) AS checked,$a$,
      $a$'result', coalesce('transmission on tag: ' || coalesce((SELECT vl.label FROM public.vocabulary_labels vl
                                WHERE vl.domain = 'reading_value' AND vl.code = o.sd->>'transmission_on_tag'), o.sd->>'transmission_on_tag'),
                              'original transmission: ' || coalesce((SELECT vl.label FROM public.vocabulary_labels vl
                                WHERE vl.domain = 'reading_value' AND vl.code = o.sd->>'original_transmission'), o.sd->>'original_transmission')))) AS checked,$a$,
      'vehicle_facet_items examined result label');
    -- Rule and reading-value labels on every item, after every other step.
    d := pg_temp.patch_once(d,
      E'per_dim AS (\n  SELECT dim, jsonb_agg(doc ORDER BY ord) AS items FROM led GROUP BY dim\n)',
      E'-- vocabulary_labels_v1: plain labels for the codes an item carries (public.vocabulary_labels): rule.label for a\n'
      || E'-- labelled rule key, value_label on a source whose value is a labelled reading value. No label: nothing added.\n'
      || E'labeled AS (\n'
      || E'  SELECT l.dim, l.ord, l.doc\n'
      || E'    || CASE WHEN jsonb_typeof(l.doc->''rule'') = ''object'' AND rl.label IS NOT NULL\n'
      || E'         THEN jsonb_build_object(''rule'', (l.doc->''rule'') || jsonb_build_object(''label'', rl.label)) ELSE ''{}''::jsonb END\n'
      || E'    || CASE WHEN jsonb_typeof(l.doc->''sources'') = ''array'' AND EXISTS (SELECT 1\n'
      || E'           FROM jsonb_array_elements(l.doc->''sources'') s(src) JOIN public.vocabulary_labels vl\n'
      || E'             ON vl.domain = ''reading_value'' AND vl.code = s.src->>''value''\n'
      || E'           WHERE jsonb_typeof(s.src) = ''object'' AND jsonb_typeof(s.src->''value'') = ''string'')\n'
      || E'         THEN jsonb_build_object(''sources'', (SELECT jsonb_agg(s.src || coalesce((SELECT jsonb_build_object(''value_label'', vl.label)\n'
      || E'             FROM public.vocabulary_labels vl WHERE vl.domain = ''reading_value'' AND vl.code = s.src->>''value''\n'
      || E'               AND jsonb_typeof(s.src) = ''object'' AND jsonb_typeof(s.src->''value'') = ''string''), ''{}''::jsonb) ORDER BY s.n)\n'
      || E'           FROM jsonb_array_elements(l.doc->''sources'') WITH ORDINALITY s(src, n)))\n'
      || E'         ELSE ''{}''::jsonb END AS doc\n'
      || E'  FROM led l\n'
      || E'  LEFT JOIN public.vocabulary_labels rl ON rl.domain = ''rule'' AND rl.code = l.doc#>>''{rule,key}''\n'
      || E'),\n'
      || E'per_dim AS (\n  SELECT dim, jsonb_agg(doc ORDER BY ord) AS items FROM labeled GROUP BY dim\n)',
      'vehicle_facet_items labels');
    EXECUTE d;
  END IF;
END
$migration$;

COMMIT;
