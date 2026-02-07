-- Universal URL Inbox with auto-processing trigger
-- Any URL from any source (Telegram, web app, API, Slack, etc.) gets auto-processed

-- ============================================================================
-- 1. URL INBOX TABLE - source-agnostic, no auth.users FK
-- ============================================================================

CREATE TABLE IF NOT EXISTS url_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',  -- telegram, web_app, api, slack, etc.
  source_user_id TEXT,                      -- telegram:123, email:foo@bar.com, etc.
  note TEXT,                                -- any context the user provided
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result JSONB DEFAULT '{}'::jsonb,         -- process-url-drop response
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_url_inbox_status ON url_inbox(status);
CREATE INDEX IF NOT EXISTS idx_url_inbox_source ON url_inbox(source);
CREATE INDEX IF NOT EXISTS idx_url_inbox_created ON url_inbox(created_at DESC);

COMMENT ON TABLE url_inbox IS 'Universal URL intake - any URL from any source gets auto-processed via process-url-drop';

-- ============================================================================
-- 2. AUTO-PROCESS TRIGGER (uses vault for service role key)
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_process_url_inbox()
RETURNS TRIGGER AS $$
DECLARE
  v_service_role_key TEXT;
  v_supabase_url TEXT := 'https://qkgaybvrernstplzjaam.supabase.co';
BEGIN
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  NEW.status := 'processing';

  SELECT decrypted_secret INTO v_service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  IF v_service_role_key IS NULL THEN
    RAISE WARNING 'url_inbox trigger: service_role_key not found in vault';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/process-url-drop',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'url', NEW.url,
      'opinion', NEW.note,
      '_inbox_id', NEW.id,
      '_source', NEW.source
    )
  );

  RAISE NOTICE 'Queued URL processing for inbox item % (URL: %)', NEW.id, NEW.url;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'url_inbox trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_process_url_inbox ON url_inbox;
CREATE TRIGGER auto_process_url_inbox
  BEFORE INSERT ON url_inbox
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION trigger_process_url_inbox();

COMMENT ON FUNCTION trigger_process_url_inbox() IS 'Auto-processes URLs via process-url-drop when inserted into url_inbox. Uses vault for auth.';

-- ============================================================================
-- 3. ALSO TRIGGER ON import_queue INSERTS
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_process_import_queue_url()
RETURNS TRIGGER AS $$
DECLARE
  v_service_role_key TEXT;
  v_supabase_url TEXT := 'https://qkgaybvrernstplzjaam.supabase.co';
BEGIN
  IF NEW.status != 'pending' OR NEW.locked_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  IF v_service_role_key IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/continuous-queue-processor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'batch_size', 1,
      'single_url', NEW.listing_url
    )
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'import_queue trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_process_import_queue ON import_queue;
CREATE TRIGGER auto_process_import_queue
  AFTER INSERT ON import_queue
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION trigger_process_import_queue_url();
