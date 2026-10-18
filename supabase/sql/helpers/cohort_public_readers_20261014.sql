-- Fixture: the public cohort readers exactly as migration 20261014052500_popup_vehicle_intel_public_cohort.sql (PR #1129)
-- creates them. The valuation migration requires them to exist, so its contract loads them first, as if that migration had
-- been applied. If that migration's definitions change, change these to match.
CREATE OR REPLACE FUNCTION public.cohort_scope_rule(p_subject_id uuid)
 RETURNS TABLE(canonical_make text, grain text, year integer, year_start integer, year_end integer, pattern text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- The rule cohort_members() applies, as data: make, years and the word-boundary model regex built from the canonical
  -- model and its aliases. NULL pattern = no usable model words (cohort_members() then returns nothing).
  WITH p AS (
    SELECT mp.canonical_make, mp.grain, mp.year, mp.year_start, mp.year_end, mp.canonical_model, mp.canonical_model_id
      FROM public.make_model_profiles mp
     WHERE mp.subject_id = p_subject_id
  ), alts AS (
    SELECT string_agg(regexp_replace(lower(s.t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|') AS a
      FROM (
        SELECT lower(p.canonical_model) AS t FROM p
        UNION
        SELECT lower(al) FROM p JOIN public.canonical_models cm ON cm.id = p.canonical_model_id, unnest(cm.aliases) al
      ) s
     WHERE s.t IS NOT NULL AND length(trim(s.t)) > 0
  )
  SELECT p.canonical_make, p.grain, p.year, p.year_start, p.year_end,
         CASE WHEN alts.a IS NOT NULL AND alts.a <> '' THEN '\y(' || alts.a || ')\y' END
    FROM p CROSS JOIN alts
$fn$;

CREATE OR REPLACE FUNCTION public.cohort_members_public(p_subject_id uuid)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.cohort_scope_rule(p_subject_id);
  IF NOT FOUND OR r.pattern IS NULL THEN RETURN; END IF;
  -- definer: the visitor's view of a cohort is public, undeleted, non-part vehicles, stated here so the make, model and
  -- year quals can use the partial indexes on public vehicles instead of waiting behind the row policies.
  -- EXECUTE with the values written in, like cohort_members(): every call is planned for its own make and years, and
  -- never settles on a cached generic plan.
  IF r.grain = 'year' THEN
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year = %L::integer AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'' AND v.is_public AND v.deleted_at IS NULL',
      r.canonical_make, r.year, r.pattern);
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year BETWEEN %L::integer AND %L::integer AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'' AND v.is_public AND v.deleted_at IS NULL',
      r.canonical_make, r.year_start, r.year_end, r.pattern);
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION public.public_vehicles_by_model_year(p_make text, p_year integer, p_models text[])
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- p_models are lower-cased model names; a vehicle matches when lower(model) is one of them.
  -- EXECUTE with the values written in, on purpose: a SQL function (and a plpgsql statement after its fifth call) runs a
  -- generic plan, and the generic plan for this lookup does not know the year, so it read every year of the model through
  -- (lower(make), lower(model)). Ford Mustang 1966 on production: 18,729 buffers touched, 14,413 read, 6.6 s cold with the
  -- generic plan; 2,636 touched, 219 read, 144 ms cold with the values in the statement.
  RETURN QUERY EXECUTE format(
    'SELECT v.id FROM public.vehicles v
      WHERE lower(v.make) = lower(%L) AND v.year = %L::integer AND lower(v.model) = ANY (%L::text[])
        AND v.is_public AND v.deleted_at IS NULL',
    p_make, p_year, p_models);
END
$fn$;

-- Stated function by function: not PUBLIC, but the three API roles (these return ids of public vehicles, which anon can read).
REVOKE ALL ON FUNCTION public.cohort_scope_rule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cohort_scope_rule(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cohort_members_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cohort_members_public(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.public_vehicles_by_model_year(text, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_vehicles_by_model_year(text, integer, text[]) TO anon, authenticated, service_role;
