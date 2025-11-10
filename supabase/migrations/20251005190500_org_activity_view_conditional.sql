BEGIN;

-- Create organization_activity_view conditionally using vehicle_timeline_events if it exists,
-- otherwise fall back to shop_licenses-only view. Idempotent.

DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('v','m') -- view or materialized view
      AND n.nspname = 'public'
      AND c.relname = 'vehicle_timeline_events'
  ) INTO v_exists;

  -- Drop existing view to replace
  EXECUTE 'DROP VIEW IF EXISTS public.organization_activity_view';

  IF v_exists THEN
    EXECUTE $create_view$
      CREATE VIEW public.organization_activity_view AS
      WITH vehicle_events AS (
        SELECT 
          v.owner_shop_id         AS org_id,
          e.id                    AS event_id,
          e.event_type            AS event_type,
          COALESCE(e.title, e.event_type) AS title,
          e.description           AS description,
          e.event_date::timestamptz   AS event_date,
          e.created_at            AS created_at,
          e.vehicle_id            AS vehicle_id,
          'vehicle_timeline_events'::text AS source_table,
          e.metadata              AS metadata
        FROM public.vehicle_timeline_events e
        JOIN public.vehicles v ON v.id = e.vehicle_id
        WHERE v.owner_shop_id IS NOT NULL
      ),
      license_events AS (
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
        FROM public.shop_licenses l
      )
      SELECT * FROM vehicle_events
      UNION ALL
      SELECT * FROM license_events;
    $create_view$;
  ELSE
    EXECUTE $create_view$
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
    $create_view$;
  END IF;
END $$;

COMMIT;
