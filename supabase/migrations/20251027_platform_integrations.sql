-- Platform integrations table (for Central Dispatch, Twilio, Stripe, etc.)
CREATE TABLE IF NOT EXISTS platform_integrations (
  integration_name TEXT PRIMARY KEY, -- central_dispatch, twilio, stripe, etc.
  status TEXT NOT NULL DEFAULT 'disconnected', -- disconnected, connected, error
  token_expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only admins can manage integrations
DO $$
DECLARE
  has_admin_table BOOLEAN := to_regclass('public.admin_users') IS NOT NULL;
  admin_check TEXT;
BEGIN
  admin_check := CASE
    WHEN has_admin_table THEN
      '(auth.role() = ''service_role'' OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND au.is_active = TRUE AND au.admin_level IN (''admin'',''super_admin'')))'
    ELSE
      '(auth.role() = ''service_role'')'
  END;

  IF to_regclass('public.platform_integrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.platform_integrations ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'platform_integrations' AND policyname = 'Service role full access on platform_integrations'
    ) THEN
      EXECUTE 'DROP POLICY "Service role full access on platform_integrations" ON public.platform_integrations';
    END IF;
    EXECUTE 'CREATE POLICY "Service role full access on platform_integrations" ON public.platform_integrations FOR ALL TO service_role USING (true) WITH CHECK (true)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'platform_integrations' AND policyname = 'Admins can view integrations'
    ) THEN
      EXECUTE 'DROP POLICY "Admins can view integrations" ON public.platform_integrations';
    END IF;
    EXECUTE format(
      'CREATE POLICY "Admins can view integrations" ON public.platform_integrations FOR SELECT TO authenticated USING (%s)',
      admin_check
    );
  ELSE
    RAISE NOTICE 'Skipping RLS for platform_integrations: table does not exist.';
  END IF;
END
$$;

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_platform_integration_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

DROP TRIGGER IF EXISTS platform_integrations_updated_at ON platform_integrations;
CREATE TRIGGER platform_integrations_updated_at
  BEFORE UPDATE ON platform_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_platform_integration_timestamp();

-- Insert initial records for tracking
DO $$
BEGIN
  IF to_regclass('public.platform_integrations') IS NULL THEN
    RAISE NOTICE 'Skipping platform_integrations seed: table does not exist.';
    RETURN;
  END IF;

  INSERT INTO public.platform_integrations (integration_name, status, metadata)
  VALUES 
    ('central_dispatch', 'disconnected', '{"test_mode": true}'::jsonb),
    ('twilio', 'connected', '{}'::jsonb),
    ('stripe', 'connected', '{}'::jsonb)
  ON CONFLICT (integration_name) DO NOTHING;
END
$$;

