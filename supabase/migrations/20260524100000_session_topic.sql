-- Session classification index — maps Claude Code session JSONLs to primary topic
-- and to vehicle / person / org IDs they touched.
--
-- Agent-layer metadata, not user substrate. Lets queries like:
--   SELECT * FROM session_topic
--   WHERE 'e08bf694-970f-4cbe-8a74-8715158a0f2e' = ANY(vehicle_ids)
--   ORDER BY modified_at DESC;
-- power per-vehicle session feeds on the vehicle profile.
--
-- Provenance: every row cites the source JSONL path. Classification method is
-- recorded so future re-passes can supersede earlier guesses.

CREATE TABLE IF NOT EXISTS public.session_topic (
  session_id              TEXT PRIMARY KEY,            -- JSONL filename (without .jsonl)
  project_dir             TEXT NOT NULL,               -- which ~/.claude/projects/ dir
  jsonl_path              TEXT NOT NULL,               -- absolute path to source artifact

  first_prompt            TEXT,
  modified_at             TIMESTAMPTZ,
  turn_count              INT,

  primary_topic           TEXT NOT NULL,               -- vehicle:k5_blazer_1977 / finance:taxes / etc.
  secondary_topics        TEXT[] DEFAULT '{}',

  vehicle_ids             UUID[] DEFAULT '{}',         -- vehicles mentioned (denormalized for join)
  person_ids              UUID[] DEFAULT '{}',
  organization_ids        UUID[] DEFAULT '{}',

  classification_confidence FLOAT,                     -- 0-1; < 0.6 = manual review bucket
  classification_method   TEXT,                        -- 'firstPrompt_keyword' / 'first_5_turns_llm' / 'manual_override'

  classified_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_topic_primary_topic_idx
  ON public.session_topic (primary_topic);

CREATE INDEX IF NOT EXISTS session_topic_modified_at_idx
  ON public.session_topic (modified_at DESC);

CREATE INDEX IF NOT EXISTS session_topic_vehicle_ids_gin_idx
  ON public.session_topic USING gin (vehicle_ids);

CREATE INDEX IF NOT EXISTS session_topic_person_ids_gin_idx
  ON public.session_topic USING gin (person_ids);

CREATE INDEX IF NOT EXISTS session_topic_organization_ids_gin_idx
  ON public.session_topic USING gin (organization_ids);

CREATE INDEX IF NOT EXISTS session_topic_confidence_idx
  ON public.session_topic (classification_confidence)
  WHERE classification_confidence < 0.6;

COMMENT ON TABLE public.session_topic IS
  'Classification of Claude Code session JSONLs by primary topic. Agent-layer metadata. '
  'Lets vehicle profiles surface a chronological feed of sessions that discussed them. '
  'Built by session-classifier agent.';
