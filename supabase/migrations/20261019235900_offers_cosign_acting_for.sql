-- Co-sign acting-for (iOS lane gap). cosign_provider already chooses its capacity through p_cut (p_cut.organization_id for an
-- organization, p_cut.as = 'self' for the account), but work_order_offers_read evaluated eligibility without one, so a member
-- of several organizations (eligibility reason name_organization_id) got no cosign action at all.
--   cosign_acting_for(user, offer): the capacities the user may sign in: each organization they own or belong to that is
--     eligible ({kind: organization, organization_id, name, p_cut: {organization_id}}) and the account itself when eligible
--     ({kind: user, p_cut: {as: self}}).
--   work_order_offers_read: the cosign_provider action carries acting_for and is offered also when the only refusal is
--     name_organization_id (two anchored edits in the live definition).
-- Contract: supabase/sql/test_offers_cosign_acting_for.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.cosign_acting_for(p_user uuid, p_offer_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.ord, x.name, x.org), '[]'::jsonb) FROM (
    SELECT 1 AS ord, o.org, public.platform_organization_label(o.org)->>'name' AS name,
      public.platform_organization_label(o.org) || jsonb_build_object('kind', 'organization', 'organization_id', o.org,
        'p_cut', jsonb_build_object('organization_id', o.org)) AS item
    FROM (SELECT DISTINCT y.x AS org FROM (SELECT bo.business_id x FROM public.business_ownership bo WHERE bo.owner_id = p_user AND bo.status = 'active'
      UNION SELECT oc.organization_id FROM public.organization_contributors oc WHERE oc.user_id = p_user AND oc.status = 'active') y WHERE y.x IS NOT NULL) o
    WHERE (public.work_order_cosign_eligibility(p_user, p_offer_id, jsonb_build_object('organization_id', o.org))->>'eligible')::boolean
    UNION ALL
    SELECT 2, NULL::uuid, NULL::text, jsonb_build_object('kind', 'user', 'label', 'yourself', 'p_cut', jsonb_build_object('as', 'self'))
    WHERE p_user IS NOT NULL AND (public.work_order_cosign_eligibility(p_user, p_offer_id, jsonb_build_object('as', 'self'))->>'eligible')::boolean) x
$$;
REVOKE ALL ON FUNCTION public.cosign_acting_for(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cosign_acting_for(uuid,uuid) TO service_role;

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.work_order_offers_read(uuid)'::regprocedure);
  a1 constant text := $a$'attestor_organization_id', el->'attestor_organization_id'))), '[]'::jsonb)$a$;
  a2 constant text := $a$CROSS JOIN LATERAL (SELECT public.work_order_cosign_eligibility(viewer, (o->>'offer_id')::uuid, NULL) AS el) e
      WHERE (el->>'eligible')::boolean;$a$;
  a text;
BEGIN
  IF position('cosign_acting_for' IN def) > 0 THEN RAISE EXCEPTION 'work_order_offers_read already carries acting_for'; END IF;
  FOREACH a IN ARRAY ARRAY[a1, a2] LOOP
    IF (length(def) - length(replace(def, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'work_order_offers_read anchor not found once: %', a; END IF;
  END LOOP;
  def := replace(def, a1, $r$'attestor_organization_id', el->'attestor_organization_id'),
        'acting_for', public.cosign_acting_for(viewer, (o->>'offer_id')::uuid))), '[]'::jsonb)$r$);
  def := replace(def, a2, $r$CROSS JOIN LATERAL (SELECT public.work_order_cosign_eligibility(viewer, (o->>'offer_id')::uuid, NULL) AS el) e
      WHERE (el->>'eligible')::boolean OR el->>'reason' = 'name_organization_id';$r$);
  EXECUTE def;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
