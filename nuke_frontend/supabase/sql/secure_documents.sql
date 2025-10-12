-- Secure documents + PII audit schema used by secureDocumentService

BEGIN;

-- Tables
CREATE TABLE IF NOT EXISTS public.secure_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type      text NOT NULL,
  file_hash          text NOT NULL,
  file_size          integer NOT NULL,
  mime_type          text,
  storage_path       text NOT NULL,
  upload_metadata    jsonb,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected')),
  verified_by        uuid REFERENCES auth.users(id),
  verified_at        timestamptz,
  retention_until    timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secure_documents_user ON public.secure_documents(user_id);

CREATE TABLE IF NOT EXISTS public.pii_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accessed_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text,
  ip_address     text,
  user_agent     text,
  access_reason  text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pii_audit_user ON public.pii_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_pii_audit_accessed_by ON public.pii_audit_log(accessed_by);

-- RPC to log PII access actions
CREATE OR REPLACE FUNCTION public.log_pii_access(
  p_user_id       uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   text,
  p_access_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  -- The actor is the current auth uid if available
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  INSERT INTO public.pii_audit_log (user_id, accessed_by, action, resource_type, resource_id, ip_address, user_agent, access_reason)
  VALUES (
    p_user_id,
    COALESCE(v_actor, p_user_id),
    p_action,
    p_resource_type,
    p_resource_id,
    NULL,
    NULL,
    p_access_reason
  );
END;
$$;

COMMIT;
