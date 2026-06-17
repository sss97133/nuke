-- Engagement primitive — the unified user→graph contribution grammar (v1).
--
-- The system ALREADY models engagement as typed observations: vehicle_observations.kind
-- enumerates {comment, bid, sighting, work_record, media, specification, condition,
-- provenance, valuation, ownership, listing, sale_result, social_mention, expert_opinion}
-- with structured_data (jsonb) as payload + observer + trust + provenance + supersession.
-- The gap was never the model — users had NO write path into it (agent-fed only), and
-- ~28 bespoke islands (six comment tables, the bid tables, user_contributions) duplicated it.
--
-- record_interaction is ONE entrypoint that routes a signed-in user's action by tier:
--   SIGNAL (follow/save/view)                  -> user_interactions (telemetry, no graph change)
--   TESTIMONY/CONTRIBUTION (comment/sighting/   -> vehicle_observations (the spine), authored by
--     media/condition/specification)              the user, trust-weighted, dedup'd, provenanced.
-- It generalizes add_photo_comment (the proven owner-gated kind=comment writer) to any
-- signed-in user across multiple kinds; per-kind access is enforced here ("the exact access").

-- A user-input observation source, distinct from owner-input (copies a valid category).
INSERT INTO observation_sources (slug, display_name, category)
SELECT 'user-input', 'User input', category FROM observation_sources WHERE slug = 'owner-input'
ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_interaction(
  p_kind text, p_target_type text, p_target_id uuid, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_source uuid;
  v_text   text;
  v_hash   text;
  v_obs_id uuid;
  v_exists uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auth_required');
  END IF;

  -- ── SIGNAL tier — telemetry, no graph change. Follow toggles. ──────────────
  IF p_kind IN ('follow','save','view') THEN
    IF p_kind = 'follow' THEN
      SELECT id INTO v_exists FROM user_interactions
       WHERE user_id = v_uid AND interaction_type = 'follow'
         AND target_type = p_target_type AND target_id = p_target_id::text
       LIMIT 1;
      IF v_exists IS NOT NULL THEN
        DELETE FROM user_interactions WHERE id = v_exists;
        RETURN jsonb_build_object('ok', true, 'kind', 'follow', 'following', false);
      END IF;
    END IF;
    INSERT INTO user_interactions (user_id, interaction_type, target_type, target_id, context)
    VALUES (v_uid, p_kind, p_target_type, p_target_id::text, coalesce(p_payload, '{}'::jsonb));
    RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'following', p_kind = 'follow');
  END IF;

  -- ── TESTIMONY / CONTRIBUTION tier — lands on the spine as a typed observation ─
  IF p_kind IN ('comment','sighting','media','condition','specification') THEN
    IF p_target_type <> 'vehicle' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unsupported_target');
    END IF;
    v_text := btrim(coalesce(p_payload->>'text', ''));
    IF p_kind = 'comment' AND length(v_text) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'empty');
    END IF;

    SELECT id INTO v_source FROM observation_sources WHERE slug = 'user-input';
    IF v_source IS NULL THEN SELECT id INTO v_source FROM observation_sources WHERE slug = 'owner-input'; END IF;

    -- Dedup an identical authored payload on the same subject by the same author.
    v_hash := md5('user_interaction|'||p_kind||'|'||p_target_id::text||'|'||v_uid::text||'|'||coalesce(nullif(v_text,''), p_payload::text));
    SELECT id INTO v_obs_id FROM vehicle_observations WHERE content_hash = v_hash LIMIT 1;
    IF v_obs_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'observation_id', v_obs_id, 'duplicate', true);
    END IF;

    -- NB: observer_id FKs external_identities (not users) — author attribution
    -- rides on submitted_by_user_id (the user FK) + observer_raw, like add_photo_comment.
    INSERT INTO vehicle_observations (
      vehicle_id, observed_at, source_id, kind, content_text, content_hash,
      structured_data, confidence, confidence_score,
      submitted_by_user_id, observer_raw
    ) VALUES (
      p_target_id, now(), v_source, p_kind::observation_kind,
      nullif(v_text, ''), v_hash,
      coalesce(p_payload, '{}'::jsonb)
        || jsonb_build_object('authored', 'user_interaction', 'needs_distill', true),
      'medium'::confidence_level, 0.6,
      v_uid,
      jsonb_build_object('user_id', v_uid)
    )
    RETURNING id INTO v_obs_id;
    RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'observation_id', v_obs_id);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unsupported_kind', 'kind', p_kind);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_interaction(text, text, uuid, jsonb) TO authenticated, anon;

-- A vehicle's engagement, derived from the unified grammar (depth, not hearts).
CREATE OR REPLACE FUNCTION public.get_vehicle_engagement(p_vehicle_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_follows int;
  v_amf     boolean;
  v_comments int;
  v_contribs int;
  v_recent  jsonb;
BEGIN
  SELECT count(*) INTO v_follows FROM user_interactions
   WHERE interaction_type = 'follow' AND target_type = 'vehicle' AND target_id = p_vehicle_id::text;

  SELECT EXISTS(SELECT 1 FROM user_interactions
                WHERE user_id = v_uid AND interaction_type = 'follow'
                  AND target_type = 'vehicle' AND target_id = p_vehicle_id::text) INTO v_amf;

  -- ONLY engagement-grammar authored testimony (structured_data.authored =
  -- 'user_interaction'). NEVER legacy kind=comment observations — those include
  -- internal accounting notes, ownership corrections, and agent annotations that
  -- merely share the comment kind and must never surface on a public feed.
  SELECT count(*) INTO v_comments FROM vehicle_observations
   WHERE vehicle_id = p_vehicle_id AND kind = 'comment'
     AND structured_data->>'authored' = 'user_interaction';

  SELECT count(*) INTO v_contribs FROM vehicle_observations
   WHERE vehicle_id = p_vehicle_id AND structured_data->>'authored' = 'user_interaction'
     AND kind IN ('media','condition','specification','sighting');

  SELECT coalesce(jsonb_agg(r ORDER BY (r->>'at') DESC), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT jsonb_build_object(
             'id', o.id,
             'text', o.content_text,
             'at', o.observed_at,
             'author', coalesce(p.username, p.full_name, 'someone'),
             'is_me', (o.submitted_by_user_id = v_uid)
           ) AS r
    FROM vehicle_observations o
    LEFT JOIN profiles p ON p.id = o.submitted_by_user_id
    WHERE o.vehicle_id = p_vehicle_id AND o.kind = 'comment'
      AND o.structured_data->>'authored' = 'user_interaction'
    ORDER BY o.observed_at DESC
    LIMIT 30
  ) s;

  RETURN jsonb_build_object(
    'following_count', coalesce(v_follows, 0),
    'is_following',    coalesce(v_amf, false),
    'comment_count',   coalesce(v_comments, 0),
    'contribution_count', coalesce(v_contribs, 0),
    'recent_comments', v_recent
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_engagement(uuid) TO authenticated, anon;
