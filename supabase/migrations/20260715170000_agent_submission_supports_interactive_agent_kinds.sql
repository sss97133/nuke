-- Extend the `agent-submission` observation source to cover the full kind set the
-- interactive vehicle-agent emits, so its writes can route through the canonical
-- `ingest-observation` rail instead of a raw INSERT into vehicle_observations
-- (the testimony-trust-invariant violation the ratchet gate flagged on 2026-07-15,
-- inherited from PR #298).
--
-- agent-submission already supports {work_record, condition, specification, media,
-- comment, expert_opinion, sighting}. The interactive agent (supabase/functions/
-- vehicle-agent) also records valuation / provenance / ownership / activity. This is
-- PURELY ADDITIVE (array append, de-duplicated) — no existing caller's kind is removed,
-- so nothing that writes through agent-submission today can break.
--
-- Note on `ownership`/`provenance` at a 0.55 machine-trust source: this records an
-- ownership/provenance OBSERVATION (testimony), which is distinct from ownership
-- PROMOTION (vehicle_user_permissions grants) — the latter stays gated by the
-- god-write hook and the ownership-evidence path. Routing these through ingest-observation
-- is strictly better than the raw insert it replaces: it adds content-hash dedup and
-- confidence/trust scoring the raw path skipped.

update observation_sources
set supported_observations = (
  select array(
    select distinct unnest(
      coalesce(supported_observations, '{}'::observation_kind[]) ||
      array['valuation','provenance','ownership','activity']::observation_kind[]
    )
  )
)
where slug = 'agent-submission';
