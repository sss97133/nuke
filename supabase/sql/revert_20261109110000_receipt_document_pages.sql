-- Revert of 20261109110000_receipt_document_pages.sql. Drops the two new functions and restores
-- get_vehicle_contribution_days to its 20260610150000 body. The three receipt_items columns stay (additive; rows may
-- carry them); drop them by hand only after the receipts that use them are superseded.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.land_document_pages(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.get_vehicle_day_documents(uuid, date);

CREATE OR REPLACE FUNCTION public.get_vehicle_contribution_days(p_vehicle_id uuid)
RETURNS TABLE(day date, kind text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT vi.taken_at::date AS day, 'photo'::text AS kind, count(*)::int AS n
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND vi.taken_at IS NOT NULL
    AND vi.taken_at >= '2000-01-01'
    AND COALESCE(vi.is_duplicate, false) = false
  GROUP BY 1
  UNION ALL
  SELECT ws.session_date, 'work', count(*)::int
  FROM work_sessions ws
  WHERE ws.vehicle_id = p_vehicle_id AND ws.session_date >= '2000-01-01'
  GROUP BY 1
  UNION ALL
  SELECT vte.event_date, 'event', count(*)::int
  FROM vehicle_timeline_events vte
  WHERE vte.vehicle_id = p_vehicle_id AND vte.event_date >= '2000-01-01'
  GROUP BY 1;
$$;
