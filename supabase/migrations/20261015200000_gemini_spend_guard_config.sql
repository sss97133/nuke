-- Daily cap for Gemini calls, read by supabase/functions/_shared/geminiGuard.ts.
-- Calls are counted in llm_cost_tracking (provider 'google', one row per call, date = the UTC day).
-- daily_cap: calls per UTC day, across every function. paused: refuse all Gemini calls.
-- Change the cap with: UPDATE platform_config SET config_value = jsonb_set(config_value, '{daily_cap}', '2000') WHERE config_key = 'gemini_spend_guard';
SET statement_timeout = '15s';
SET lock_timeout = '5s';

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('gemini_spend_guard', '{"daily_cap": 500, "paused": false}'::jsonb,
        'Gemini calls per UTC day (counted in llm_cost_tracking, provider google) and a pause switch; read by _shared/geminiGuard.ts')
ON CONFLICT (config_key) DO NOTHING;
