-- User-Submitted Comparables System with Bullshit Detection
-- Allows users to submit comparable vehicle links with validation

-- Create table for user-submitted comparables
CREATE TABLE IF NOT EXISTS user_submitted_comparables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  comparable_url TEXT NOT NULL,
  submitted_by UUID REFERENCES auth.users(id),
  notes TEXT,
  comparable_data JSONB, -- Scraped vehicle data
  validation_result JSONB, -- Bullshit detection results
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'flagged', 'rejected')),
  community_votes JSONB DEFAULT '{"helpful": 0, "unhelpful": 0}',
  admin_reviewed BOOLEAN DEFAULT FALSE,
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create table for community voting on comparables
CREATE TABLE IF NOT EXISTS comparable_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comparable_id UUID NOT NULL REFERENCES user_submitted_comparables(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  vote_type TEXT NOT NULL CHECK (vote_type IN ('helpful', 'unhelpful', 'bullshit')),
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(comparable_id, user_id) -- One vote per user per comparable
);

-- Add comparable tracking to vehicles
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS user_comparables_count INTEGER DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS avg_comparable_price NUMERIC;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS comparable_confidence INTEGER DEFAULT 0;

-- Create function to update comparable stats
CREATE OR REPLACE FUNCTION update_vehicle_comparable_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update vehicle stats when comparables are added/updated
  UPDATE vehicles SET
    user_comparables_count = (
      SELECT COUNT(*) 
      FROM user_submitted_comparables 
      WHERE vehicle_id = COALESCE(NEW.vehicle_id, OLD.vehicle_id)
      AND status = 'approved'
    ),
    avg_comparable_price = (
      SELECT AVG((comparable_data->>'price')::NUMERIC)
      FROM user_submitted_comparables 
      WHERE vehicle_id = COALESCE(NEW.vehicle_id, OLD.vehicle_id)
      AND status = 'approved'
      AND (comparable_data->>'price')::NUMERIC > 0
    ),
    comparable_confidence = LEAST(95, 50 + (
      SELECT COUNT(*) * 10 
      FROM user_submitted_comparables 
      WHERE vehicle_id = COALESCE(NEW.vehicle_id, OLD.vehicle_id)
      AND status = 'approved'
    ))
  WHERE id = COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for comparable stats
DROP TRIGGER IF EXISTS update_comparable_stats_trigger ON user_submitted_comparables;
CREATE TRIGGER update_comparable_stats_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_submitted_comparables
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_comparable_stats();

-- Create function to update community votes
CREATE OR REPLACE FUNCTION update_community_votes()
RETURNS TRIGGER AS $$
BEGIN
  -- Update vote counts on the comparable
  UPDATE user_submitted_comparables SET
    community_votes = jsonb_build_object(
      'helpful', (
        SELECT COUNT(*) FROM comparable_votes 
        WHERE comparable_id = NEW.comparable_id AND vote_type = 'helpful'
      ),
      'unhelpful', (
        SELECT COUNT(*) FROM comparable_votes 
        WHERE comparable_id = NEW.comparable_id AND vote_type = 'unhelpful'
      ),
      'bullshit', (
        SELECT COUNT(*) FROM comparable_votes 
        WHERE comparable_id = NEW.comparable_id AND vote_type = 'bullshit'
      )
    ),
    updated_at = NOW()
  WHERE id = NEW.comparable_id;
  
  -- Auto-flag comparables with too many bullshit votes
  UPDATE user_submitted_comparables SET
    status = 'flagged'
  WHERE id = NEW.comparable_id
    AND (community_votes->>'bullshit')::INTEGER >= 3
    AND status = 'approved';
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for community votes
DROP TRIGGER IF EXISTS update_votes_trigger ON comparable_votes;
CREATE TRIGGER update_votes_trigger
  AFTER INSERT OR UPDATE OR DELETE ON comparable_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_community_votes();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_comparables_vehicle_id ON user_submitted_comparables(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_user_comparables_status ON user_submitted_comparables(status);
CREATE INDEX IF NOT EXISTS idx_user_comparables_submitted_by ON user_submitted_comparables(submitted_by);
CREATE INDEX IF NOT EXISTS idx_comparable_votes_comparable_id ON comparable_votes(comparable_id);
CREATE INDEX IF NOT EXISTS idx_comparable_votes_user_id ON comparable_votes(user_id);

-- Enable RLS
ALTER TABLE user_submitted_comparables ENABLE ROW LEVEL SECURITY;
ALTER TABLE comparable_votes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for comparables
CREATE POLICY "Anyone can view approved comparables" ON user_submitted_comparables
  FOR SELECT USING (status = 'approved');

CREATE POLICY "Users can view their own submissions" ON user_submitted_comparables
  FOR SELECT USING (submitted_by = auth.uid());

CREATE POLICY "Authenticated users can submit comparables" ON user_submitted_comparables
  FOR INSERT TO authenticated WITH CHECK (submitted_by = auth.uid());

CREATE POLICY "Users can update their own submissions" ON user_submitted_comparables
  FOR UPDATE TO authenticated USING (submitted_by = auth.uid());

-- RLS Policies for votes
CREATE POLICY "Anyone can view votes" ON comparable_votes
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can vote" ON comparable_votes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own votes" ON comparable_votes
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Function to submit a comparable (called from frontend)
CREATE OR REPLACE FUNCTION submit_comparable(
  p_vehicle_id UUID,
  p_comparable_url TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  -- Validate URL format
  IF p_comparable_url !~ '^https?://' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid URL format'
    );
  END IF;
  
  -- Check if URL already submitted for this vehicle
  IF EXISTS (
    SELECT 1 FROM user_submitted_comparables 
    WHERE vehicle_id = p_vehicle_id 
    AND comparable_url = p_comparable_url
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This comparable has already been submitted'
    );
  END IF;
  
  -- Call the validation Edge Function
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/validate-comparable',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object(
      'vehicle_id', p_vehicle_id::text,
      'comparable_url', p_comparable_url,
      'submitted_by', auth.uid()::text,
      'notes', p_notes
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to vote on a comparable
CREATE OR REPLACE FUNCTION vote_on_comparable(
  p_comparable_id UUID,
  p_vote_type TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
  -- Validate vote type
  IF p_vote_type NOT IN ('helpful', 'unhelpful', 'bullshit') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid vote type'
    );
  END IF;
  
  -- Insert or update vote
  INSERT INTO comparable_votes (comparable_id, user_id, vote_type, reason)
  VALUES (p_comparable_id, auth.uid(), p_vote_type, p_reason)
  ON CONFLICT (comparable_id, user_id) 
  DO UPDATE SET 
    vote_type = EXCLUDED.vote_type,
    reason = EXCLUDED.reason,
    created_at = NOW();
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Vote recorded'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for getting vehicle comparables with stats
CREATE OR REPLACE VIEW vehicle_comparables_summary AS
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  v.user_comparables_count,
  v.avg_comparable_price,
  v.comparable_confidence,
  COALESCE(
    json_agg(
      json_build_object(
        'id', uc.id,
        'url', uc.comparable_url,
        'price', (uc.comparable_data->>'price')::NUMERIC,
        'source', uc.comparable_data->>'source',
        'title', uc.comparable_data->>'title',
        'notes', uc.notes,
        'validation_score', (uc.validation_result->>'confidence')::INTEGER,
        'community_votes', uc.community_votes,
        'submitted_at', uc.created_at
      ) ORDER BY uc.created_at DESC
    ) FILTER (WHERE uc.id IS NOT NULL),
    '[]'::json
  ) as comparables
FROM vehicles v
LEFT JOIN user_submitted_comparables uc ON v.id = uc.vehicle_id AND uc.status = 'approved'
GROUP BY v.id, v.year, v.make, v.model, v.user_comparables_count, v.avg_comparable_price, v.comparable_confidence;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '🎯 User Comparables System with Bullshit Detection installed!';
  RAISE NOTICE 'Users can now submit comparable links, but Icon builds will be auto-flagged.';
  RAISE NOTICE 'Community voting helps identify quality comparables.';
END$$;