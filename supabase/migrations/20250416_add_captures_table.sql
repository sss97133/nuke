-- Create the captures table for VehiDex vehicle data extraction
CREATE TABLE IF NOT EXISTS public.captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text,
  html text,
  images jsonb,
  user_id text,
  captured_at timestamptz DEFAULT now(),
  meta jsonb
);

-- Add table comment
COMMENT ON TABLE public.captures IS 'Stores vehicle listings captured from various websites using the VehiDex extension';

-- Grant appropriate permissions
GRANT ALL ON TABLE public.captures TO anon;
GRANT ALL ON TABLE public.captures TO authenticated;
GRANT ALL ON TABLE public.captures TO service_role;
