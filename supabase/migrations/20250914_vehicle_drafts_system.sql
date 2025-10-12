-- Vehicle drafts system for cross-device sync
-- This allows users to save drafts that persist across devices

CREATE TABLE IF NOT EXISTS public.vehicle_drafts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  draft_name TEXT NOT NULL, -- e.g., "1985 Chevrolet K20"
  form_data JSONB NOT NULL, -- Complete form data
  image_count INTEGER DEFAULT 0,
  events JSONB DEFAULT '[]'::jsonb, -- Generated timeline events
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Prevent too many drafts per user
  CONSTRAINT max_drafts_per_user CHECK (
    (SELECT COUNT(*) FROM vehicle_drafts WHERE user_id = vehicle_drafts.user_id) <= 10
  )
);

-- Enable RLS
ALTER TABLE public.vehicle_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own drafts" ON public.vehicle_drafts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drafts" ON public.vehicle_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drafts" ON public.vehicle_drafts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own drafts" ON public.vehicle_drafts
  FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_vehicle_drafts_user_id ON public.vehicle_drafts(user_id);
CREATE INDEX idx_vehicle_drafts_updated_at ON public.vehicle_drafts(updated_at DESC);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_vehicle_draft_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vehicle_drafts_timestamp
  BEFORE UPDATE ON public.vehicle_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_draft_timestamp();
