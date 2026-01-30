-- ═══════════════════════════════════════════════════════════════════════════════
-- FORUM EXTRACTION PIPELINE TABLES
-- Build thread discovery, inspection, and extraction infrastructure
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- Forum Sources Registry
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS forum_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,

  -- Platform identification
  platform_type TEXT CHECK (platform_type IN ('vbulletin', 'xenforo', 'phpbb', 'discourse', 'custom', 'unknown')),
  platform_version TEXT,

  -- Categorization
  vehicle_categories TEXT[] DEFAULT '{}',
  specialties TEXT[] DEFAULT '{}',

  -- Build thread patterns
  build_thread_patterns TEXT[] DEFAULT '{}',
  build_section_urls TEXT[] DEFAULT '{}',

  -- Inspection status
  inspection_status TEXT DEFAULT 'pending' CHECK (inspection_status IN ('pending', 'inspected', 'mapped', 'active', 'failed', 'blocked')),

  -- DOM analysis results
  dom_map JSONB DEFAULT '{}',
  extraction_config JSONB DEFAULT '{}',

  -- Stats
  estimated_build_count INTEGER,
  estimated_post_count INTEGER,
  estimated_image_count INTEGER,

  -- Auth requirements
  requires_login BOOLEAN DEFAULT false,
  login_wall_indicator TEXT,

  -- Timestamps
  last_inspected_at TIMESTAMPTZ,
  last_crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_sources_status ON forum_sources(inspection_status);
CREATE INDEX IF NOT EXISTS idx_forum_sources_categories ON forum_sources USING gin(vehicle_categories);

COMMENT ON TABLE forum_sources IS 'Registry of automotive forums for build thread extraction';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Build Threads
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS build_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_source_id UUID REFERENCES forum_sources(id) ON DELETE CASCADE,

  -- Thread identification
  thread_url TEXT UNIQUE NOT NULL,
  thread_url_normalized TEXT,
  thread_id_external TEXT,
  thread_title TEXT,

  -- Author
  author_handle TEXT,
  author_profile_url TEXT,
  external_identity_id UUID REFERENCES external_identities(id),

  -- Vehicle matching
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_hints JSONB DEFAULT '{}',
  vehicle_match_confidence NUMERIC(3,2),

  -- Thread stats
  post_count INTEGER,
  image_count_estimate INTEGER,
  first_post_date TIMESTAMPTZ,
  last_post_date TIMESTAMPTZ,
  view_count INTEGER,
  reply_count INTEGER,

  -- Extraction tracking
  extraction_status TEXT DEFAULT 'discovered' CHECK (extraction_status IN (
    'discovered', 'queued', 'extracting', 'complete', 'partial', 'failed', 'blocked'
  )),
  extraction_priority INTEGER DEFAULT 50,
  posts_extracted INTEGER DEFAULT 0,
  images_extracted INTEGER DEFAULT 0,
  pages_crawled INTEGER DEFAULT 0,
  total_pages INTEGER,
  last_extracted_at TIMESTAMPTZ,
  extraction_error TEXT,

  -- Content hash for change detection
  content_hash TEXT,
  title_hash TEXT,

  -- Quality signals
  is_featured BOOLEAN DEFAULT false,
  has_completion_post BOOLEAN,
  quality_score INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_build_threads_forum ON build_threads(forum_source_id);
CREATE INDEX IF NOT EXISTS idx_build_threads_vehicle ON build_threads(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_build_threads_status ON build_threads(extraction_status);
CREATE INDEX IF NOT EXISTS idx_build_threads_priority ON build_threads(extraction_priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_build_threads_author ON build_threads(external_identity_id);

COMMENT ON TABLE build_threads IS 'Discovered build threads from forums';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Build Posts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS build_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_thread_id UUID REFERENCES build_threads(id) ON DELETE CASCADE NOT NULL,

  -- Post identification
  post_number INTEGER NOT NULL,
  post_id_external TEXT,
  page_number INTEGER,

  -- Author
  author_handle TEXT,
  author_profile_url TEXT,
  external_identity_id UUID REFERENCES external_identities(id),
  is_thread_author BOOLEAN DEFAULT false,

  -- Content
  posted_at TIMESTAMPTZ,
  content_text TEXT,
  content_html TEXT,

  -- Media
  images TEXT[] DEFAULT '{}',
  image_count INTEGER DEFAULT 0,
  videos TEXT[] DEFAULT '{}',

  -- References
  quoted_handles TEXT[] DEFAULT '{}',
  quoted_post_numbers INTEGER[] DEFAULT '{}',
  external_links TEXT[] DEFAULT '{}',
  mentioned_parts TEXT[] DEFAULT '{}',

  -- AI analysis
  work_type_detected TEXT,
  parts_mentioned JSONB DEFAULT '{}',
  progress_indicators JSONB DEFAULT '{}',

  -- Observation system link
  observation_id UUID REFERENCES vehicle_observations(id),

  -- Deduplication
  content_hash TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(build_thread_id, post_number)
);

CREATE INDEX IF NOT EXISTS idx_build_posts_thread ON build_posts(build_thread_id);
CREATE INDEX IF NOT EXISTS idx_build_posts_author ON build_posts(external_identity_id);
CREATE INDEX IF NOT EXISTS idx_build_posts_date ON build_posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_build_posts_hash ON build_posts(content_hash);

COMMENT ON TABLE build_posts IS 'Individual posts from build threads';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Build Images
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS build_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_post_id UUID REFERENCES build_posts(id) ON DELETE CASCADE NOT NULL,
  build_thread_id UUID REFERENCES build_threads(id) ON DELETE CASCADE NOT NULL,

  -- Image source
  source_url TEXT NOT NULL,
  source_url_full TEXT,
  source_url_thumbnail TEXT,

  -- Archived copy
  archived_url TEXT,
  archived_at TIMESTAMPTZ,

  -- Metadata
  sequence_in_post INTEGER,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  format TEXT,

  -- AI analysis
  image_type TEXT,
  detected_objects JSONB DEFAULT '{}',
  vehicle_visible BOOLEAN,
  work_visible BOOLEAN,

  -- Hash for deduplication
  perceptual_hash TEXT,
  content_hash TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(build_post_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_build_images_post ON build_images(build_post_id);
CREATE INDEX IF NOT EXISTS idx_build_images_thread ON build_images(build_thread_id);
CREATE INDEX IF NOT EXISTS idx_build_images_hash ON build_images(perceptual_hash);

COMMENT ON TABLE build_images IS 'Images extracted from build posts';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Forum Inspection Logs
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS forum_inspection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_source_id UUID REFERENCES forum_sources(id) ON DELETE CASCADE NOT NULL,

  inspection_type TEXT NOT NULL CHECK (inspection_type IN ('initial', 'structure', 'build_discovery', 'full_crawl')),
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),

  -- Results
  pages_crawled INTEGER DEFAULT 0,
  threads_found INTEGER DEFAULT 0,
  errors_encountered INTEGER DEFAULT 0,

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Debug info
  log_data JSONB DEFAULT '{}',
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_inspection_logs_forum ON forum_inspection_logs(forum_source_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Extraction Queue
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS forum_extraction_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Target
  build_thread_id UUID REFERENCES build_threads(id) ON DELETE CASCADE,
  forum_source_id UUID REFERENCES forum_sources(id) ON DELETE CASCADE,

  -- Queue management
  priority INTEGER DEFAULT 50,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'retry')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Processing
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  posts_extracted INTEGER,
  images_extracted INTEGER,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_queue_status ON forum_extraction_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_queue_thread ON forum_extraction_queue(build_thread_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Register as observation source
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO observation_sources (slug, name, source_type, config)
VALUES ('forum_builds', 'Forum Build Threads', 'forum', '{
  "extraction_enabled": true,
  "auto_vehicle_match": true,
  "create_timeline_events": true
}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  config = EXCLUDED.config;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Helper Functions
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get next thread to extract
CREATE OR REPLACE FUNCTION get_next_extraction_job(p_worker_id TEXT DEFAULT NULL)
RETURNS TABLE(
  queue_id UUID,
  thread_id UUID,
  thread_url TEXT,
  forum_slug TEXT,
  dom_map JSONB
) AS $$
DECLARE
  v_job RECORD;
BEGIN
  -- Lock and return next pending job
  UPDATE forum_extraction_queue q
  SET status = 'processing',
      locked_at = NOW(),
      locked_by = COALESCE(p_worker_id, 'default'),
      started_at = NOW(),
      attempts = attempts + 1
  FROM (
    SELECT eq.id
    FROM forum_extraction_queue eq
    WHERE eq.status IN ('pending', 'retry')
      AND (eq.locked_at IS NULL OR eq.locked_at < NOW() - INTERVAL '10 minutes')
      AND eq.attempts < eq.max_attempts
    ORDER BY eq.priority DESC, eq.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.id, q.build_thread_id INTO v_job;

  IF v_job IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_job.id AS queue_id,
    bt.id AS thread_id,
    bt.thread_url,
    fs.slug AS forum_slug,
    fs.dom_map
  FROM build_threads bt
  JOIN forum_sources fs ON fs.id = bt.forum_source_id
  WHERE bt.id = v_job.build_thread_id;
END;
$$ LANGUAGE plpgsql;

-- Mark extraction complete
CREATE OR REPLACE FUNCTION complete_extraction_job(
  p_queue_id UUID,
  p_posts_extracted INTEGER,
  p_images_extracted INTEGER,
  p_success BOOLEAN DEFAULT true,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE forum_extraction_queue
  SET status = CASE WHEN p_success THEN 'complete' ELSE 'failed' END,
      completed_at = NOW(),
      posts_extracted = p_posts_extracted,
      images_extracted = p_images_extracted,
      error_message = p_error,
      locked_at = NULL,
      locked_by = NULL
  WHERE id = p_queue_id;

  -- Update thread status
  UPDATE build_threads bt
  SET extraction_status = CASE WHEN p_success THEN 'complete' ELSE 'failed' END,
      posts_extracted = p_posts_extracted,
      images_extracted = p_images_extracted,
      last_extracted_at = NOW(),
      extraction_error = p_error
  FROM forum_extraction_queue eq
  WHERE eq.id = p_queue_id AND bt.id = eq.build_thread_id;
END;
$$ LANGUAGE plpgsql;

-- Queue thread for extraction
CREATE OR REPLACE FUNCTION queue_thread_extraction(
  p_thread_id UUID,
  p_priority INTEGER DEFAULT 50
)
RETURNS UUID AS $$
DECLARE
  v_queue_id UUID;
  v_forum_id UUID;
BEGIN
  SELECT forum_source_id INTO v_forum_id FROM build_threads WHERE id = p_thread_id;

  INSERT INTO forum_extraction_queue (build_thread_id, forum_source_id, priority)
  VALUES (p_thread_id, v_forum_id, p_priority)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_queue_id;

  UPDATE build_threads SET extraction_status = 'queued' WHERE id = p_thread_id;

  RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Summary
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'FORUM EXTRACTION PIPELINE TABLES READY';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Tables: forum_sources, build_threads, build_posts, build_images';
  RAISE NOTICE 'Queue: forum_extraction_queue, forum_inspection_logs';
  RAISE NOTICE 'Functions: get_next_extraction_job, complete_extraction_job, queue_thread_extraction';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
