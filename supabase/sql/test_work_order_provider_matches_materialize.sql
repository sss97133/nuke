-- Disposable PG17 only. Proves 20261020186500_work_order_provider_matches_materialize.sql as the job-loop replay applies
-- it (chained on the verified-claimant matching contract, whose provider-matches assertions run against the edited
-- reader): the per CTE is materialized, each provider x requirement match is computed once, and the reader still lists
-- the claimant with its passes.
\set ON_ERROR_STOP on
\ir test_open_requirements_claimed_providers.sql

RESET ROLE;
SELECT t_assert((SELECT prosrc ~ 'per AS MATERIALIZED' AND (length(prosrc) - length(replace(prosrc, 'provider_requirement_match(', ''))) / length('provider_requirement_match(') = 1
    FROM pg_proc WHERE oid = 'public.work_order_provider_matches_read(uuid,integer)'::regprocedure),
  'work_order_provider_matches_read computes each match once (materialized per CTE)');
CREATE TABLE public.mm_calls(n integer);
INSERT INTO public.mm_calls VALUES (0);
GRANT ALL ON public.mm_calls TO PUBLIC;
ALTER FUNCTION public.provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb) RENAME TO provider_requirement_match_inner;
CREATE FUNCTION public.provider_requirement_match(p_user uuid, p_bridge jsonb, p_requirement jsonb, p_job_org uuid, p_candidates jsonb, p_work_order_id uuid,
  p_area jsonb, p_window jsonb, p_tool_keys jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  UPDATE public.mm_calls SET n = n + 1;
  RETURN public.provider_requirement_match_inner(p_user, p_bridge, p_requirement, p_job_org, p_candidates, p_work_order_id, p_area, p_window, p_tool_keys);
END $$;
GRANT EXECUTE ON FUNCTION public.provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb) TO PUBLIC;
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT work_order_provider_matches_read('ab000000-0000-0000-0000-000000000004') AS pm \gset
RESET ROLE;
SELECT t_assert((SELECT n FROM mm_calls) = ((:'pm'::jsonb)#>>'{coverage,providers_considered}')::int
    * (SELECT count(*) FROM jsonb_array_elements(read_work_order_resources('ab000000-0000-0000-0000-000000000004')->'requirements'))
  AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'pm'::jsonb)->'providers') p WHERE p->'listed_because' ? 'verified_claimant'),
  'one match per provider and requirement; the claimant is still listed: ' || (SELECT n FROM mm_calls)::text);
