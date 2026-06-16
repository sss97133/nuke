-- Phase 3 — attribution, confidence, reputation, conflict surfacing.
--
-- The north star is ACCURACY, and accuracy emerges at scale: anyone* can submit an
-- evidence-cited claim, and the canonical value is the WEIGHTED CONSENSUS of all
-- non-retracted claims — weighted by evidence class × contributor reputation × recency
-- × corroboration. No single contributor (and no single bad actor) decides the truth;
-- the crowd, weighted by earned trust, does. Contradictions surface as conflicts, never
-- silently overwrite. A liar's claims accumulate as down-weighted liabilities against them.

-- Evidence-class tier weight. Primary evidence (a document, a VIN decode, a photo of the
-- thing) outweighs an owner's bare assertion, which is upgradable but lowest.
CREATE OR REPLACE FUNCTION public.nuke_evidence_weight(p_class text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_class
    WHEN 'document'      THEN 1.00
    WHEN 'vin_decode'    THEN 1.00
    WHEN 'image'         THEN 0.90
    WHEN 'context_atoms' THEN 0.60
    WHEN 'owner_claim'   THEN 0.45
    ELSE 0.25  -- null / legacy / unknown class
  END;
$$;

-- The consensus engine. Returns the weighted-winner value for one (subject, attribute),
-- its support, corroboration (distinct contributors), whether it's CONFLICTED (a runner-up
-- with comparable support), and the full candidate breakdown with per-contributor weights.
CREATE OR REPLACE FUNCTION public.project_attribute(p_subject_id uuid, p_attribute text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v jsonb;
BEGIN
  WITH atoms AS (
    SELECT pe.id,
           pe.result_envelope->'label'             AS label,
           pe.result_envelope->>'label'            AS label_text,
           pe.evidence_class,
           COALESCE((pe.result_envelope->>'confidence')::numeric, 0.5) AS confidence,
           COALESCE(mr.base_trust, 0.3)            AS actor_trust,
           COALESCE(mr.slug, 'unknown')           AS actor,
           pe.observed_at,
           greatest(0.3, 1.0 - (extract(epoch FROM (now() - pe.observed_at)) / (3*365*86400.0))) AS recency
    FROM projection_event pe
    LEFT JOIN model_registry mr ON mr.id = pe.model_id
    WHERE pe.request_envelope->>'subject_id' = p_subject_id::text
      AND pe.request_envelope->>'attribute'  = p_attribute
      AND pe.retracted_at IS NULL
  ),
  weighted AS (
    SELECT *, public.nuke_evidence_weight(evidence_class) * actor_trust * confidence * recency AS weight
    FROM atoms
  ),
  tally AS (
    SELECT label_text, min(label::text)::jsonb AS label,
           sum(weight) AS support, count(*) AS n, count(DISTINCT actor) AS distinct_actors,
           jsonb_agg(jsonb_build_object(
             'actor', actor, 'evidence_class', evidence_class,
             'confidence', confidence, 'weight', round(weight, 4), 'observed_at', observed_at
           ) ORDER BY weight DESC) AS contributors
    FROM weighted GROUP BY label_text
  ),
  ranked AS (SELECT *, row_number() OVER (ORDER BY support DESC) AS rk FROM tally)
  SELECT jsonb_build_object(
    'subject_id', p_subject_id,
    'attribute', p_attribute,
    'consensus', (SELECT label FROM ranked WHERE rk = 1),
    'consensus_support', (SELECT round(support, 4) FROM ranked WHERE rk = 1),
    'total_support', (SELECT round(coalesce(sum(support),0), 4) FROM tally),
    'corroboration', (SELECT distinct_actors FROM ranked WHERE rk = 1),
    'distinct_values', (SELECT count(*) FROM tally),
    'observation_count', (SELECT coalesce(sum(n),0) FROM tally),
    'conflict', COALESCE(
      (SELECT (SELECT support FROM ranked WHERE rk = 2)
              / NULLIF((SELECT support FROM ranked WHERE rk = 1), 0) > 0.5), false),
    'candidates', (SELECT jsonb_agg(jsonb_build_object(
        'value', label, 'support', round(support, 4),
        'distinct_actors', distinct_actors, 'contributors', contributors
      ) ORDER BY support DESC) FROM tally)
  ) INTO v;
  RETURN v;
END;
$$;

-- Reputation movement. A contributor's trust rises when its claims AGREE with the weighted
-- consensus of OTHER contributors, and falls when it contradicts them. Only claims that have
-- peers (corroboration possible) move the needle — a lone voice stays at base. This is what
-- makes the open write API safe: bad actors get tracked and down-weighted, reversibly.
-- NOTE: OUT params are prefixed (o_*) and CTE columns aliased to avoid plpgsql name
-- collisions with table columns (model_id/slug). full_consensus is the WEIGHTED consensus
-- over ALL claims (incl. self) — evidence weighting means a lone low-tier claim can't tip it.
DROP FUNCTION IF EXISTS public.recompute_model_reputation(uuid);
CREATE FUNCTION public.recompute_model_reputation(p_model_id uuid DEFAULT NULL)
RETURNS TABLE(o_model_id uuid, o_slug text, o_new_trust numeric, o_agreements bigint, o_disagreements bigint)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH my_claims AS (
    SELECT pe.id, pe.model_id AS mid,
           pe.request_envelope->>'subject_id' AS subject_id,
           pe.request_envelope->>'attribute'  AS attribute,
           pe.result_envelope->>'label'       AS my_label
    FROM projection_event pe
    WHERE pe.retracted_at IS NULL
      AND (p_model_id IS NULL OR pe.model_id = p_model_id)
      AND pe.model_id IS NOT NULL
  ),
  judged AS (
    SELECT c.mid,
           (public.project_attribute(c.subject_id::uuid, c.attribute)->>'consensus') AS full_consensus,
           c.my_label,
           (SELECT count(DISTINCT pe2.model_id) FROM projection_event pe2
             WHERE pe2.request_envelope->>'subject_id' = c.subject_id
               AND pe2.request_envelope->>'attribute' = c.attribute
               AND pe2.retracted_at IS NULL AND pe2.model_id <> c.mid) AS peers
    FROM my_claims c
  ),
  scored AS (
    SELECT mid,
      count(*) FILTER (WHERE peers > 0 AND full_consensus = my_label)  AS agr,
      count(*) FILTER (WHERE peers > 0 AND full_consensus <> my_label) AS dis
    FROM judged GROUP BY mid
  ),
  upd AS (
    UPDATE model_registry mr
       SET base_trust = CASE WHEN s.agr + s.dis = 0 THEN mr.base_trust  -- no peers: unchanged
             ELSE least(0.95, greatest(0.10, round(0.15 + 0.75 * (s.agr::numeric/(s.agr+s.dis)), 3))) END,
           last_seen = now()
      FROM scored s WHERE mr.id = s.mid
      RETURNING mr.id AS rid, mr.slug AS rslug, mr.base_trust AS rtrust, s.agr AS ragr, s.dis AS rdis
  )
  SELECT upd.rid, upd.rslug, upd.rtrust, upd.ragr, upd.rdis FROM upd;
END;
$$;

COMMENT ON FUNCTION public.project_attribute(uuid, text) IS
  'Phase 3 consensus engine: weighted-consensus value for one (subject, attribute) over all non-retracted claims. weight = evidence_class × actor reputation × confidence × recency. Surfaces conflict (comparable runner-up) and full per-contributor breakdown. The read-side truth the wiki renders.';
COMMENT ON FUNCTION public.recompute_model_reputation(uuid) IS
  'Phase 3 reputation: moves model_registry.base_trust by agreement-with-peer-consensus rate. Claims without peers do not move trust. Down-weights contradicted contributors; reversible.';
