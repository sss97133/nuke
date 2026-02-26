-- =============================================================================
-- Transfer Automation Framework
-- =============================================================================
-- Adds:
--   1. Missing columns to transfer_communications for AI classification
--   2. DB trigger: auto-create ownership_transfer when auction_events.outcome = 'sold'
--   3. DB trigger: upgrade ghost shell → real user when identity is claimed
--   4. Cron: staleness sweep every 4h
--   5. pg_net-based async calls to edge functions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend transfer_communications with AI classification fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.transfer_communications
  ADD COLUMN IF NOT EXISTS milestone_type_inferred text,
  ADD COLUMN IF NOT EXISTS ai_classification_confidence integer,
  ADD COLUMN IF NOT EXISTS has_attachments boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_names text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS raw_metadata jsonb;

-- Add 'document' to communication_source enum if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'communication_source' AND e.enumlabel = 'document'
  ) THEN
    ALTER TYPE communication_source ADD VALUE 'document';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. DB trigger: auto-create ownership transfer on auction close
--
-- Fires when auction_events.outcome changes to 'sold'.
-- Calls transfer-automator via pg_net (async, non-blocking).
-- Idempotent — transfer-automator checks for existing transfer first.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_create_transfer_on_auction_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Only fire when outcome becomes 'sold'
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN
    RETURN NEW;
  END IF;
  IF OLD.outcome = 'sold' THEN
    RETURN NEW; -- Already processed
  END IF;

  -- Get service role key
  v_key := COALESCE(
    (SELECT value FROM public._app_secrets WHERE key = 'service_role_key' LIMIT 1),
    current_setting('app.settings.service_role_key', true),
    current_setting('app.service_role_key', true)
  );

  v_url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator';

  -- Fire async via pg_net (non-blocking — won't fail the auction_events update)
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_key, '')
      ),
      body := jsonb_build_object(
        'action', 'seed_from_auction',
        'auction_event_id', NEW.id::text
      ),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    -- pg_net unavailable — log but don't block the update
    RAISE WARNING '[auto_create_transfer] pg_net call failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_transfer_on_auction_close ON public.auction_events;
CREATE TRIGGER trg_auto_create_transfer_on_auction_close
  AFTER INSERT OR UPDATE OF outcome
  ON public.auction_events
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_transfer_on_auction_close();

-- ---------------------------------------------------------------------------
-- 3. DB trigger: upgrade ghost shell when external identity is claimed
--
-- When external_identities.claimed_by_user_id is set (NULL → non-NULL),
-- find all ownership_transfers where that identity is a party and set
-- the corresponding user_id column.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upgrade_transfers_on_identity_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only fire when claimed_by_user_id goes from NULL to a real value
  IF NEW.claimed_by_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.claimed_by_user_id IS NOT NULL THEN
    RETURN NEW; -- Already claimed, nothing to upgrade
  END IF;

  -- Upgrade as buyer (to_identity_id)
  UPDATE public.ownership_transfers
  SET to_user_id = NEW.claimed_by_user_id,
      updated_at = NOW()
  WHERE to_identity_id = NEW.id
    AND to_user_id IS NULL;

  -- Upgrade as seller (from_identity_id)
  UPDATE public.ownership_transfers
  SET from_user_id = NEW.claimed_by_user_id,
      updated_at = NOW()
  WHERE from_identity_id = NEW.id
    AND from_user_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upgrade_transfers_on_identity_claim ON public.external_identities;
CREATE TRIGGER trg_upgrade_transfers_on_identity_claim
  AFTER UPDATE OF claimed_by_user_id
  ON public.external_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.upgrade_transfers_on_identity_claim();

-- ---------------------------------------------------------------------------
-- 4. Overdue milestone updater (DB-native, no edge function needed)
--
-- A function that can be called by cron OR by the edge function.
-- Marks milestones overdue and transfers stalled without needing an HTTP call.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transfer_staleness_sweep(
  stale_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_overdue_count integer := 0;
  v_stalled_count integer := 0;
  v_stale_cutoff timestamptz;
BEGIN
  v_stale_cutoff := NOW() - (stale_days || ' days')::interval;

  -- Mark milestones overdue where deadline has passed and not yet done
  WITH updated AS (
    UPDATE public.transfer_milestones
    SET status = 'overdue', updated_at = NOW()
    WHERE deadline_at < NOW()
      AND status IN ('pending', 'in_progress')
    RETURNING id
  )
  SELECT count(*) INTO v_overdue_count FROM updated;

  -- Mark transfers stalled when no milestone activity for stale_days
  WITH updated AS (
    UPDATE public.ownership_transfers
    SET status = 'stalled',
        stalled_at = NOW(),
        updated_at = NOW()
    WHERE status = 'in_progress'
      AND (
        last_milestone_at IS NULL AND created_at < v_stale_cutoff
        OR last_milestone_at < v_stale_cutoff
      )
    RETURNING id
  )
  SELECT count(*) INTO v_stalled_count FROM updated;

  RETURN jsonb_build_object(
    'overdue_milestones', v_overdue_count,
    'stalled_transfers', v_stalled_count,
    'sweep_at', NOW(),
    'stale_days', stale_days
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Cron: run staleness sweep every 4 hours
-- ---------------------------------------------------------------------------

SELECT cron.schedule(
  'transfer-staleness-sweep',
  '0 */4 * * *',  -- every 4 hours
  $$SELECT public.transfer_staleness_sweep(14)$$
);

-- ---------------------------------------------------------------------------
-- 6. Cron: backfill transfers for already-sold auctions (one-time catch-up)
--
-- Finds auction_events with outcome='sold' that have no ownership_transfer.
-- Calls transfer-automator for each in batches. Runs once, then self-disables.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.backfill_transfers_for_sold_auctions(
  batch_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row record;
  v_key text;
  v_url text := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator';
  v_count integer := 0;
BEGIN
  v_key := COALESCE(
    (SELECT value FROM public._app_secrets WHERE key = 'service_role_key' LIMIT 1),
    current_setting('app.settings.service_role_key', true),
    current_setting('app.service_role_key', true)
  );

  -- Find sold auctions that have no transfer yet
  FOR v_row IN
    SELECT ae.id, ae.vehicle_id
    FROM public.auction_events ae
    WHERE ae.outcome = 'sold'
      AND NOT EXISTS (
        SELECT 1 FROM public.ownership_transfers ot
        WHERE ot.trigger_id = ae.id
          AND ot.trigger_table = 'auction_events'
      )
    ORDER BY ae.auction_end_date DESC
    LIMIT batch_size
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(v_key, '')
        ),
        body := jsonb_build_object(
          'action', 'seed_from_auction',
          'auction_event_id', v_row.id::text
        ),
        timeout_milliseconds := 30000
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[backfill_transfers] pg_net call failed for %: %', v_row.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'queued', v_count,
    'ran_at', NOW()
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Add pipeline_registry entries for new automation functions
-- ---------------------------------------------------------------------------

INSERT INTO public.pipeline_registry (
  table_name, column_name, owned_by, description, do_not_write_directly, write_via, created_at
)
VALUES
  ('ownership_transfers', 'status',           'transfer-automator', 'Transfer lifecycle status. Auto-managed by trigger/edge fn.', true, 'transfer-automator or transfer_staleness_sweep()', NOW()),
  ('ownership_transfers', 'last_milestone_at','transfer_milestone_completed trigger', 'Auto-updated by DB trigger on transfer_milestones insert/update.', true, NULL, NOW()),
  ('transfer_milestones', 'status',           'transfer-automator, transfer-advance', 'Milestone lifecycle. Auto-managed by edge functions.', true, 'transfer-advance (advance_manual) or transfer_staleness_sweep()', NOW()),
  ('transfer_communications', 'milestone_type_inferred', 'transfer-advance', 'AI-inferred milestone type from signal classification.', true, 'transfer-advance (ingest_signal)', NOW())
ON CONFLICT DO NOTHING;
