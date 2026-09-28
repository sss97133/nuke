-- ============================================================================
-- Privacy containment: synced photos filed onto public cars by GPS
-- ============================================================================
--
-- WHY (2026-09-28, measured): the owner's Photos-library sync resumed today. Its on-device
-- label gate matched substrings, so photos labeled Child, Bed/Bedroom, People and Document
-- reached the pool (gate fixed on main in 2e462c0a4). photo-pipeline-orchestrator
-- (cron 478, re-enabled today) then hard-assigned 21 of them by GPS to "nearby vehicles with
-- recent work": 18 onto the 1983 GMC K2500 (a90c008a, sold 2026-02-22; photos taken
-- 2026-06-30..07-22) and 3 onto the 1932 Ford Hot Rod (21ee373f, returned to its owner
-- 2025-10-28; photos taken 2026-08-14). Both cars are public, the rows had is_sensitive
-- false, and an anonymous REST probe read all 21. 17 carry child, bed/bedroom, people or
-- document labels. No image_observations claim and no reattribution_audit row records the
-- assignment.
--
-- Why a flag and not supersession: the public images policy and get_vehicle_profile_data
-- both ignore is_superseded, so a superseded original would stay on the car page. Both
-- honor is_sensitive for non-owners. The flag is the owner's access control, not a
-- testimony value; the photo, its labels, dates and vehicle link are untouched.
--
-- ALLOW_RAW_TESTIMONY_WRITE — deliberate: recovery from an exposure the resumed sync
-- (session 871512de) caused. The write is confined to the function below, which only sets
-- the privacy flag and records who, when and why.
--
-- This migration:
--   1. adds set_image_sensitivity(), a sanctioned writer for the privacy flag on
--      vehicle_images. service_role only.
--   2. marks the 21 photos sensitive.
--   3. pauses cron 478 (photo-pipeline-drain) until its GPS resolver checks that a vehicle
--      is still in the owner's possession before assigning.
-- The wrong assignments themselves are undone separately with demote_observation_to_user.
--
-- Live verification after CI applies:
--   anon REST: vehicle_images?id=in.(<the 21>) returns 0 rows.
--   select active from cron.job where jobid = 478;   -- false
-- Reversal: select set_image_sensitivity(array[...], false, null, '<reason>', <actor>);
--           select cron.alter_job(job_id := 478, active := true);

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.set_image_sensitivity(
  p_image_ids UUID[],
  p_sensitive BOOLEAN,
  p_sensitive_type TEXT,
  p_reason TEXT,
  p_actor_user_id UUID
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF p_image_ids IS NULL OR cardinality(p_image_ids) = 0 THEN
    RAISE EXCEPTION 'set_image_sensitivity: no image ids';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'set_image_sensitivity: a reason is required';
  END IF;
  -- ALLOW_RAW_TESTIMONY_WRITE: privacy flag only (see header).
  UPDATE vehicle_images
     SET is_sensitive     = p_sensitive,
         sensitive_type   = CASE WHEN p_sensitive THEN COALESCE(p_sensitive_type, sensitive_type) ELSE NULL END,
         redaction_reason = p_reason,
         redacted_by      = p_actor_user_id,
         redacted_at      = NOW()
   WHERE id = ANY(p_image_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_n, 'requested', cardinality(p_image_ids), 'sensitive', p_sensitive);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_image_sensitivity(UUID[], BOOLEAN, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_image_sensitivity(UUID[], BOOLEAN, TEXT, TEXT, UUID) TO service_role;
COMMENT ON FUNCTION public.set_image_sensitivity(UUID[], BOOLEAN, TEXT, TEXT, UUID) IS
  'Sanctioned writer for the owner privacy flag on vehicle_images: sets is_sensitive/sensitive_type and records redaction who/when/why. Added 2026-09-28 for the photo-sync privacy containment.';

SELECT public.set_image_sensitivity(
  ARRAY[
    'bda76b2d-b2c4-405c-9c0c-bf2604abd833',
    'adf4743d-806b-4376-91ac-cece7b54b7da',
    'dd903416-a208-49ab-a9a4-ae42c49c0ee0',
    '6ac7746c-9e1a-4d06-a9d7-4c585d1d3ca2',
    '58f9e121-a047-48d0-b49a-91c374be72ab',
    '0bdbd4e2-52a7-4f3c-8740-93b28eb23961',
    'abcbaf3b-9d44-4174-ab26-b417b9b5e195',
    '13d6c832-bedc-455b-8586-8332ab44d3ca',
    '9345189c-5c22-4b99-8574-ff55cc6a93b4',
    '78e5f623-0c46-42e5-81c9-b2586d717166',
    '81e26a75-72dd-424b-bcea-fd8dcab62731',
    'db5376c4-89c1-421a-a4be-fd5912893450',
    '853b0c35-3921-42b6-bcaa-3f04bb034fdb',
    'e492e3cd-1be1-4cdf-8888-0d5fb9be554e',
    'e8ba9a6c-c91f-4127-877b-bac6129f8fe4',
    '5da02552-463c-41b5-8e5c-6a575ffcd1dd',
    '6c43c121-5773-4d65-90e4-dc93a21a4a3a',
    'a3720cfa-06c3-43e8-bf55-47e497c4e6e7',
    'b3563d8b-2206-4220-9ba3-90d236f1fa83',
    '1c421164-3b66-4b8f-a808-323eaa68125d',
    '47362218-3e7f-4a10-b1f1-471cb1c598ec'
  ]::uuid[],
  true,
  'personal',
  'privacy containment 2026-09-28: photo-sync upload filed by GPS (cron 478) onto a car the owner no longer had; child/bed/people/document labels',
  '0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid
);

SELECT cron.alter_job(job_id := 478, active := false);
