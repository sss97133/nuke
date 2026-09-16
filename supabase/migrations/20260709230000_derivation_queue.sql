-- The derivation loop: evidence in, cited claims out, continuously.
--
-- WHY A NEW TABLE (platform-hygiene rule requires the justification)
-- `analysis_queue` computes widgets for a vehicle. `ai_processing_queue` runs image
-- AI. `research_queue` drives web search. `document_ocr_queue` is keyed to
-- deal_document_id. None of them models "a piece of the USER'S OWN evidence that a
-- registered extractor has not yet read." That unit is what turns Nuke from a system
-- that is TOLD what is true into one that CONCLUDES what is true.
--
-- The registry already exists: `observation_extractors` (slug, edge_function_name,
-- produces_kinds, schedule, rate limits). It has five rows, all for other people's
-- marketplaces, and `last_run_at` is null on every one — nothing has ever driven it.
-- This queue is what drives it, for the user's own evidence.
--
-- THE LOOP
--   evidence lands (upload, sync, photo)      -> trigger enqueues a work item
--   cron / agent drains the queue             -> derive-dispatch claims a batch
--   dispatch invokes observation_extractors.edge_function_name AS THE USER
--     (runWithChain: their subscription -> their key -> platform metered)
--   the extractor emits observations through ingest-observation, cited
--   analysis-engine-coordinator recomputes what depends on them
--
-- Nothing here writes a projection. Projections stay computed.

CREATE TABLE IF NOT EXISTS public.derivation_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose evidence, and therefore whose compute pays for reading it.
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What piece of evidence. Polymorphic on purpose: a title, a photo, a bank row and
  -- a text message are all testimony, and each has its own home table.
  evidence_type  text NOT NULL CHECK (evidence_type IN (
                   'secure_document','vehicle_image','receipt','qb_transaction',
                   'imessage_conversation','email','artifact')),
  evidence_id    uuid NOT NULL,

  -- Which reader. FK to the registry so an extractor cannot be invented ad hoc.
  extractor_slug text NOT NULL REFERENCES public.observation_extractors(slug),

  -- Who asked. 'agent' means a user said something in the Ask panel and the agent
  -- turned it into work — that is the app receiving a message and acting on it.
  requested_by   text NOT NULL DEFAULT 'trigger'
                   CHECK (requested_by IN ('trigger','cron','agent','user','backfill')),
  request_note   text,

  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','claimed','done','failed','skipped')),
  priority       int  NOT NULL DEFAULT 100,

  attempts       int  NOT NULL DEFAULT 0,
  max_attempts   int  NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at      timestamptz,
  locked_by      text,

  -- What the derivation produced. The audit trail from evidence to claim.
  observation_ids uuid[],
  cost_cents     numeric,
  credential_source text,          -- subscription | user_api_key | system_api_key
  error_message  text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,

  -- One reader reads one piece of evidence once. Re-running converges (the extractor
  -- and ingest-observation both dedupe on content), but the QUEUE should not fan out.
  UNIQUE (evidence_type, evidence_id, extractor_slug)
);

COMMENT ON TABLE public.derivation_queue IS
  'Work items pairing a piece of the user''s own evidence with a registered extractor in observation_extractors. Drained by derive-dispatch, which runs the extractor on the USER''S compute. Produces cited observations; never writes projections.';

-- The drain query: pending, due, highest priority, oldest first.
CREATE INDEX IF NOT EXISTS idx_derivation_queue_drain
  ON public.derivation_queue (status, next_attempt_at, priority, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_derivation_queue_user
  ON public.derivation_queue (user_id, status);

-- Owner-scoped: a user sees the work being done on their own evidence, and nothing
-- else. Writes belong to the trigger and to service_role; a user cannot enqueue jobs
-- on someone else's evidence, and cannot mark their own work done.
ALTER TABLE public.derivation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY derivation_queue_owner_read ON public.derivation_queue
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY derivation_queue_service_all ON public.derivation_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.derivation_queue FROM anon, PUBLIC;
GRANT SELECT ON public.derivation_queue TO authenticated;
