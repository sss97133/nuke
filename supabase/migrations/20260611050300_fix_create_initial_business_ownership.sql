-- FIX: authenticated org creation has been broken platform-wide.
--
-- create_initial_business_ownership() (AFTER INSERT trigger on
-- public.organizations) was hardened with SET search_path TO '' but left the
-- INSERT target unqualified — with an empty search_path, `business_ownership`
-- can never resolve, so EVERY insert into organizations by an authenticated
-- user (CreateOrganization.tsx / RestorationIntake.tsx via the businesses
-- view) failed with 42P01 'relation "business_ownership" does not exist'.
-- Service-role inserts survived only because the function skips its body
-- when auth.uid() IS NULL.
--
-- Discovered 2026-06-11 while witnessing the org-creation path for the
-- contributor self-grant fix. Fix: schema-qualify the table.

CREATE OR REPLACE FUNCTION public.create_initial_business_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    -- Only create ownership if there's an authenticated user (not service role)
    -- Service role inserts (like from edge functions) won't have auth.uid()
    IF auth.uid() IS NOT NULL THEN
        INSERT INTO public.business_ownership (
            business_id,
            owner_id,
            ownership_percentage,
            ownership_type,
            ownership_title,
            acquisition_date
        ) VALUES (
            NEW.id,
            auth.uid(),
            100.00,
            'founder',
            'Founder/Owner',
            CURRENT_DATE
        )
        ON CONFLICT (business_id, owner_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$function$;
