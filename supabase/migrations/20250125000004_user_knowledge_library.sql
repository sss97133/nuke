-- User Knowledge Library Table
-- Allows users to save and organize knowledge articles

BEGIN;

CREATE TABLE IF NOT EXISTS user_knowledge_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  tags TEXT[] DEFAULT '{}',
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_knowledge_user_id ON user_knowledge_library(user_id);
CREATE INDEX IF NOT EXISTS idx_user_knowledge_public ON user_knowledge_library(user_id, is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_user_knowledge_category ON user_knowledge_library(category);
CREATE INDEX IF NOT EXISTS idx_user_knowledge_tags ON user_knowledge_library USING GIN(tags);

-- Enable RLS
ALTER TABLE user_knowledge_library ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage their own articles, anyone can view public articles
CREATE POLICY "Users can manage own knowledge articles" ON user_knowledge_library
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view public knowledge articles" ON user_knowledge_library
  FOR SELECT
  USING (is_public = true);

COMMIT;

