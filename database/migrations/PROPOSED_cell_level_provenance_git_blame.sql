-- =============================================================================
-- PROPOSED: Cell-level provenance — git-blame model (prototype on vehicles.owner_name)
-- =============================================================================
--
-- The gap
-- -------
-- Nuke has row-level testimony in `vehicle_observations` (source_id, observed_at,
-- confidence, is_superseded, superseded_by — never deleted). It has ZERO cell-level
-- provenance on the scalar columns of `vehicles`. On 2026-04-28 an automated sweep
-- overwrote `vehicles.owner_name` with no audit trail — no who/when/why survived.
-- Skylar's frame (memory: feedback_numbers_carry_source_dna.md): a bare scalar is
-- a schema failure. Every value should be (value, source, method, observed_at, trust).
--
-- Model picked: B (git-blame shadow table)
-- Rationale (3-5 sentences):
--   Model A (Wikipedia / view-computed columns) is the architecturally pure answer,
--   but every reader of `vehicles.owner_name` today is a scalar SELECT. Rewriting
--   them all to query a view is real work the prototype shouldn't pay for, and the
--   risk surface is wide. Model B layers an audit trigger and an INSERT-only shadow
--   table on top of the existing scalar column, so all existing readers keep working
--   unchanged while every WRITE gets a forensic row (old/new/source/agent/citation).
--   The shadow table is structurally append-only and references `vehicle_observations`
--   for the actual testimony — it does NOT become a second source of truth, just an
--   index from (vehicles.row, column_name) -> the observation that justified the cell.
--   This is the cheapest first cut that makes "owner_name overwritten with no trail"
--   structurally impossible without breaking any current consumer.
--
-- Tradeoffs accepted
-- ------------------
--   1) Dual-write risk: if the trigger ever fires-and-fails, the parent table could
--      diverge from the shadow. Mitigation: trigger raises EXCEPTION inside the
--      same transaction, so either BOTH writes commit or NEITHER does.
--   2) Shadow table growth: one row per write across all cells someday. Bounded by
--      write rate, not row count. Partition-by-month is the long-term plan; out of
--      scope for prototype.
--   3) RLS uses a request header (`x-citation-source`) — easy to fake from a service
--      role connection that bypasses RLS. The trigger ALSO enforces a non-null
--      `source` payload so service-role writes still log; RLS is defense-in-depth,
--      not the only gate.
--   4) `vehicles.owner_name` remains a TEXT column. The trigger does not enforce
--      that the value came from a real `vehicle_observations` row — the FK from
--      `vehicle_field_history.observation_id -> vehicle_observations.id` is the
--      enforcement, and it is NULLABLE in the prototype to keep backfill possible.
--      Tightening to NOT NULL is a follow-up once every writer ingests-first.
--
-- Rollback approach
-- -----------------
--   Drop the trigger, drop the RLS policy, drop the shadow table. No schema change
--   to `vehicles` itself, no data movement. See bottom of file. Rollback is
--   strictly reversible because we never touched the source-of-truth column.
--
-- Scope guard
-- -----------
--   PROTOTYPE TOUCHES ONLY `vehicles.owner_name`. Other columns are out of scope.
--   The pattern is intentionally extensible (column_name TEXT is part of the
--   shadow table key) but no other column gets a trigger until this one is reviewed.
--
-- NOT executed. Review-only. Apply via `supabase migration up` after approval.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Shadow table: vehicle_field_history
-- -----------------------------------------------------------------------------
-- One row per WRITE to a tracked cell. Append-only. Never UPDATE, never DELETE.
-- Citation rule: every row must carry source + agent + written_at. If the write
-- was driven by an observation, observation_id points back to the testimony row;
-- otherwise the trigger requires source/agent/method to be non-null.

CREATE TABLE IF NOT EXISTS public.vehicle_field_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  field_name      text NOT NULL,                   -- 'owner_name' for the prototype
  old_value       text,                            -- previous value (TEXT projection)
  new_value       text,                            -- new value (TEXT projection)

  -- Provenance tuple (mirrors vehicle_observations DNA — the testimony rule)
  observation_id  uuid REFERENCES public.vehicle_observations(id),  -- nullable: backfill-friendly
  source          text NOT NULL,                   -- e.g. 'agent:ralph-wiggum', 'bat-extractor', 'manual:skylar'
  method          text,                            -- 'sweep', 'manual', 'ai-extract', 'user-edit', 'backfill'
  agent_id        text,                            -- session/agent identifier (PPID, function-version, etc.)
  session_id      text,                            -- claude session UUID when applicable
  citation_url    text,                            -- link to the document/listing/page
  trust           numeric,                         -- 0..1, mirrors vehicle_observations.confidence_score
  observed_at     timestamptz,                     -- when the underlying fact was observed (NOT the write)

  -- Bookkeeping
  written_at      timestamptz NOT NULL DEFAULT now(),
  written_by      text,                            -- DB role / PostgREST identity if available
  supersedes_id   uuid REFERENCES public.vehicle_field_history(id),  -- prior shadow row this overrides

  -- Defense-in-depth: cannot insert a row with neither citation nor observation
  CONSTRAINT vfh_must_cite CHECK (
    observation_id IS NOT NULL
    OR source IS NOT NULL
  )
);

COMMENT ON TABLE public.vehicle_field_history IS
  'Cell-level audit / git-blame for tracked columns on vehicles. Append-only. '
  'Never UPDATE, never DELETE (testimony invariant — see .claude/rules/agent-trust-invariants.md). '
  'Prototype: tracks only vehicles.owner_name. Extend by adding a trigger for the next column.';

CREATE INDEX IF NOT EXISTS idx_vfh_vehicle_field_time
  ON public.vehicle_field_history (vehicle_id, field_name, written_at DESC);

CREATE INDEX IF NOT EXISTS idx_vfh_observation
  ON public.vehicle_field_history (observation_id)
  WHERE observation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vfh_source
  ON public.vehicle_field_history (source);

-- -----------------------------------------------------------------------------
-- 2) Trigger: log every write to vehicles.owner_name
-- -----------------------------------------------------------------------------
-- Fires on INSERT and UPDATE. UPDATEs only log when the value actually changed
-- (IS DISTINCT FROM handles NULL transitions). Citation is read from PostgREST
-- request headers; service-role / direct-SQL writes must SET the GUC explicitly:
--
--   SELECT set_config('request.headers',
--     '{"x-citation-source":"agent:ralph-wiggum","x-citation-method":"sweep"}', true);
--
-- If no citation is present, the write is BLOCKED. This is the structural
-- replacement for "bare scalar overwrite with no trail."

CREATE OR REPLACE FUNCTION public.log_vehicle_owner_name_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_headers       jsonb;
  v_source        text;
  v_method        text;
  v_agent_id      text;
  v_session_id    text;
  v_citation_url  text;
  v_observation   uuid;
  v_trust         numeric;
  v_observed_at   timestamptz;
BEGIN
  -- Skip when value didn't actually change on UPDATE
  IF TG_OP = 'UPDATE' AND NEW.owner_name IS NOT DISTINCT FROM OLD.owner_name THEN
    RETURN NEW;
  END IF;

  -- Read citation from PostgREST headers (Supabase pattern).
  -- For service-role / direct psql writes, the caller must set this GUC.
  v_headers := COALESCE(
    NULLIF(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );

  v_source       := v_headers ->> 'x-citation-source';
  v_method       := v_headers ->> 'x-citation-method';
  v_agent_id     := v_headers ->> 'x-citation-agent';
  v_session_id   := v_headers ->> 'x-citation-session';
  v_citation_url := v_headers ->> 'x-citation-url';
  v_observation  := NULLIF(v_headers ->> 'x-citation-observation-id','')::uuid;
  v_trust        := NULLIF(v_headers ->> 'x-citation-trust','')::numeric;
  v_observed_at  := NULLIF(v_headers ->> 'x-citation-observed-at','')::timestamptz;

  -- HARD GATE: no citation, no write. This is the rule the feedback memory demands.
  -- (Backfill from existing state happens AFTER this trigger is created — see §3 —
  -- and uses a session-level GUC override to mark backfill rows.)
  IF v_source IS NULL AND v_observation IS NULL THEN
    RAISE EXCEPTION
      'vehicles.owner_name write rejected: no citation provided. '
      'Set request header x-citation-source (or x-citation-observation-id) before writing. '
      'See feedback_numbers_carry_source_dna.md.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.vehicle_field_history (
    vehicle_id, field_name,
    old_value, new_value,
    observation_id, source, method, agent_id, session_id, citation_url,
    trust, observed_at, written_by
  ) VALUES (
    NEW.id, 'owner_name',
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.owner_name ELSE NULL END,
    NEW.owner_name,
    v_observation, v_source, v_method, v_agent_id, v_session_id, v_citation_url,
    v_trust, v_observed_at, current_user
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_vehicle_owner_name_change ON public.vehicles;
CREATE TRIGGER trg_log_vehicle_owner_name_change
  BEFORE INSERT OR UPDATE OF owner_name ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_vehicle_owner_name_change();

-- -----------------------------------------------------------------------------
-- 3) Backfill: one shadow row per existing vehicle with owner_name set
-- -----------------------------------------------------------------------------
-- Pre-populate vehicle_field_history from current state. We mark these rows
-- with source='backfill:pre-provenance' so the timeline shows a clear "we
-- started tracking here" anchor. If a matching `vehicle_observations` row of
-- kind='ownership' exists for the same vehicle, link to it.
--
-- We have to bypass the citation gate for this one-time backfill — use a
-- session-level GUC so the trigger's header read picks it up.

SELECT set_config(
  'request.headers',
  '{"x-citation-source":"backfill:pre-provenance","x-citation-method":"backfill","x-citation-agent":"migration_PROPOSED_cell_level_provenance_git_blame"}',
  true
);

-- Insert backfill rows DIRECTLY into the shadow table (not through the trigger,
-- since that fires on the parent UPDATE and we don't want to touch the parent).
-- Each backfilled vehicle gets one row representing "this is the value we
-- started tracking with — provenance unknown before this point."
INSERT INTO public.vehicle_field_history (
  vehicle_id, field_name, old_value, new_value,
  observation_id, source, method, agent_id,
  trust, observed_at, written_at
)
SELECT
  v.id,
  'owner_name',
  NULL,                          -- no prior value known
  v.owner_name,                  -- current value
  -- Try to link to an ownership observation if one exists
  (
    SELECT o.id
    FROM public.vehicle_observations o
    WHERE o.vehicle_id = v.id
      AND o.kind = 'ownership'
      AND COALESCE(o.is_superseded, false) = false
    ORDER BY o.observed_at DESC NULLS LAST
    LIMIT 1
  ),
  'backfill:pre-provenance',
  'backfill',
  'migration_PROPOSED_cell_level_provenance_git_blame',
  NULL,                          -- trust unknown for backfilled rows
  NULL,                          -- observed_at unknown
  now()
FROM public.vehicles v
WHERE v.owner_name IS NOT NULL
  -- Idempotent: don't re-backfill if a row already exists for this cell
  AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_field_history h
    WHERE h.vehicle_id = v.id AND h.field_name = 'owner_name'
  );

-- -----------------------------------------------------------------------------
-- 4) RLS: shadow table is read-by-authenticated, write-by-trigger-only
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicle_field_history ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can read history for vehicles they can already see.
-- (Defer to vehicles RLS — if you can read the vehicle, you can read its blame.)
DROP POLICY IF EXISTS vfh_read_authenticated ON public.vehicle_field_history;
CREATE POLICY vfh_read_authenticated
  ON public.vehicle_field_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_field_history.vehicle_id
    )
  );

-- Write: nobody writes directly. Only the SECURITY INVOKER trigger inserts rows
-- (and the backfill block above, which ran during migration). Block all
-- non-trigger writes from non-service-role.
DROP POLICY IF EXISTS vfh_no_direct_write ON public.vehicle_field_history;
CREATE POLICY vfh_no_direct_write
  ON public.vehicle_field_history
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- UPDATE/DELETE: hard-blocked by the testimony invariant. No policy = no access.
-- (The table never gets UPDATE or DELETE policies. This is intentional and
-- enforced by .claude/rules/agent-trust-invariants.md.)

-- -----------------------------------------------------------------------------
-- 5) git-blame function: per-cell history reconstruction
-- -----------------------------------------------------------------------------
-- Returns the full write history for one cell, newest first. The "blame" for
-- the current value is the first row.

CREATE OR REPLACE FUNCTION public.vehicle_field_blame(
  p_vehicle_id uuid,
  p_field_name text DEFAULT 'owner_name'
)
RETURNS TABLE (
  written_at      timestamptz,
  old_value       text,
  new_value       text,
  source          text,
  method          text,
  agent_id        text,
  citation_url    text,
  observation_id  uuid,
  trust           numeric,
  observed_at     timestamptz,
  history_id      uuid
)
LANGUAGE sql
STABLE
AS $$
  SELECT h.written_at, h.old_value, h.new_value, h.source, h.method,
         h.agent_id, h.citation_url, h.observation_id, h.trust, h.observed_at, h.id
  FROM public.vehicle_field_history h
  WHERE h.vehicle_id = p_vehicle_id
    AND h.field_name = p_field_name
  ORDER BY h.written_at DESC;
$$;

COMMENT ON FUNCTION public.vehicle_field_blame IS
  'git-blame for vehicles.<field>. Returns full write history newest-first. '
  'The first row is the blame for the current value.';

COMMIT;

-- =============================================================================
-- ROLLBACK (run as a separate transaction if you need to undo this migration)
-- =============================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.vehicle_field_blame(uuid, text);
--   DROP TRIGGER IF EXISTS trg_log_vehicle_owner_name_change ON public.vehicles;
--   DROP FUNCTION IF EXISTS public.log_vehicle_owner_name_change();
--   -- NOTE: dropping vehicle_field_history destroys audit rows. Only do this if
--   -- you're rolling back the prototype entirely. Per the testimony invariant
--   -- (agent-trust-invariants.md), if you've shipped this and have real audit
--   -- data, prefer to KEEP the table and only drop the trigger.
--   DROP TABLE IF EXISTS public.vehicle_field_history;
-- COMMIT;
-- =============================================================================
