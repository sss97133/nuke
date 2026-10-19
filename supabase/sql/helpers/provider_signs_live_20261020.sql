-- Live shapes read by 20261020031000_provider_availability_area.sql (subset; synthetic fixtures only).
CREATE TYPE public.user_observation_kind AS ENUM ('vendor_preference','tool_owned','scene_observation','presence','availability','capacity');
CREATE TABLE public.user_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.user_observation_kind NOT NULL, observed_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL,
  source_identifier text, method text NOT NULL, trust text NOT NULL CHECK (trust = ANY (ARRAY['T1','T2','T3','T4'])), confidence_score numeric,
  content_text text, content_hash text, structured_data jsonb NOT NULL DEFAULT '{}'::jsonb, is_superseded boolean DEFAULT false,
  superseded_by uuid REFERENCES public.user_observations(id), superseded_at timestamptz, visibility text[] NOT NULL DEFAULT ARRAY['owner'],
  CONSTRAINT user_observations_source_check CHECK (source = ANY (ARRAY['qb_transactions','apple_cash','apple_mail','receipt_ocr','imessage',
    'photos_metadata','photo_pipeline_byok_deep_analysis','manual'])));
ALTER TABLE public.user_observations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.user_observations TO anon, authenticated;
CREATE TABLE IF NOT EXISTS public.city_geocode_lookup(city text NOT NULL, state text NOT NULL, latitude numeric NOT NULL, longitude numeric NOT NULL,
  sample_size integer, source text, PRIMARY KEY (city, state));
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS scheduled_start timestamptz, ADD COLUMN IF NOT EXISTS scheduled_end timestamptz;
