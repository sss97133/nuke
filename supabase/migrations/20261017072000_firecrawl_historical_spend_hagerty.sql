-- Historical spend and a Hagerty source (2026-10-15, owner-lead).
--  1. firecrawl_record_spend takes p_historical. Spend made before the allowance rule existed (or before a source had an
--     allocation) is logged historical: it counts toward the source's observed return (credits in the weekly job) but not
--     against the current period's allowance, so logging it does not zero a lane.
--  2. A 'hagerty' source row. Its extractor has a Firecrawl fallback and is gated on firecrawl_allowance('hagerty'); it is scored
--     like the others and receives 0 until it ranks.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.firecrawl_spend_log ADD COLUMN IF NOT EXISTS historical boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.firecrawl_spend_log.historical IS 'Spend made before the allowance rule or before an allocation: counts toward the observed return, not against the period allowance.';

DROP FUNCTION IF EXISTS public.firecrawl_record_spend(text, numeric, integer, text, text);
CREATE OR REPLACE FUNCTION public.firecrawl_record_spend(p_source text, p_credits numeric, p_lots integer DEFAULT 0,
                                                         p_lane text DEFAULT NULL, p_note text DEFAULT NULL,
                                                         p_historical boolean DEFAULT false)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  INSERT INTO public.firecrawl_spend_log (source, credits, lots, lane, note, historical)
  VALUES (p_source, p_credits, coalesce(p_lots, 0), p_lane, p_note, coalesce(p_historical, false)) RETURNING id
$$;

CREATE OR REPLACE FUNCTION public.firecrawl_allowance(p_source text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_day int := firecrawl_param('period_start_day', 4)::int;
  v_start date;
  v_end date;
  v_alloc numeric;
  v_spent_before numeric;
  v_spent_today numeric;
  v_days_left int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.firecrawl_source_params WHERE source = p_source AND paused IS NOT NULL) THEN RETURN 0; END IF;
  v_start := CASE WHEN extract(day FROM current_date) >= v_day
                  THEN make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day)
                  ELSE (make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day) - interval '1 month')::date END;
  v_end := (v_start + interval '1 month')::date;
  SELECT a.monthly_credits INTO v_alloc
    FROM public.firecrawl_target_allocation a
   WHERE a.source = p_source AND a.vehicle_group = '*'
     AND a.computed_at = (SELECT max(computed_at) FROM public.firecrawl_target_allocation)
   LIMIT 1;
  IF v_alloc IS NULL OR v_alloc <= 0 THEN RETURN 0; END IF;
  SELECT coalesce(sum(credits) FILTER (WHERE spent_at < current_date), 0), coalesce(sum(credits) FILTER (WHERE spent_at >= current_date), 0)
    INTO v_spent_before, v_spent_today FROM public.firecrawl_spend_log WHERE source = p_source AND spent_at >= v_start AND NOT historical;
  v_days_left := greatest(1, v_end - current_date);
  RETURN greatest(0, least(v_alloc - v_spent_before - v_spent_today, ceil((v_alloc - v_spent_before) / v_days_left) - v_spent_today));
END $$;

INSERT INTO public.firecrawl_source_params
  (source, firecrawl_dependent, credits_per_lot, cost_basis, supply_kind, vehicles_source, event_platforms, observed_on, snapshot_platforms) VALUES
 ('hagerty', true, 1, 'one scrape per page through the extractor''s Firecrawl fallback (daily-capture-master, 2026-10-15)', 'both',
  '{hagerty}', '{hagerty}', '2026-10-15', '{hagerty}')
ON CONFLICT (source) DO NOTHING;

REVOKE ALL ON FUNCTION public.firecrawl_record_spend(text, numeric, integer, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_allowance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_record_spend(text, numeric, integer, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_allowance(text) TO service_role;
COMMIT;
