-- Create work_sessions table used by WorkSessionsPanel and WorkSessionService

CREATE TABLE IF NOT EXISTS public.work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 0,
  start_image_id uuid,
  end_image_id uuid,
  work_description text,
  session_type text NOT NULL CHECK (session_type IN ('continuous','break_detected','manual')),
  confidence_score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common filters
CREATE INDEX IF NOT EXISTS idx_work_sessions_vehicle ON public.work_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_user ON public.work_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_date ON public.work_sessions(session_date);

-- Optional: soft FKs without enforcing constraints to avoid dependency issues
-- You can add real FKs later if desired
-- ALTER TABLE public.work_sessions
--   ADD CONSTRAINT fk_work_sessions_vehicle FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;
-- ALTER TABLE public.work_sessions
--   ADD CONSTRAINT fk_work_sessions_user FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Enable RLS (policies applied in a separate migration)
ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY;
