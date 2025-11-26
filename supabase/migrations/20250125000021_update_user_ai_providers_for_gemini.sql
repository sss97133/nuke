-- ==========================================================================
-- UPDATE USER_AI_PROVIDERS TO SUPPORT GOOGLE GEMINI
-- ==========================================================================

-- Update provider check constraint to include 'gemini'
ALTER TABLE user_ai_providers 
  DROP CONSTRAINT IF EXISTS user_ai_providers_provider_check;

ALTER TABLE user_ai_providers
  ADD CONSTRAINT user_ai_providers_provider_check 
  CHECK (provider IN ('openai', 'anthropic', 'google', 'gemini'));

COMMENT ON TABLE user_ai_providers IS 'Stores user-provided API keys for AI providers. Users pay for platform access, then use their own API keys for processing.';

