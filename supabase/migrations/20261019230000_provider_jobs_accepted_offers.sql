-- Provider job lists include jobs taken through accept_offer (QUOTE lane RSI pass 7, found by the golden-path contract).
-- provider_job_ids (20261019140000) derived a provider's jobs only from organization ownership and line-item actors, so a
-- mechanic or inspector the customer accepted through accept_offer (work_order_assignments with an acceptance) did not
-- appear on provider_profile_read (work_record.jobs) or provider_job_record_read. Adds one branch: current accepted
-- providers (work_order_accepted_providers: the acceptance and the offer terms are still current) where the subject is
-- the offering account or the offer's performer actor, role 'accepted_provider'. A withheld acceptance drops out.
-- Everything else in the function is unchanged; readers and grants are unchanged.
-- Contract: supabase/sql/test_provider_jobs_accepted_offers.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.provider_job_ids(p_user_id uuid, p_actor_id uuid)
RETURNS TABLE(work_order_id uuid, vehicle_id uuid, subject_roles text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  WITH actors AS (
    SELECT p_actor_id AS actor_id WHERE p_actor_id IS NOT NULL
    UNION
    SELECT jsonb_array_elements_text(public.viewer_identity_bridge(p_user_id)->'evidenced_actor_ids')::uuid WHERE p_user_id IS NOT NULL
  ), j AS (
    SELECT w.id, w.vehicle_id, 'shop_owner'::text AS role FROM public.work_orders w
    WHERE p_user_id IS NOT NULL AND w.organization_id IN (SELECT bo.business_id FROM public.business_ownership bo
      WHERE bo.owner_id = p_user_id AND bo.status = 'active')
    UNION
    SELECT w.id, w.vehicle_id, 'performer' FROM public.work_order_line_items li JOIN public.work_orders w ON w.id = li.work_order_id
    WHERE li.actor_id IN (SELECT actor_id FROM actors)
    UNION
    SELECT w.id, w.vehicle_id, 'accepted_provider' FROM public.work_order_assignments a
      JOIN public.work_orders w ON w.id = a.work_order_id
      JOIN public.vehicle_observations fs ON fs.id = a.fulfillment_id
    WHERE a.acceptance_observation_id IS NOT NULL
      AND (fs.submitted_by_user_id = p_user_id OR a.performer_actor_id IN (SELECT actor_id FROM actors))
      AND EXISTS (SELECT 1 FROM public.work_order_accepted_providers(w.id) ap WHERE ap.assignment_id = a.id)
  )
  SELECT id, vehicle_id, array_agg(DISTINCT role ORDER BY role) FROM j GROUP BY id, vehicle_id
$$;
COMMENT ON FUNCTION public.provider_job_ids(uuid, uuid) IS 'Internal: work orders where a subject acts as provider: shop owner (active business_ownership of the work order organization), performer (evidenced actor on an operation) or accepted provider (current accept_offer acceptance of the subject''s offer or performer actor).';

NOTIFY pgrst, 'reload schema';
COMMIT;
