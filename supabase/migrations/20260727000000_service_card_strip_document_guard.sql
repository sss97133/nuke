-- Public service-card strip: never render a document, never render the same
-- moment twice.
--
-- Found by LOOKING at the rendered grid 2026-07-27. The 1980 Chevrolet C10 card
-- on Ernies Upholstery'''s PUBLIC profile was displaying a California Certificate
-- of Title — legible name, street address, title number — and the 1976 C20 and
-- 1978 K20 LWB cards were showing dealer purchase forms.
--
-- The signal to stop it already existed and nothing read it. That title frame
-- carries apple_ml_labels = {Document,Handwriting} from Apple'''s on-device pass
-- while is_document is false. Across the 365 frames the 45 strips draw from:
-- is_document true on 1, doc_flag on 0, document_classification on 0,
-- is_sensitive on 0 — the document gate never ran on this corpus — but 10 carry
-- an apple Document label.
--
-- Dedup is part of the same fix, not a separate nicety. Every frame is ingested
-- twice, once from '''iphoto''' (which carries the ML labels) and once from
-- '''ssd_blast''' (which carries none), taken_at identical to the millisecond:
-- 365 strip frames resolve to only 299 distinct (vehicle, taken_at) moments.
-- Filtering on the label alone would drop the labelled copy of the title and
-- leave its unlabelled twin on the page. So the document test is applied per
-- MOMENT (bool_or over the taken_at partition) and the moment is then collapsed
-- to one frame — which also ends the near-identical runs where a card showed
-- six shots of the same object.
--
-- The same guard is applied to primary_image_url, so a document cannot become a
-- vehicle'''s hero image either.
--
-- Only the DISPLAYED strip is filtered. photo_count still counts every dated
-- frame on file, because that is what the archive holds and the card says
-- "dated frames on file for this vehicle".
--
-- MEASURED after apply (anon, org e796ca48): 62 rows, 1.5-2.4s warm (up from
-- ~1.0s — the window function is the cost), 266 strip urls of which 266 are
-- unique (was 365 with 66 duplicate slots), photo_count unchanged at 28,792.
-- Verified by re-rendering the four offending cards: no document remains, and
-- the 1980 C10 strip is now its bench seat, door panel and dashboard.

CREATE OR REPLACE FUNCTION public.get_service_vehicles_for_org(p_organization_id uuid)
 RETURNS TABLE(vehicle_id uuid, vehicle_info jsonb, receipts jsonb, total_investment numeric, total_days integer, total_labor_hours numeric, job_count bigint, current_status text, primary_image_url text, photo_count bigint, first_photo_at timestamp with time zone, last_photo_at timestamp with time zone, recent_image_urls text[], work_types text[])
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH service_vehicles AS (
    SELECT DISTINCT ov.vehicle_id
    FROM organization_vehicles ov
    WHERE ov.organization_id = p_organization_id
      AND ov.relationship_type IN ('service_provider', 'work_location')
      AND ov.status = 'active'
  ),
  vehicle_events AS (
    SELECT
      te.vehicle_id,
      te.id         AS event_id,
      te.event_date,
      te.title,
      COALESCE(
        NULLIF(
          CASE WHEN te.metadata->>'duration_hours' ~ '^[+-]?[0-9]*\.?[0-9]+$'
               THEN (te.metadata->>'duration_hours')::numeric
          END, 0),
        NULLIF(te.duration_hours, 0),
        te.labor_hours,
        0
      ) AS duration_hours,
      CASE WHEN te.metadata->>'image_count' ~ '^[0-9]+(\.[0-9]+)?$'
           THEN floor((te.metadata->>'image_count')::numeric)::integer
           ELSE COALESCE(array_length(te.image_urls, 1), 0)
      END AS image_count
    FROM timeline_events te
    JOIN service_vehicles sv ON sv.vehicle_id = te.vehicle_id
    WHERE te.organization_id = p_organization_id
  ),
  event_rollup AS (
    SELECT
      ve.vehicle_id,
      jsonb_agg(
        jsonb_build_object(
          'id',                  ve.event_id,
          'date',                ve.event_date,
          'title',               ve.title,
          'work_description',    ve.title,
          'duration_hours',      ve.duration_hours,
          'labor_hours',         ve.duration_hours,
          'hours_are_estimated', true,
          'image_count',         ve.image_count
        )
        ORDER BY ve.event_date DESC, ve.event_id DESC
      )                            AS receipts,
      COUNT(*)                     AS job_count,
      SUM(ve.duration_hours)       AS total_labor_hours,
      MIN(ve.event_date)           AS first_event_date,
      MAX(ve.event_date)           AS last_event_date,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN bool_or(ve.title ILIKE '%paint%')      THEN 'Paint'      END,
        CASE WHEN bool_or(ve.title ILIKE '%body%')       THEN 'Body Work'  END,
        CASE WHEN bool_or(ve.title ILIKE '%interior%')   THEN 'Interior'   END,
        CASE WHEN bool_or(ve.title ILIKE '%engine%')     THEN 'Mechanical' END,
        CASE WHEN bool_or(ve.title ILIKE '%upholster%')  THEN 'Upholstery' END
      ]::text[], NULL::text)       AS work_types
    FROM vehicle_events ve
    GROUP BY ve.vehicle_id
  )
  SELECT
    v.id,
    jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model, 'vin', v.vin),
    COALESCE(er.receipts, '[]'::jsonb),
    NULL::numeric,
    COALESCE((er.last_event_date - er.first_event_date), 0),
    COALESCE(er.total_labor_hours, 0)::numeric,
    COALESCE(er.job_count, 0)::bigint,
    CASE
      WHEN er.job_count IS NULL OR er.job_count = 0               THEN 'pending'
      WHEN er.last_event_date > CURRENT_DATE - INTERVAL '30 days' THEN 'in_progress'
      ELSE 'on_hold'
    END,
    pri.image_url,
    COALESCE(ph.photo_count, 0)::bigint,
    ph.first_photo_at,
    ph.last_photo_at,
    COALESCE(rec.recent_image_urls, '{}'::text[]),
    COALESCE(er.work_types, '{}'::text[])
  FROM service_vehicles sv
  JOIN vehicles v ON v.id = sv.vehicle_id
  LEFT JOIN event_rollup er ON er.vehicle_id = v.id
  -- hero image: same document + duplicate guard as the strip
  LEFT JOIN LATERAL (
    SELECT m.image_url
    FROM (
      SELECT vi.image_url, vi.taken_at, vi.created_at, vi.id,
             bool_or(
               COALESCE(vi.is_document, false) OR COALESCE(vi.doc_flag, false)
               OR vi.apple_ml_labels && ARRAY['Document','Handwriting','Receipt','Text','Paperwork','Menu']::text[]
             ) OVER (PARTITION BY vi.taken_at) AS moment_is_document
      FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id
    ) m
    WHERE NOT m.moment_is_document
    ORDER BY m.taken_at DESC NULLS LAST, m.created_at DESC, m.id DESC
    LIMIT 1
  ) pri ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)         AS photo_count,
           MIN(vi.taken_at) AS first_photo_at,
           MAX(vi.taken_at) AS last_photo_at
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id AND vi.taken_at IS NOT NULL
  ) ph ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(s.url ORDER BY s.taken_at DESC, s.id DESC) AS recent_image_urls
    FROM (
      SELECT DISTINCT ON (m.taken_at) m.url, m.taken_at, m.id
      FROM (
        SELECT COALESCE(NULLIF(vi.thumbnail_url, ''), vi.image_url) AS url,
               vi.taken_at, vi.id,
               bool_or(
                 COALESCE(vi.is_document, false) OR COALESCE(vi.doc_flag, false)
                 OR vi.apple_ml_labels && ARRAY['Document','Handwriting','Receipt','Text','Paperwork','Menu']::text[]
               ) OVER (PARTITION BY vi.taken_at) AS moment_is_document
        FROM vehicle_images vi
        WHERE vi.vehicle_id = v.id AND vi.taken_at IS NOT NULL
      ) m
      WHERE NOT m.moment_is_document
      ORDER BY m.taken_at DESC, m.id DESC
      LIMIT 6
    ) s
  ) rec ON TRUE;
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.get_service_vehicles_for_org(uuid) TO anon, authenticated, service_role;
