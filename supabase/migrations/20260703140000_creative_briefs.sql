-- creative_briefs: durable capture of a principal's creative direction.
--
-- "Record everything Philippe is saying so his agent gets better." A brief is the
-- highest-trust observation in the model: authored by the principal (top of the
-- source-trust hierarchy), it conditions how the content agent drafts posts for a
-- client. Verbatim text is preserved (raw_text) alongside a structured extraction
-- (structured) so nothing is lost and the agent has something machine-usable.
--
-- Keyed to the client org (organizations); optionally to a specific asset when the
-- direction is about one villa / venue rather than the whole account.
--
-- RLS enabled with no policies (deny-all except service_role), matching the house
-- pattern for principal/partner data. Explicit policies are deliberate follow-up.

CREATE TABLE IF NOT EXISTS public.creative_briefs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  asset_id     uuid REFERENCES public.assets(id) ON DELETE SET NULL,

  -- Provenance of the direction
  author       text NOT NULL,                       -- e.g. 'philippe' (the principal)
  channel      text NOT NULL DEFAULT 'chat'
                 CHECK (channel = ANY (ARRAY['voice','chat','meeting','manual','email'])),

  -- What was said, and what we extracted from it
  raw_text     text NOT NULL,                       -- verbatim brief / transcript
  structured   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {voice, clientele, positioning,
                                                     --  dos[], donts[], themes[], tone}
  -- Trust: principal-authored direction is high-confidence by default
  confidence   numeric(4,3) NOT NULL DEFAULT 0.9
                 CHECK (confidence >= 0 AND confidence <= 1),

  status       text NOT NULL DEFAULT 'captured'
                 CHECK (status = ANY (ARRAY['captured','processed','superseded','archived'])),
  supersedes   uuid REFERENCES public.creative_briefs(id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Latest active brief per client is the hot read for the content agent
CREATE INDEX IF NOT EXISTS creative_briefs_org_idx
  ON public.creative_briefs (org_id, created_at DESC)
  WHERE status = ANY (ARRAY['captured','processed']);

CREATE INDEX IF NOT EXISTS creative_briefs_asset_idx
  ON public.creative_briefs (asset_id, created_at DESC)
  WHERE asset_id IS NOT NULL;

ALTER TABLE public.creative_briefs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.creative_briefs IS
  'Principal creative direction per client (verbatim + structured). Highest-trust '
  'input to the concierge content agent. See docs/concierge-content-agent.md.';
