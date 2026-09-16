-- Allow xAI (Grok) as a BYOK provider — the iOS Connected-accounts surface lets a
-- user link their Grok subscription alongside ChatGPT/Claude/Gemini. Additive.
ALTER TABLE public.user_ai_providers DROP CONSTRAINT IF EXISTS user_ai_providers_provider_check;
ALTER TABLE public.user_ai_providers ADD CONSTRAINT user_ai_providers_provider_check
  CHECK (provider = ANY (ARRAY['openai','anthropic','google','gemini','xai','custom']::text[]));
