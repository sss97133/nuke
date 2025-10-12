BEGIN;

-- Fallback organization activity view using only shop_licenses
DROP VIEW IF EXISTS public.organization_activity_view;

CREATE VIEW public.organization_activity_view AS
SELECT 
  l.shop_id               AS org_id,
  l.id                    AS event_id,
  'license_added'         AS event_type,
  CONCAT('License added: ', REPLACE(l.license_type,'_',' ')) AS title,
  CONCAT('License #', l.license_number, COALESCE(CONCAT(' (', l.issuing_authority, ')'), '')) AS description,
  COALESCE(l.issued_date::timestamptz, l.created_at) AS event_date,
  l.created_at            AS created_at,
  NULL::uuid              AS vehicle_id,
  'shop_licenses'::text   AS source_table,
  jsonb_build_object(
    'license_type', l.license_type,
    'license_number', l.license_number,
    'issuing_authority', l.issuing_authority,
    'issued_date', l.issued_date,
    'expiration_date', l.expiration_date
  ) AS metadata
FROM public.shop_licenses l;

COMMIT;
