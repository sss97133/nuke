-- Restore the existing anonymous/signed-in USD price contract without opening
-- the private price-review tables or making the whole price reader a definer.
-- 2026-10-25 logged-out probes: all vehicle pages returned 42501 / HTTP 401.
-- sale_price_usd was added after the explicit public column allowlist; the
-- invoker trust guard also acquired private marks and RLS-hidden writer trust.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.vehicle_price_facts(uuid[])'::regprocedure))
       NOT IN ('eb2c72355cb96c6b7f1604031581c13b', '79edfb9a5b8d27fd28c3ae31ae85e1ec') -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
     OR md5(pg_get_functiondef('public.vehicle_sale_price_untrusted(uuid,numeric)'::regprocedure))
       <> 'c86d59bd086f693f201e7d6f2dc4d863' -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
     OR md5(pg_get_functiondef('public.vehicle_event_low_trust(uuid)'::regprocedure))
       NOT IN ('f643520d00beac7d7259ba949d69eda3', 'ed0b8b131b5103bd576be321d1f3f57d') THEN -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
    RAISE EXCEPTION 'Public price reader or trust guard differs from reviewed live preimage';
  END IF;
END $guard$;

-- This is the USD representation already selected for public price_amount and
-- sold_amount, not the owner's purchase price. Row policies still bound it.
GRANT SELECT (sale_price_usd) ON public.vehicles TO anon, authenticated;

-- The nested invoker helper must not resolve an attacker-created temp table
-- while executing inside the narrow definer below. Keep its body unchanged.
ALTER FUNCTION public.vehicle_event_low_trust(uuid)
  SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION public.vehicle_sale_price_untrusted_read(p_vehicle_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  current_price numeric;
  viewer uuid := auth.uid();
BEGIN
  -- Same public/private-owner predicates as vehicles SELECT policies, plus
  -- the deleted-row exclusion already enforced by vehicle_price_facts.
  SELECT v.sale_price INTO current_price
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR auth.role() = 'service_role'
      OR (v.is_public IS FALSE AND viewer IS NOT NULL
        AND (viewer = v.user_id OR viewer = v.owner_id OR viewer = v.uploaded_by
          OR public.vehicle_user_has_access(v.id, viewer))));
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Only the current public/authorized price can be tested. No arbitrary
  -- historical amount, mark reason, run, citation or private row is returned.
  RETURN public.vehicle_sale_price_untrusted(p_vehicle_id, current_price);
END;
$function$;
REVOKE ALL ON FUNCTION public.vehicle_sale_price_untrusted_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_sale_price_untrusted_read(uuid)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_sale_price_untrusted_read(uuid) IS
  'Trust boolean for the current sale price of a caller-visible, undeleted vehicle. NULL for hidden/missing/deleted IDs. Private review rows stay private; canonical guard semantics are unchanged.';

DO $reader$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.vehicle_price_facts(uuid[])'::regprocedure) INTO definition;
  -- CREATE OR REPLACE retains its owner, ACL, comment, signature, invoker
  -- security and all twenty result fields; replace only the guard call.
  IF md5(definition) = 'eb2c72355cb96c6b7f1604031581c13b' THEN -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
    EXECUTE replace(definition,
      'public.vehicle_sale_price_untrusted(v.id, v.sale_price)',
      'public.vehicle_sale_price_untrusted_read(v.id)');
  END IF;
END $reader$;

COMMIT;
