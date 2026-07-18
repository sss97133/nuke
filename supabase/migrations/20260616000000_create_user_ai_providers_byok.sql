-- BYOK storage — create user_ai_providers (it was never applied to prod).
--
-- The original 20250125000003 migration (and the 20250125000021 google/gemini update) defined
-- this table, but it does not exist in production — so getUserApiKey() always fell through to the
-- system env key, and BYOK ("connect your Claude/ChatGPT/Gemini subscription") silently did
-- nothing. The frontend (AIProviderSettings.tsx, Capsule "API Access" tab) and getUserApiKey both
-- already target this table; this just makes it real. Provider set includes google + gemini
-- (the 021 update) up front. Idempotent.

CREATE TABLE IF NOT EXISTS public.user_ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'gemini', 'custom')),
  api_key_encrypted TEXT NOT NULL,
  model_name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  cost_per_request_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ai_providers_user_id ON public.user_ai_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_providers_active ON public.user_ai_providers(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_ai_providers_default ON public.user_ai_providers(user_id, is_default) WHERE is_default = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ai_providers_one_default ON public.user_ai_providers(user_id) WHERE is_default = true AND is_active = true;

ALTER TABLE public.user_ai_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own AI providers" ON public.user_ai_providers;
CREATE POLICY "Users can manage own AI providers" ON public.user_ai_providers
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.user_ai_providers IS
  'BYOK: a user''s connected AI provider keys (Claude/ChatGPT/Gemini). Resolved by getUserApiKey (user-key-first). api_key_encrypted is base64 (matches getUserApiKey atob decode). The caller''s key pays for their own inference.';
