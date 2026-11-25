-- facet_reader_lineage_v1: a photo reading's reader family is the reader's lineage, from a row, not its method name.
--
-- WHY. vehicle_facet_items establishes an item from two independent sources in two reader families. For a photo reading
-- the family was 'reader:' || extraction_method and the source was the image. So (a) any new method name was a second
-- family, even when the same model wrote both rows, and (b) two readers of the same photo were one source, so a blind
-- re-read of the photographed stamp (the doubt loop, scripts/doubts) could never confirm the first read. The agreement
-- rule (owner, AGENTS.md "Reading photos"; lead 2026-11-24): one reader is a reading; establishment needs a second reader
-- family or paper; two runs of the same model are one reader.
--
-- WHAT CHANGES.
-- 1. model_registry (existing) gains the model strings on file with their provider, and reader_lineage(model) returns a
--    model's family: its provider, else the string itself. A rule is a row: re-grouping readers is a data change. A model
--    with no row is its own family; a reading with no model recorded falls back to its extraction_method, as before.
-- 2. vehicle_facet_items: every observation it reads carries `lineage`. A photo reading's family is 'reader:' || lineage
--    and its source is the photo AND the lineage ('img:<id>|reader:<lineage>'), so two lineages reading one photo are two
--    sources in two families, and two methods of one lineage are one family. A reading with no model recorded keeps
--    today's rule (family by method, one source per photo): nothing on file says which model wrote it, so it is never
--    counted as a second reader of a photo. field_evidence readings are unchanged. Each photo-reading source carries
--    `reader` (the lineage).
-- Disagreement is unchanged: two readings that normalize differently make the item `conflict` with `sides`.
--
-- REVERT. Redefine vehicle_facet_items from the definition before this migration (the replacements below in reverse),
-- then DROP FUNCTION public.reader_lineage(text) and delete the model_registry rows whose notes name facet_reader_lineage_v1.
-- Contract: supabase/sql/test_vehicle_facet_reader_lineage.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- The readers on file, extended into the existing registry (model_registry: slug, provider, caller_kind). A slug is the
-- model string a writer records (vehicle_observations.agent_model, evidence_judgment_requests.answer_model); provider is
-- the vendor model line. Models trained by one vendor share data and failure modes, so they do not confirm each other.
INSERT INTO public.model_registry (slug, provider, version, caller_kind, notes) VALUES
  ('claude-opus-5-5', 'anthropic', 'claude-opus-5-5', 'platform', 'reader family: facet_reader_lineage_v1'),
  ('claude-opus-4-8', 'anthropic', 'claude-opus-4-8', 'platform', 'reader family: facet_reader_lineage_v1'),
  ('claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 'platform', 'reader family: facet_reader_lineage_v1'),
  ('claude-code-cli', 'anthropic', NULL, 'platform', 'Claude Code CLI on the owner''s subscription; reader family: facet_reader_lineage_v1'),
  ('codex-cli (requested gpt-6-astra; runtime model unreported)', 'openai', NULL, 'platform',
   'OpenAI Codex CLI; reader family: facet_reader_lineage_v1'),
  ('Codex interactive assistant; exact model version not exposed', 'openai', NULL, 'platform',
   'OpenAI Codex interactive; reader family: facet_reader_lineage_v1'),
  ('codex-cli (requested gpt-6-astra; runtime model unreported); subsequent Codex interactive review (runtime version unreported)',
   'openai', NULL, 'platform', 'OpenAI Codex CLI, then Codex interactive; reader family: facet_reader_lineage_v1')
ON CONFLICT (slug) DO NOTHING;

-- The family of a recorded model: its registered provider when the registry knows the caller (platform or the owner's
-- own key), else the model string itself (a model with no row is its own family). Only the family leaves the registry.
CREATE OR REPLACE FUNCTION public.reader_lineage(p_agent_model text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT lower(m.provider) FROM public.model_registry m
                    WHERE m.slug = btrim(p_agent_model) AND m.caller_kind IN ('platform', 'user_byok')
                      AND nullif(btrim(m.provider), '') IS NOT NULL AND lower(m.provider) <> 'unknown'),
                  nullif(btrim(p_agent_model), ''))
$$;
COMMENT ON FUNCTION public.reader_lineage(text) IS
  'Reader family of a recorded model string: model_registry.provider for a registered platform or own-key caller, else the string itself; null for no model. Two readings agree independently only across families. Read by vehicle_facet_items (facet_reader_lineage_v1).';
REVOKE ALL ON FUNCTION public.reader_lineage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reader_lineage(text) TO anon, authenticated, service_role;

DO $patch$
DECLARE
  d text;
  n integer;
  r record;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_reader_lineage_v1' IN d) > 0 THEN RETURN; END IF;
  FOR r IN SELECT * FROM (VALUES
    -- obs: the reader's lineage beside each observation.
    (1, $a$o.source_observation_id, o.property_id, o.source_id, o.structured_data->>'claim_role' AS role,$a$,
        $b$o.source_observation_id, o.property_id, o.source_id, o.structured_data->>'claim_role' AS role,
         /* facet_reader_lineage_v1 */ coalesce(public.reader_lineage(o.agent_model), o.extraction_method) AS lineage,
         nullif(btrim(o.agent_model), '') IS NOT NULL AS lineage_known,$b$),
    -- registry-keyed readings: source = photo + lineage, family = lineage.
    (2, E'         CASE WHEN o.image_id IS NOT NULL THEN \'img:\' || o.image_id\n',
        E'         CASE WHEN o.image_id IS NOT NULL THEN \'img:\' || o.image_id || CASE WHEN o.lineage_known THEN \'|reader:\' || o.lineage ELSE \'\' END\n'),
    (3, E'         CASE WHEN o.image_id IS NOT NULL THEN \'reader:\' || o.method\n',
        E'         CASE WHEN o.image_id IS NOT NULL THEN \'reader:\' || o.lineage\n'),
    (4, $a$'class', CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END, 'limitation', o.limitation)$a$,
        $b$'class', CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END, 'limitation', o.limitation,
           'reader', CASE WHEN o.image_id IS NOT NULL THEN o.lineage END)$b$),
    -- claim-role photo readings: the same.
    (5, $a$coalesce('img:' || o.image_id, 'obs:' || o.id), 'reader:' || o.method, o.observed_at, 1,$a$,
        $b$coalesce('img:' || o.image_id || CASE WHEN o.lineage_known THEN '|reader:' || o.lineage ELSE '' END, 'obs:' || o.id),
         'reader:' || o.lineage, o.observed_at, 1,$b$),
    (6, E'           \'limitation\', o.limitation,\n',
        E'           \'limitation\', o.limitation, \'reader\', CASE WHEN o.image_id IS NOT NULL THEN o.lineage END,\n')
  ) x(ord, old, new) ORDER BY ord LOOP
    n := (length(d) - length(replace(d, r.old, ''))) / length(r.old);
    IF n <> 1 THEN RAISE EXCEPTION 'facet reader lineage anchor % drifted: % matches', r.ord, n; END IF;
    d := replace(d, r.old, r.new);
  END LOOP;
  EXECUTE d;
END $patch$;
