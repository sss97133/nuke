-- Manhunt searches: tracks what we've searched and what we found
-- for systematic service manual discovery across Archive.org, Ford Heritage, NHTSA TSB, etc.

CREATE TABLE IF NOT EXISTS manhunt_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES reference_libraries(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT,
  source TEXT NOT NULL CHECK (source IN (
    'archive_org', 'ford_heritage', 'nhtsa_tsb', 'forum_sticky', 'gm_heritage'
  )),
  search_query TEXT NOT NULL,
  search_url TEXT,
  results_found INTEGER DEFAULT 0,
  results_relevant INTEGER DEFAULT 0,
  documents_created INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'searching', 'found', 'not_found', 'downloaded', 'indexed', 'failed', 'skipped'
  )),
  error_message TEXT,
  raw_results JSONB,
  searched_at TIMESTAMP WITH TIME ZONE,
  next_search_after TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_manhunt_search UNIQUE (library_id, source, search_query)
);

CREATE INDEX idx_manhunt_searches_status ON manhunt_searches(status);
CREATE INDEX idx_manhunt_searches_source ON manhunt_searches(source);
CREATE INDEX idx_manhunt_searches_library ON manhunt_searches(library_id);
CREATE INDEX idx_manhunt_searches_next ON manhunt_searches(next_search_after) WHERE next_search_after IS NOT NULL;

COMMENT ON TABLE manhunt_searches IS 'Tracks systematic searches for factory documentation across Archive.org, Ford Heritage Vault, NHTSA TSB API. One row per library+source+query combination.';
COMMENT ON COLUMN manhunt_searches.source IS 'Which source was searched: archive_org, ford_heritage, nhtsa_tsb, forum_sticky, gm_heritage';
COMMENT ON COLUMN manhunt_searches.status IS 'pending → searching → found/not_found → downloaded → indexed OR failed/skipped';
COMMENT ON COLUMN manhunt_searches.next_search_after IS 'When to re-search (30 days out). NULL = never searched or permanent skip.';
