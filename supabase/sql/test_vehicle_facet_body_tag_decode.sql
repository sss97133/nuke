-- Disposable PG17: the body tag's paint and trim codes read through the cited code tables (facet_body_tag_decode_v1).
-- Reuses the facet fixture (vehicle 1: paint 99/98, trim 999) and adds fixture rule rows and a paint_codes table.
-- Proves: with no matching rule the items are unchanged; with rules the item's `rule` carries the decoded names in
-- lower/upper order with the citation, `needed` names a second read and no longer a code table, status and value do
-- not move; a rule for another make or year does not match; the patch applies once.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
RESET ROLE;

CREATE TABLE IF NOT EXISTS public.paint_codes (id uuid PRIMARY KEY, code text, make text, name text);
GRANT SELECT ON public.paint_codes TO anon, authenticated;

\ir ../migrations/20261122071000_facet_body_tag_decode.sql
\ir ../migrations/20261122071000_facet_body_tag_decode.sql

CREATE TABLE public.t_before (paint jsonb, trim jsonb);
GRANT SELECT, INSERT ON public.t_before TO anon;
SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
INSERT INTO public.t_before
  SELECT public.t_item('10000000-0000-0000-0000-000000000001', 'paint', 'paint.as_built.code'),
         public.t_item('10000000-0000-0000-0000-000000000001', 'trim', 'trim.as_built.interior');
RESET ROLE;

INSERT INTO public.paint_codes VALUES ('d0000000-0000-0000-0000-000000000001', '99', 'Fixture', 'Fixture Red');
INSERT INTO public.vehicle_decode_rules (rule_key, make, model, code, year_min, year_max, value, qualifiers, citation_url, citation_title, citation_locator, cited_on)
SELECT x.rule_key, CASE WHEN x.other_make THEN 'Other Make' ELSE v.make END, v.model, x.code,
       v.year + x.dy, v.year + x.dy, x.value, '{}'::jsonb, 'https://x.invalid/chart', 'Fixture chart', 'p. 1', '2026-11-22'
FROM public.vehicles v,
 (VALUES ('body_tag_paint_code', '99', 0, false, '{"ref":{"id":"d0000000-0000-0000-0000-000000000001","table":"paint_codes"}}'::jsonb),
         ('body_tag_paint_code', '98', 0, false, '{"name":"Fixture White"}'::jsonb),
         ('body_tag_paint_code', '98', 5, false, '{"name":"Wrong Year"}'::jsonb),
         ('body_tag_paint_code', '98', 0, true,  '{"name":"Wrong Make"}'::jsonb),
         ('body_tag_trim_code',  '999', 0, false, '{"color":"Fixture Black","seat":"bucket"}'::jsonb)) x(rule_key, code, dy, other_make, value)
WHERE v.id = '10000000-0000-0000-0000-000000000001';
SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
DECLARE p jsonb; t jsonb; b record; d text;
BEGIN
  SELECT * INTO b FROM public.t_before;
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  PERFORM public.t_assert((length(d) - length(replace(d, 'facet_body_tag_decode_v1_end', ''))) / length('facet_body_tag_decode_v1_end') = 1,
    'patched once');
  PERFORM public.t_assert(b.paint->>'needed' LIKE '%paint-code table%' AND b.paint->'rule' = 'null'::jsonb,
    format('no rule row: paint item unchanged; got %s', b.paint));
  PERFORM public.t_assert(b.trim->>'needed' LIKE '%trim-code table%', 'no rule row: trim item unchanged');
  p := public.t_item('10000000-0000-0000-0000-000000000001', 'paint', 'paint.as_built.code');
  PERFORM public.t_assert(p->>'status' = b.paint->>'status' AND p->'value' = b.paint->'value' AND p->'sources' = b.paint->'sources',
    'paint status, value and sources do not move');
  PERFORM public.t_assert(p#>>'{rule,key}' = 'body_tag_paint_code' AND jsonb_array_length(p#>'{rule,decoded}') = 2
      AND p#>>'{rule,decoded,0,code}' = '99' AND p#>>'{rule,decoded,0,name}' = 'Fixture Red'
      AND p#>>'{rule,decoded,1,code}' = '98' AND p#>>'{rule,decoded,1,name}' = 'Fixture White'
      AND p#>>'{rule,citation_url}' = 'https://x.invalid/chart' AND jsonb_array_length(p#>'{rule,rule_ids}') = 2,
    format('paint rule decodes lower then upper with the citation; got %s', p->'rule'));
  PERFORM public.t_assert(p->>'needed' = 'a second independent read of the body tag', format('paint need; got %s', p->>'needed'));
  PERFORM public.t_assert(p::text !~ 'Wrong Year|Wrong Make', 'another year or make does not match');
  t := public.t_item('10000000-0000-0000-0000-000000000001', 'trim', 'trim.as_built.interior');
  PERFORM public.t_assert(t->>'status' = b.trim->>'status' AND t->'value' = b.trim->'value', 'trim status and value do not move');
  PERFORM public.t_assert(t#>>'{rule,key}' = 'body_tag_trim_code' AND t#>>'{rule,decoded,0,value,color}' = 'Fixture Black'
      AND jsonb_array_length(t#>'{rule,decoded}') = 1,
    format('trim rule decodes; got %s', t->'rule'));
  PERFORM public.t_assert(t->>'needed' = 'a second independent read of the body tag', 'trim need');
  PERFORM public.t_assert(public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.heads')->'rule' = 'null'::jsonb,
    'other items carry no tag rule');
END $$;
RESET ROLE;
\echo facet_body_tag_decode: ok
