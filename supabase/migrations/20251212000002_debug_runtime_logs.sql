-- Debug Runtime Logs (production-safe)
-- Stores runtime evidence from edge functions when localhost ingest is not reachable.
-- SECURITY: service-role only.

CREATE TABLE IF NOT EXISTS public.debug_runtime_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'edge_function',
  run_id TEXT,
  hypothesis_id TEXT,
  location TEXT,
  message TEXT,
  data JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_debug_runtime_logs_created_at ON public.debug_runtime_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debug_runtime_logs_run_id ON public.debug_runtime_logs(run_id) WHERE run_id IS NOT NULL;

ALTER TABLE public.debug_runtime_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Read/write only for service_role
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'debug_runtime_logs'
      AND policyname = 'debug_runtime_logs_service_role_only'
  ) THEN
    CREATE POLICY debug_runtime_logs_service_role_only
      ON public.debug_runtime_logs
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;


