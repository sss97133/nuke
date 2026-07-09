-- Let a user's connected Claude subscription actually persist.
--
-- `connect-claude` + `_shared/claudeSubscriptionAuth.storeSubscriptionToken()` write
-- `user_ai_providers.provider = 'anthropic_subscription'`. The CHECK constraint in
-- prod did not permit that value, so EVERY subscription connect failed with a
-- check_violation. The Connect Claude button could never have worked, and the
-- funnel in resolveClaudeAuth() could never find a subscription to run on.
--
-- The code comment in claudeSubscriptionAuth.ts claimed "`provider` is unconstrained
-- text" — it is not. Verified against prod 2026-07-09:
--   CHECK (provider = ANY (ARRAY['openai','anthropic','google','gemini','xai','custom']))
--
-- NOTE: prod had drifted from 20260616000000_create_user_ai_providers_byok.sql, which
-- omits 'xai'. The list below is prod's actual set plus the new value — do not
-- regenerate it from the older migration or you will drop 'xai'.
--
-- Additive only: widens the accepted set. No rows are touched; nothing that
-- validated before stops validating.

ALTER TABLE public.user_ai_providers
  DROP CONSTRAINT IF EXISTS user_ai_providers_provider_check;

ALTER TABLE public.user_ai_providers
  ADD CONSTRAINT user_ai_providers_provider_check
  CHECK (provider = ANY (ARRAY[
    'openai'::text,
    'anthropic'::text,              -- BYOK API key (sk-ant-api…)
    'anthropic_subscription'::text, -- Claude Max/Pro OAuth bundle (StoredSubscriptionToken JSON)
    'google'::text,
    'gemini'::text,
    'xai'::text,
    'custom'::text
  ]));

COMMENT ON COLUMN public.user_ai_providers.api_key_encrypted IS
  'AES-256-GCM blob ("enc:v1:"+base64(iv||ct)) via _shared/secretBox.ts; legacy plain-base64 still decodes. For provider=anthropic_subscription this is an encrypted StoredSubscriptionToken JSON bundle, not a bare key. Decrypt with decryptSecret() — never atob().';
