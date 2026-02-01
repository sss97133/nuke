-- Site Scout tables for Vegas garage location analysis

CREATE TABLE IF NOT EXISTS site_scout_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
  phase TEXT, -- current processing phase
  candidates_found INTEGER DEFAULT 0,
  sites_scored INTEGER DEFAULT 0,
  summary TEXT,
  area_scores JSONB,
  top_sites JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_scout_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES site_scout_runs(id),
  name TEXT,
  address TEXT,
  area TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  price NUMERIC,
  sqft NUMERIC,
  zoning TEXT,
  source TEXT, -- loopnet, crexi, landwatch, etc
  source_url TEXT,
  score NUMERIC, -- overall score 1-10
  scores JSONB, -- breakdown by category
  reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_scout_candidates_run ON site_scout_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_site_scout_candidates_score ON site_scout_candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_site_scout_candidates_area ON site_scout_candidates(area);
CREATE INDEX IF NOT EXISTS idx_site_scout_runs_status ON site_scout_runs(status);
