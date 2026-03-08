-- =============================================================================
-- ANALYSIS ENGINE FOUNDATION
-- =============================================================================
-- Creates the 4 core tables for the Analysis Engine:
--   1. analysis_widgets      — Widget registry (config in DB, logic in edge functions)
--   2. analysis_signals      — Per-vehicle widget outputs (one active per widget per vehicle)
--   3. analysis_signal_history — Append-only audit trail
--   4. analysis_queue        — Processing queue (same lock pattern as import_queue)
--
-- Also seeds 14 widget configurations and adds pipeline_registry entries.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. analysis_widgets — Widget Registry
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analysis_widgets (
  slug                        TEXT PRIMARY KEY,
  display_name                TEXT NOT NULL,
  description                 TEXT,
  category                    TEXT NOT NULL CHECK (category IN (
                                'deal_health', 'pricing', 'market', 'presentation', 'exposure', 'timing'
                              )),

  -- Trigger configuration
  trigger_on_observation_kinds TEXT[],           -- e.g. ARRAY['bid','listing','sale_result']
  trigger_on_table_changes    TEXT[],            -- e.g. ARRAY['vehicles','nuke_estimates']
  trigger_on_cron             BOOLEAN NOT NULL DEFAULT true,

  -- Execution
  edge_function_name          TEXT,              -- if compute_mode = 'edge_function'
  compute_sql                 TEXT,              -- if compute_mode = 'inline_sql'
  compute_mode                TEXT NOT NULL DEFAULT 'edge_function'
                              CHECK (compute_mode IN ('edge_function', 'inline_sql', 'hybrid')),

  -- Output configuration
  output_type                 TEXT NOT NULL DEFAULT 'score'
                              CHECK (output_type IN ('score', 'boolean', 'label', 'range', 'composite')),
  severity_thresholds         JSONB,             -- e.g. {"warning": 30, "critical": 10}
  default_priority            INT NOT NULL DEFAULT 50,

  -- Staleness
  stale_after_hours           INT NOT NULL DEFAULT 24,

  -- Feature flags
  is_enabled                  BOOLEAN NOT NULL DEFAULT true,
  is_beta                     BOOLEAN NOT NULL DEFAULT false,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_widgets_category ON analysis_widgets(category);
CREATE INDEX IF NOT EXISTS idx_analysis_widgets_enabled ON analysis_widgets(is_enabled) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_analysis_widgets_trigger_kinds ON analysis_widgets USING gin(trigger_on_observation_kinds);

COMMENT ON TABLE analysis_widgets IS 'Widget registry for the Analysis Engine. Configuration lives here; computation logic lives in edge functions or inline SQL.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. analysis_signals — Per-Vehicle Widget Outputs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analysis_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  widget_slug       TEXT NOT NULL REFERENCES analysis_widgets(slug) ON DELETE CASCADE,

  -- Output
  score             NUMERIC(5,2),                    -- 0-100
  label             TEXT,                            -- categorical output
  severity          TEXT CHECK (severity IN ('info', 'ok', 'warning', 'critical')),
  value_json        JSONB NOT NULL DEFAULT '{}',     -- widget-specific structured data
  reasons           TEXT[] DEFAULT '{}',             -- human-readable reasons
  evidence          JSONB,                           -- data points that drove this signal
  confidence        NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),

  -- Recommendations
  recommendations   JSONB DEFAULT '[]',              -- [{action, priority, rationale}]

  -- Input tracking (for staleness/dedup)
  input_hash        TEXT,                            -- SHA256 of inputs
  input_summary     JSONB,                           -- lightweight summary of inputs

  -- History tracking
  previous_score    NUMERIC(5,2),
  previous_severity TEXT,
  changed_at        TIMESTAMPTZ,                     -- when severity last changed
  change_direction  TEXT CHECK (change_direction IN ('improved', 'degraded', 'unchanged', 'new')),

  -- Lifecycle
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale_at          TIMESTAMPTZ,                     -- computed_at + widget.stale_after_hours
  compute_time_ms   INT,
  model_version     TEXT DEFAULT 'v1',

  -- User interaction
  acknowledged_by   UUID,
  acknowledged_at   TIMESTAMPTZ,
  dismissed_until   TIMESTAMPTZ,                     -- snooze

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One active signal per widget per vehicle
  UNIQUE(vehicle_id, widget_slug)
);

CREATE INDEX IF NOT EXISTS idx_analysis_signals_vehicle ON analysis_signals(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_analysis_signals_widget ON analysis_signals(widget_slug);
CREATE INDEX IF NOT EXISTS idx_analysis_signals_severity ON analysis_signals(severity, created_at DESC)
  WHERE severity IN ('warning', 'critical');
CREATE INDEX IF NOT EXISTS idx_analysis_signals_stale ON analysis_signals(stale_at)
  WHERE stale_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_signals_vehicle_severity ON analysis_signals(vehicle_id, severity);
CREATE INDEX IF NOT EXISTS idx_analysis_signals_changed ON analysis_signals(changed_at DESC)
  WHERE change_direction IN ('improved', 'degraded');

-- RLS
ALTER TABLE analysis_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analysis_signals_read" ON analysis_signals
  FOR SELECT USING (true);

CREATE POLICY "analysis_signals_service_write" ON analysis_signals
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE analysis_signals IS 'Per-vehicle widget outputs from the Analysis Engine. One row per widget per vehicle, upserted on recomputation. Owned by analysis-engine-coordinator.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. analysis_signal_history — Audit Trail
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analysis_signal_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     UUID NOT NULL REFERENCES analysis_signals(id) ON DELETE CASCADE,
  vehicle_id    UUID NOT NULL,
  widget_slug   TEXT NOT NULL,
  score         NUMERIC(5,2),
  severity      TEXT,
  label         TEXT,
  reasons       TEXT[],
  computed_at   TIMESTAMPTZ NOT NULL,
  model_version TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_signal_history_signal ON analysis_signal_history(signal_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_signal_history_vehicle ON analysis_signal_history(vehicle_id, widget_slug, computed_at DESC);

-- RLS
ALTER TABLE analysis_signal_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analysis_signal_history_read" ON analysis_signal_history
  FOR SELECT USING (true);

CREATE POLICY "analysis_signal_history_service_write" ON analysis_signal_history
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE analysis_signal_history IS 'Append-only history of analysis_signals changes. Enables "when did this warning first appear?" queries.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. analysis_queue — Processing Queue
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analysis_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- What triggered this
  trigger_source  TEXT NOT NULL DEFAULT 'cron_sweep'
                  CHECK (trigger_source IN ('observation', 'cron_sweep', 'on_demand', 'backfill', 'manual')),
  trigger_reasons TEXT[] DEFAULT '{}',

  -- Which widgets to run (NULL = all applicable)
  widget_slugs    TEXT[],

  -- Queue mechanics (mirrors import_queue)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'skipped')),
  priority        INT NOT NULL DEFAULT 50,
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  locked_by       TEXT,
  locked_at       TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,

  -- Results
  widgets_computed INT DEFAULT 0,
  widgets_failed   INT DEFAULT 0,
  error_message   TEXT,
  compute_time_ms INT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- Debounce: one pending entry per vehicle
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_queue_vehicle_pending
  ON analysis_queue(vehicle_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_analysis_queue_status_priority
  ON analysis_queue(status, priority DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_analysis_queue_locked
  ON analysis_queue(locked_at)
  WHERE status = 'processing';

-- RLS
ALTER TABLE analysis_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analysis_queue_service_only" ON analysis_queue
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE analysis_queue IS 'Processing queue for Analysis Engine widget computations. Same lock pattern as import_queue. One pending entry per vehicle (debounce).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Claim function (same pattern as claim_import_queue_batch)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_analysis_queue_batch(
  p_batch_size      INTEGER DEFAULT 20,
  p_max_attempts    INTEGER DEFAULT 3,
  p_worker_id       TEXT DEFAULT NULL,
  p_lock_ttl_seconds INTEGER DEFAULT 900
)
RETURNS SETOF public.analysis_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now     TIMESTAMPTZ := NOW();
  v_lock_ttl INTERVAL := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lock_ttl_seconds, 900), 3600)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT aq.id
    FROM public.analysis_queue aq
    WHERE aq.status = 'pending'
      AND COALESCE(aq.attempts, 0) < COALESCE(p_max_attempts, 3)
      AND (aq.next_attempt_at IS NULL OR aq.next_attempt_at <= v_now)
      AND (aq.locked_at IS NULL OR aq.locked_at < (v_now - v_lock_ttl))
    ORDER BY aq.priority DESC, aq.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 20), 200))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.analysis_queue aq
    SET
      status          = 'processing',
      attempts        = COALESCE(aq.attempts, 0) + 1,
      locked_at       = v_now,
      locked_by       = COALESCE(p_worker_id, 'analysis-engine'),
      last_attempt_at = v_now,
      updated_at      = v_now
    WHERE aq.id IN (SELECT id FROM candidates)
    RETURNING aq.*
  )
  SELECT * FROM claimed;
END;
$$;

COMMENT ON FUNCTION claim_analysis_queue_batch IS 'Atomically claim a batch of analysis queue items. Uses FOR UPDATE SKIP LOCKED for safe concurrency.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Updated-at triggers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_analysis_widgets_updated_at
  BEFORE UPDATE ON analysis_widgets
  FOR EACH ROW EXECUTE FUNCTION update_analysis_updated_at();

CREATE TRIGGER trg_analysis_signals_updated_at
  BEFORE UPDATE ON analysis_signals
  FOR EACH ROW EXECUTE FUNCTION update_analysis_updated_at();

CREATE TRIGGER trg_analysis_queue_updated_at
  BEFORE UPDATE ON analysis_queue
  FOR EACH ROW EXECUTE FUNCTION update_analysis_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed Widget Registry
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO analysis_widgets (slug, display_name, category, trigger_on_observation_kinds, trigger_on_table_changes, compute_mode, edge_function_name, output_type, severity_thresholds, stale_after_hours, default_priority, description) VALUES

-- Deal Health
('time-kills-deals', 'Time Kills Deals Clock', 'deal_health',
  ARRAY['bid', 'comment', 'listing', 'sale_result'],
  ARRAY['external_listings', 'deal_jackets', 'analysis_signals'],
  'edge_function', 'widget-time-kills-deals', 'composite',
  '{"warning": 40, "critical": 20}',
  4, 90,
  'Master aggregator. Combines DOM, engagement cooling, price reductions, seasonal, competition, rerun decay, and broker exposure into composite deal health score.'),

('buyer-qualification', 'Buyer Qualification Score', 'deal_health',
  ARRAY['offer', 'contact'],
  ARRAY['deal_contacts', 'vehicle_deal_offers'],
  'edge_function', 'widget-buyer-qualification', 'score',
  '{"warning": 40, "critical": 20}',
  24, 70,
  'Scores buyer quality: prior purchase history, deposit speed, communication responsiveness, geographic distance.'),

('deal-readiness', 'Deal Readiness', 'deal_health',
  NULL,
  ARRAY['deal_jackets', 'deal_documents', 'deal_contacts', 'payment_transactions'],
  'edge_function', 'widget-deal-readiness', 'composite',
  '{"warning": 50, "critical": 25}',
  4, 80,
  'For active deals: are all documents, contacts, payments in order? Checklist completion percentage.'),

-- Pricing
('completion-discount', 'Completion Discount Calculator', 'pricing',
  ARRAY['condition_report', 'work_record'],
  ARRAY['condition_assessments', 'vehicle_observations', 'clean_vehicle_prices'],
  'edge_function', 'widget-completion-discount', 'composite',
  '{"warning": 10, "critical": 20}',
  6, 75,
  'When vehicle has known deficiencies, calculates buyer discount vs completed comparables. Includes ROI of completing each deficiency.'),

('rerun-decay', 'Rerun Decay Rate', 'pricing',
  ARRAY['listing', 'sale_result'],
  ARRAY['external_listings'],
  'edge_function', 'widget-rerun-decay', 'composite',
  '{"warning": 2, "critical": 3}',
  24, 80,
  'Tracks price decay across multiple listing attempts. Warning at 2nd listing, critical at 3rd+. Benchmarks: BaT 8-12%/rerun, BJ 5-8%, C&B 10-15%.'),

('commission-optimizer', 'Commission Structure Optimizer', 'pricing',
  NULL,
  ARRAY['deal_jackets', 'seller_contracts'],
  'edge_function', 'widget-commission-optimizer', 'composite',
  NULL,
  72, 50,
  'Recommends optimal commission structure based on price tier, expected DOM, recon costs, and historical deal margins.'),

('comp-freshness', 'Comparable Freshness Decay', 'pricing',
  ARRAY['sale_result'],
  ARRAY['clean_vehicle_prices'],
  'inline_sql', NULL, 'score',
  '{"warning": 30, "critical": 10}',
  24, 60,
  'Monitors age and count of comparable sales. Low comp count or stale comps = low confidence.'),

-- Market / Timing
('sell-through-cliff', 'Sell-Through Cliff', 'timing',
  ARRAY['listing'],
  ARRAY['external_listings'],
  'edge_function', 'widget-sell-through-cliff', 'composite',
  '{"warning": 40, "critical": 20}',
  24, 85,
  'DOM-based sell-through probability with segment-specific cliff points. Pre-war 120d, muscle 45d, European sports 30d, trucks 60d, JDM 21d.'),

('seasonal-pricing', 'Seasonal Pricing Optimizer', 'market',
  NULL,
  ARRAY['external_listings'],
  'inline_sql', NULL, 'composite',
  NULL,
  168, 40,
  'Identifies optimal listing window by month for vehicle segment. Convertibles +18% Apr-Jun; trucks opposite.'),

('auction-house-optimizer', 'Auction House Selection', 'market',
  NULL,
  ARRAY['external_listings'],
  'inline_sql', NULL, 'composite',
  NULL,
  168, 50,
  'Cross-references YMM against sell-through rates and hammer prices across platforms (140K+ listings).'),

('market-velocity', 'Market Velocity', 'market',
  ARRAY['listing', 'sale_result', 'bid'],
  ARRAY['external_listings'],
  'inline_sql', NULL, 'label',
  NULL,
  24, 55,
  'Tracks segment selling speed: median DOM, listing volume trends, bid-to-ask ratios over 30/60/90d windows.'),

('geographic-arbitrage', 'Geographic Arbitrage Detector', 'market',
  NULL,
  ARRAY['external_listings'],
  'inline_sql', NULL, 'composite',
  NULL,
  168, 35,
  'Compares prices for same YMM across geographic regions. Identifies cross-market arbitrage opportunities net of transport.'),

-- Presentation
('presentation-roi', 'Presentation ROI', 'presentation',
  NULL,
  ARRAY['vehicle_images'],
  'edge_function', 'widget-presentation-roi', 'composite',
  '{"warning": 40, "critical": 20}',
  24, 65,
  'Photo count + quality + zone coverage + description quality. Calculates expected price lift from improvements. European sports 15-22%, muscle 8-15%, trucks 5-10%, pre-war 20-30%.'),

-- Exposure
('broker-exposure', 'Broker Exposure Tracker', 'exposure',
  ARRAY['listing'],
  ARRAY['external_listings', 'dealer_inventory', 'deal_contacts'],
  'edge_function', 'widget-broker-exposure', 'composite',
  '{"warning": 3, "critical": 4}',
  24, 70,
  'Tracks multi-platform exposure. Each additional platform erodes 5-12% exclusivity premium. Warning at 3+ platforms, critical at 4+.')

ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  trigger_on_observation_kinds = EXCLUDED.trigger_on_observation_kinds,
  trigger_on_table_changes = EXCLUDED.trigger_on_table_changes,
  compute_mode = EXCLUDED.compute_mode,
  edge_function_name = EXCLUDED.edge_function_name,
  output_type = EXCLUDED.output_type,
  severity_thresholds = EXCLUDED.severity_thresholds,
  stale_after_hours = EXCLUDED.stale_after_hours,
  default_priority = EXCLUDED.default_priority,
  description = EXCLUDED.description,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Pipeline Registry Entries
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via) VALUES
-- analysis_signals
('analysis_signals', NULL, 'analysis-engine-coordinator', 'Per-vehicle widget outputs. Write through analysis-engine-coordinator only.', true, 'analysis-engine-coordinator'),
('analysis_signals', 'score', 'analysis-engine-coordinator', 'Widget output score 0-100. Computed by widget-specific logic.', true, 'analysis-engine-coordinator'),
('analysis_signals', 'severity', 'analysis-engine-coordinator', 'info/ok/warning/critical. Derived from widget threshold config.', true, 'analysis-engine-coordinator'),
('analysis_signals', 'recommendations', 'analysis-engine-coordinator', 'Array of {action, priority, rationale} suggestions.', true, 'analysis-engine-coordinator'),

-- analysis_queue
('analysis_queue', NULL, 'analysis-engine-coordinator', 'Vehicle analysis processing queue. Same lock pattern as import_queue.', false, NULL),
('analysis_queue', 'status', 'analysis-engine-coordinator', 'Processing state.', false, NULL),
('analysis_queue', 'locked_by', 'analysis-engine-coordinator', 'Worker ID. Stale after 30min.', true, NULL),
('analysis_queue', 'locked_at', 'analysis-engine-coordinator', 'Lock timestamp. Stale after 30min.', true, NULL),

-- analysis_widgets
('analysis_widgets', NULL, 'system', 'Widget registry. Configuration table — do not modify programmatically except via migrations.', false, NULL)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Add analysis_queue to release_stale_locks()
-- ─────────────────────────────────────────────────────────────────────────────

-- We need to replace the function to add the new queue.
-- First, let's check if the function exists and get its definition.
-- We'll use CREATE OR REPLACE to add the analysis_queue block.

-- Add to queue_lock_health view
CREATE OR REPLACE VIEW public.queue_lock_health AS

-- import_queue
SELECT
  'import_queue'::text AS queue_table,
  status,
  locked_at,
  NOW() - locked_at AS lock_age
FROM import_queue
WHERE status = 'processing'

UNION ALL

-- bat_extraction_queue
SELECT
  'bat_extraction_queue'::text,
  status,
  locked_at,
  NOW() - locked_at
FROM bat_extraction_queue
WHERE status = 'processing'

UNION ALL

-- document_ocr_queue
SELECT
  'document_ocr_queue'::text,
  status,
  locked_at,
  NOW() - locked_at
FROM document_ocr_queue
WHERE status = 'processing'

UNION ALL

-- vehicle_images (processing)
SELECT
  'vehicle_images'::text,
  ai_processing_status AS status,
  ai_processing_locked_at AS locked_at,
  NOW() - ai_processing_locked_at AS lock_age
FROM vehicle_images
WHERE ai_processing_status = 'processing'

UNION ALL

-- analysis_queue (NEW)
SELECT
  'analysis_queue'::text,
  status,
  locked_at,
  NOW() - locked_at
FROM analysis_queue
WHERE status = 'processing';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Cron job for analysis engine sweep (every 15 minutes)
-- ─────────────────────────────────────────────────────────────────────────────

-- Note: The actual cron job will be added via SQL after the coordinator
-- edge function is deployed. Placeholder comment for now.
-- SELECT cron.schedule(
--   'analysis-engine-sweep',
--   '*/15 * * * *',
--   $$
--     SELECT net.http_post(
--       url := get_service_url() || '/functions/v1/analysis-engine-coordinator',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || get_service_role_key_for_cron()
--       ),
--       body := '{"action": "sweep", "batch_size": 50}'::jsonb
--     );
--   $$
-- );
