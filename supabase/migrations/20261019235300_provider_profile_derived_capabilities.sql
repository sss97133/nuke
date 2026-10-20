-- provider_profile_read capabilities section shows the evidence-derived rows (capability_fold_actor) with strength and
-- basis counts, ahead of the legacy hand-entered rows (labelled as such; basis not recorded). Capabilities still reach a
-- user only through the evidenced identity bridge the reader already uses (approved work_evidence, co_sign or
-- authenticated_sign links). Basis ids stay service-only; the profile shows counts.
--   One statement replaced in the live definition (start/end markers each once) and one coverage line extended.
-- Contract: supabase/sql/test_provider_profile_derived_capabilities.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.provider_capability_items(p_actor_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('actor_id', c.actor_id, 'capability_type', c.capability_type,
      'complexity_tier', c.complexity_tier, 'evidence_count', c.evidence_count, 'first_demonstrated', c.first_demonstrated,
      'last_demonstrated', c.last_demonstrated, 'derivation', c.derivation,
      'strength', CASE WHEN c.derivation = 'evidence_fold' THEN c.strength ELSE 'not_assessed' END,
      'basis_counts', CASE WHEN c.derivation = 'evidence_fold' THEN jsonb_build_object('direct', c.direct_count,
        'corroborating', c.corroborating_count, 'against', c.against_count) END,
      'basis_ids_recorded', CASE WHEN c.derivation = 'evidence_fold' THEN (SELECT count(*) FROM public.actor_capability_basis b
        WHERE b.actor_id = c.actor_id AND b.capability_type = c.capability_type) ELSE 0 END,
      'basis', CASE WHEN c.derivation = 'evidence_fold' THEN 'derived from attributed evidence (completion accepted by the customer, accepted-inspector findings, reported performed specifications, component event attribution); against counts requested-vs-performed conflicts and is not a verdict'
        ELSE 'legacy hand-entered row; basis not recorded' END)
    ORDER BY (c.derivation = 'evidence_fold') DESC, (c.strength = 'direct') DESC NULLS LAST, c.evidence_count DESC, c.capability_type), '[]'::jsonb)
  FROM public.actor_capabilities c WHERE c.actor_id = ANY (p_actor_ids)
$$;
REVOKE ALL ON FUNCTION public.provider_capability_items(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_capability_items(uuid[]) TO service_role;

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.provider_profile_read(uuid,uuid)'::regprocedure);
  s_mark constant text := $a$SELECT COALESCE(jsonb_agg(jsonb_build_object('actor_id', c.actor_id, 'capability_type', c.capability_type,$a$;
  e_mark constant text := $a$INTO caps FROM public.actor_capabilities c WHERE c.actor_id = ANY (actor_ids);$a$;
  c_mark constant text := $a$'not_assessed', jsonb_build_array('qualification', 'licensing currency', 'basis ids for existing rows')),$a$;
  s_pos integer; e_pos integer;
BEGIN
  IF position('provider_capability_items' IN def) > 0 THEN RAISE EXCEPTION 'provider_profile_read already shows derived capabilities'; END IF;
  IF (length(def) - length(replace(def, s_mark, ''))) / length(s_mark) <> 1 OR (length(def) - length(replace(def, e_mark, ''))) / length(e_mark) <> 1
     OR (length(def) - length(replace(def, c_mark, ''))) / length(c_mark) <> 1 THEN
    RAISE EXCEPTION 'provider_profile_read capability markers not found once';
  END IF;
  s_pos := position(s_mark IN def);
  e_pos := position(e_mark IN def) + length(e_mark);
  IF e_pos <= s_pos THEN RAISE EXCEPTION 'provider_profile_read capability markers out of order'; END IF;
  def := substr(def, 1, s_pos - 1) || 'caps := public.provider_capability_items(actor_ids);' || substr(def, e_pos);
  def := replace(def, c_mark, $r$'not_assessed', jsonb_build_array('qualification', 'licensing currency', 'basis ids for legacy hand-entered rows'),
        'derived', jsonb_build_object('rows', (SELECT count(*) FROM jsonb_array_elements(caps) x WHERE x->>'derivation' = 'evidence_fold'),
          'strengths', 'direct: customer-accepted provider completion, accepted-inspector findings or a performer-signed report; corroborating: attributed records',
          'never_counted', jsonb_build_array('self-claims', 'profile expertise', 'vouches', 'co-signs', 'offers'))),$r$);
  EXECUTE def;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
