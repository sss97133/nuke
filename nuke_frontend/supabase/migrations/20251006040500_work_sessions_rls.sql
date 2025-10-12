-- Work sessions RLS policies
-- Enables secure access patterns for organization owners/admins and session authors

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'work_sessions'
  ) THEN
    RAISE NOTICE 'Table public.work_sessions does not exist; skipping RLS policy creation.';
    RETURN;
  END IF;

  -- Enable RLS
  EXECUTE 'ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY';

  -- Drop existing policies if present to avoid duplicates
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'select_work_sessions_by_org_or_self' AND tablename = 'work_sessions'
  ) THEN
    EXECUTE 'DROP POLICY "select_work_sessions_by_org_or_self" ON public.work_sessions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'insert_own_work_sessions_with_membership' AND tablename = 'work_sessions'
  ) THEN
    EXECUTE 'DROP POLICY "insert_own_work_sessions_with_membership" ON public.work_sessions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'update_own_work_sessions' AND tablename = 'work_sessions'
  ) THEN
    EXECUTE 'DROP POLICY "update_own_work_sessions" ON public.work_sessions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'delete_own_work_sessions' AND tablename = 'work_sessions'
  ) THEN
    EXECUTE 'DROP POLICY "delete_own_work_sessions" ON public.work_sessions';
  END IF;

  -- SELECT: org owners/admins of the vehicle's owning shop OR session author can read
  EXECUTE $$
    CREATE POLICY "select_work_sessions_by_org_or_self" ON public.work_sessions
    FOR SELECT
    USING (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1
        FROM public.vehicles v
        JOIN public.shop_members sm ON sm.shop_id = v.owner_shop_id
        WHERE v.id = work_sessions.vehicle_id
          AND sm.user_id = auth.uid()
          AND sm.role IN ('owner','admin')
      )
    )
  $$;

  -- INSERT: author creates their own session AND is member (owner/admin/staff) of the vehicle's shop
  EXECUTE $$
    CREATE POLICY "insert_own_work_sessions_with_membership" ON public.work_sessions
    FOR INSERT
    WITH CHECK (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1
        FROM public.vehicles v
        JOIN public.shop_members sm ON sm.shop_id = v.owner_shop_id
        WHERE v.id = work_sessions.vehicle_id
          AND sm.user_id = auth.uid()
          AND sm.role IN ('owner','admin','staff')
      )
    )
  $$;

  -- UPDATE: only author can modify their sessions
  EXECUTE $$
    CREATE POLICY "update_own_work_sessions" ON public.work_sessions
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id)
  $$;

  -- DELETE: only author can delete their sessions
  EXECUTE $$
    CREATE POLICY "delete_own_work_sessions" ON public.work_sessions
    FOR DELETE
    USING (auth.uid() = user_id)
  $$;

END $$;
