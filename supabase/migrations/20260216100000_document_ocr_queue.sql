-- ============================================================================
-- DOCUMENT OCR QUEUE
--
-- Processing queue for batch document OCR extraction from deal jacket photos.
-- Follows the import_queue locking pattern with state tracking for
-- classify → extract → link pipeline stages.
-- ============================================================================

-- ─── PROCESSING QUEUE ──────────────────────────────────────────────────────

CREATE TABLE document_ocr_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_document_id UUID REFERENCES deal_documents(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,

  -- Processing state
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','classifying','extracting','linking','complete','failed','skipped')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,

  -- Classification results
  document_type TEXT,
  document_type_confidence REAL,
  orientation_degrees INTEGER DEFAULT 0,

  -- Extraction results
  extraction_provider TEXT,
  extraction_model TEXT,
  extraction_data JSONB,
  extraction_cost_usd REAL,

  -- Entity linking results
  linked_vehicle_id UUID,
  linked_deal_id UUID,
  linked_organization_ids UUID[],
  linked_contact_ids UUID[],

  -- Observations created
  observation_ids UUID[],

  -- Row locking (same pattern as import_queue)
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  next_attempt_at TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for queue processing
CREATE INDEX idx_docq_status_priority ON document_ocr_queue(status, priority DESC)
  WHERE status IN ('pending', 'classifying', 'extracting', 'linking');
CREATE INDEX idx_docq_locked ON document_ocr_queue(locked_at)
  WHERE locked_at IS NOT NULL;
CREATE INDEX idx_docq_next_attempt ON document_ocr_queue(next_attempt_at)
  WHERE status = 'failed' AND attempts < max_attempts;
CREATE INDEX idx_docq_deal_doc ON document_ocr_queue(deal_document_id)
  WHERE deal_document_id IS NOT NULL;
CREATE INDEX idx_docq_vehicle ON document_ocr_queue(linked_vehicle_id)
  WHERE linked_vehicle_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_docq_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_docq_updated_at
  BEFORE UPDATE ON document_ocr_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_docq_updated_at();

-- ─── OBSERVATION SOURCE REGISTRATION ───────────────────────────────────────

INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES ('deal-jacket-ocr', 'Deal Jacket OCR Pipeline', 'documentation', 0.70,
  ARRAY['provenance','ownership','work_record','specification']::observation_kind[])
ON CONFLICT (slug) DO NOTHING;

-- ─── COST TRACKING VIEW ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW document_pipeline_cost_summary AS
SELECT
  date,
  SUM(total_extractions) AS extractions,
  SUM(total_cost_usd) AS cost_usd,
  ROUND(SUM(total_cost_usd) / NULLIF(SUM(total_extractions), 0)::numeric, 4) AS avg_cost
FROM ds_cost_tracking
GROUP BY date
ORDER BY date DESC;

-- ─── ADD storage_path TO deal_documents IF NOT EXISTS ──────────────────────
-- (Existing table only has photo_path, we need storage_path for Supabase Storage references)

ALTER TABLE deal_documents ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- ─── COMMENTS ──────────────────────────────────────────────────────────────

COMMENT ON TABLE document_ocr_queue IS 'Processing queue for batch document OCR. States: pending → classifying → extracting → linking → complete. Row locking prevents concurrent processing.';
COMMENT ON COLUMN document_ocr_queue.storage_path IS 'Supabase Storage path in deal-documents bucket';
COMMENT ON COLUMN document_ocr_queue.locked_by IS 'Worker ID that has claimed this row';
COMMENT ON COLUMN document_ocr_queue.next_attempt_at IS 'For failed items: when to retry (exponential backoff)';
COMMENT ON VIEW document_pipeline_cost_summary IS 'Daily cost breakdown for document OCR pipeline from ds_cost_tracking';
