-- Coverage log for listings handed to the advisor (evaluate_listing): hit = the URL is already a Nuke vehicle,
-- miss = not ingested; misses are queued in import_queue so coverage gaps are measurable and closed.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.listing_coverage_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool          text NOT NULL,
  url           text NOT NULL,
  hit           boolean NOT NULL,
  vehicle_id    uuid,
  match_method  text,
  queued        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_coverage_log_created_idx ON public.listing_coverage_log (created_at);
ALTER TABLE public.listing_coverage_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.log_listing_coverage(p_tool text, p_url text, p_vehicle_id uuid, p_match_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '5s' AS $$
DECLARE v_queued boolean := false; v_url text := btrim(p_url);
BEGIN
  IF v_url !~* '^https?://' THEN RETURN jsonb_build_object('success', false, 'error', 'url'); END IF;
  IF p_vehicle_id IS NULL THEN
    INSERT INTO import_queue (listing_url, status, raw_data)
    VALUES (v_url, 'pending', jsonb_build_object('origin', p_tool, 'queued_reason', 'coverage_miss'))
    ON CONFLICT DO NOTHING;
    v_queued := FOUND;
  END IF;
  INSERT INTO listing_coverage_log (tool, url, hit, vehicle_id, match_method, queued)
  VALUES (p_tool, v_url, p_vehicle_id IS NOT NULL, p_vehicle_id, p_match_method, v_queued);
  RETURN jsonb_build_object('success', true, 'hit', p_vehicle_id IS NOT NULL, 'queued', v_queued);
END $$;
REVOKE ALL ON FUNCTION public.log_listing_coverage(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_listing_coverage(text, text, uuid, text) TO service_role;
