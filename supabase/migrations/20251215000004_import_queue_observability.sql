-- Import queue observability helpers (fast dashboard queries)

CREATE OR REPLACE VIEW public.import_queue_stats AS
SELECT
  status,
  COUNT(*)::bigint AS count,
  MIN(created_at) AS oldest_created_at,
  MAX(created_at) AS newest_created_at,
  MIN(next_attempt_at) AS next_attempt_at_min,
  MAX(next_attempt_at) AS next_attempt_at_max
FROM public.import_queue
GROUP BY status;

-- Single-row JSON stats RPC (useful for UI + health checks)
CREATE OR REPLACE FUNCTION public.get_import_queue_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'by_status', COALESCE((
      SELECT jsonb_object_agg(status, jsonb_build_object(
        'count', count,
        'oldest_created_at', oldest_created_at,
        'newest_created_at', newest_created_at,
        'next_attempt_at_min', next_attempt_at_min,
        'next_attempt_at_max', next_attempt_at_max
      ))
      FROM public.import_queue_stats
    ), '{}'::jsonb),
    'eligible_pending', (
      SELECT COUNT(*) FROM public.import_queue
      WHERE status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ),
    'locked_processing', (
      SELECT COUNT(*) FROM public.import_queue
      WHERE status = 'processing'
        AND locked_at IS NOT NULL
    ),
    'oldest_pending', (
      SELECT MIN(created_at) FROM public.import_queue
      WHERE status = 'pending'
    )
  );
$$;

GRANT SELECT ON public.import_queue_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_import_queue_stats() TO authenticated;


