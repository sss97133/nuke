-- Bad-actor detection — the point of the whole thing.
--
-- People butter up asset books when selling (inflate hp, roll back miles, fake provenance).
-- A working evidence+reputation system makes that EASY to catch: the liar's self-serving claim
-- contradicts the weighted-evidence consensus, and the contradiction is the tell. This surface
-- scores exactly that pattern — a low-trust contributor asserting a value that contradicts the
-- higher-evidence consensus, weighted up when the asset is FOR SALE (motive) and when the claim
-- INFLATES a value-bearing number (means). The fraud catches itself; we just rank the smoke.

CREATE OR REPLACE FUNCTION public.flag_suspicious_claims(
  p_vehicle_id uuid DEFAULT NULL,
  p_min_score numeric DEFAULT 0.15
)
RETURNS TABLE(
  vehicle_id uuid, attribute text, contributor text, contributor_trust numeric,
  claimed jsonb, consensus jsonb, evidence_class text, for_sale boolean,
  inflates boolean, suspicion_score numeric, reason text
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH claims AS (
    SELECT pe.id,
           (pe.request_envelope->>'subject_id')::uuid AS vid,
           pe.request_envelope->>'attribute' AS attr,
           pe.result_envelope->'label'  AS claimed_label,
           pe.result_envelope->>'label' AS claimed_text,
           pe.evidence_class,
           COALESCE(mr.slug,'unknown') AS contributor,
           COALESCE(mr.base_trust,0.3) AS trust
    FROM projection_event pe
    LEFT JOIN model_registry mr ON mr.id = pe.model_id
    WHERE pe.retracted_at IS NULL
      AND (p_vehicle_id IS NULL OR pe.request_envelope->>'subject_id' = p_vehicle_id::text)
  ),
  judged AS (
    SELECT c.*,
           public.project_attribute(c.vid, c.attr) AS proj,
           v.is_for_sale,
           -- peers exist?
           (SELECT count(DISTINCT pe2.model_id) > 1 FROM projection_event pe2
             WHERE pe2.request_envelope->>'subject_id' = c.vid::text
               AND pe2.request_envelope->>'attribute' = c.attr
               AND pe2.retracted_at IS NULL) AS has_peers
    FROM claims c
    JOIN vehicles v ON v.id = c.vid
  ),
  scored AS (
    SELECT j.vid, j.attr, j.contributor, j.trust, j.claimed_label,
           j.proj->'consensus' AS consensus_label,
           j.proj->>'consensus' AS consensus_text,
           j.evidence_class, COALESCE(j.is_for_sale,false) AS for_sale,
           j.claimed_text, j.has_peers,
           -- numeric inflation (claim > consensus) where both parse as numbers
           CASE WHEN j.claimed_text ~ '^-?\d+(\.\d+)?$' AND (j.proj->>'consensus') ~ '^-?\d+(\.\d+)?$'
                THEN j.claimed_text::numeric > (j.proj->>'consensus')::numeric ELSE false END AS inflates
    FROM judged j
    WHERE j.has_peers
      AND j.claimed_text IS DISTINCT FROM (j.proj->>'consensus')  -- contradicts consensus
  )
  SELECT s.vid, s.attr, s.contributor, round(s.trust,3),
         s.claimed_label, s.consensus_label, s.evidence_class, s.for_sale, s.inflates,
         round(
           (1.0 - s.trust)                       -- low trust contributor
           * (CASE WHEN s.inflates THEN 1.4 ELSE 1.0 END)  -- inflating a number = motive
           * (CASE WHEN s.for_sale THEN 1.5 ELSE 1.0 END)  -- asset on the market = incentive
         , 3) AS suspicion_score,
         concat_ws('; ',
           s.contributor || ' (trust ' || round(s.trust,2) || ') contradicts consensus',
           CASE WHEN s.inflates THEN 'INFLATES the value' END,
           CASE WHEN s.for_sale THEN 'on a FOR-SALE asset' END,
           'cited as ' || COALESCE(s.evidence_class,'unclassified')
         ) AS reason
  FROM scored s
  WHERE (1.0 - s.trust) * (CASE WHEN s.inflates THEN 1.4 ELSE 1.0 END) * (CASE WHEN s.for_sale THEN 1.5 ELSE 1.0 END) >= p_min_score
  ORDER BY suspicion_score DESC;
END;
$$;

COMMENT ON FUNCTION public.flag_suspicious_claims(uuid, numeric) IS
  'Bad-actor catcher: ranks claims that contradict the weighted-evidence consensus, weighted up for low contributor trust, value inflation, and for-sale assets — the book-cooking signature. The fraud catches itself; this ranks the smoke. Owner/platform surface, not for external callers.';
