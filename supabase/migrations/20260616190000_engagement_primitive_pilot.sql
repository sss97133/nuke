-- Engagement primitive — the unified user→graph contribution grammar (v1).
--
-- The system ALREADY models engagement; this aligns to the CANONICAL stores it has,
-- it does not mint new islands:
--   * Native user comments live in `user_comments` (RLS: anyone reads, authenticated
--     creates, author edits/deletes their own) — editable, user-owned. The canonical
--     READ across sources is the `vehicle_comments_unified` VIEW (auction_comments +
--     user_comments + comment/bid observations).
--   * Signals (follow/save/view) live in `user_interactions` (feeds user_engagement_summary).
--   * Verifiable atom contributions (media/condition/spec/sighting) are typed
--     observations on the `vehicle_observations` spine.
--
-- record_interaction is ONE entrypoint that routes a signed-in user's action to the
-- RIGHT canonical store by tier. get_vehicle_engagement reads the ladder as depth.
-- (Earlier this wrote comments as kind=comment observations — wrong store; that let an
--  internal accounting note surface on the public feed. Comments now go to user_comments
--  and the feed reads only user_comments, so that leak is structurally impossible.)

CREATE OR REPLACE FUNCTION public.record_interaction(
  p_kind text, p_target_type text, p_target_id uuid, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_source uuid; v_text text; v_hash text; v_obs_id uuid; v_exists uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'auth_required'); END IF;

  -- SIGNAL — telemetry, no graph change. Follow toggles.
  IF p_kind IN ('follow','save','view') THEN
    IF p_kind = 'follow' THEN
      SELECT id INTO v_exists FROM user_interactions
       WHERE user_id=v_uid AND interaction_type='follow' AND target_type=p_target_type AND target_id=p_target_id::text LIMIT 1;
      IF v_exists IS NOT NULL THEN DELETE FROM user_interactions WHERE id=v_exists;
        RETURN jsonb_build_object('ok', true, 'kind','follow','following', false); END IF;
    END IF;
    INSERT INTO user_interactions (user_id, interaction_type, target_type, target_id, context)
    VALUES (v_uid, p_kind, p_target_type, p_target_id::text, coalesce(p_payload,'{}'::jsonb));
    RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'following', p_kind='follow');
  END IF;

  -- COMMENT (testimony) -> user_comments, the canonical editable native store.
  IF p_kind = 'comment' THEN
    IF p_target_type <> 'vehicle' THEN RETURN jsonb_build_object('ok', false, 'error', 'unsupported_target'); END IF;
    v_text := btrim(coalesce(p_payload->>'text', ''));
    IF length(v_text)=0 THEN RETURN jsonb_build_object('ok', false, 'error', 'empty'); END IF;
    SELECT id INTO v_exists FROM user_comments WHERE vehicle_id=p_target_id AND user_id=v_uid AND comment_text=v_text LIMIT 1;
    IF v_exists IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'kind','comment','comment_id', v_exists, 'duplicate', true); END IF;
    INSERT INTO user_comments (vehicle_id, user_id, comment_text, target_type)
    VALUES (p_target_id, v_uid, v_text, 'vehicle') RETURNING id INTO v_obs_id;
    RETURN jsonb_build_object('ok', true, 'kind','comment','comment_id', v_obs_id);
  END IF;

  -- CONTRIBUTION (atoms) -> the observation spine (typed, provenanced). UI-wired later.
  IF p_kind IN ('sighting','media','condition','specification') THEN
    IF p_target_type <> 'vehicle' THEN RETURN jsonb_build_object('ok', false, 'error', 'unsupported_target'); END IF;
    SELECT id INTO v_source FROM observation_sources WHERE slug='user-input';
    IF v_source IS NULL THEN SELECT id INTO v_source FROM observation_sources WHERE slug='owner-input'; END IF;
    v_hash := md5('user_interaction|'||p_kind||'|'||p_target_id::text||'|'||v_uid::text||'|'||p_payload::text);
    SELECT id INTO v_obs_id FROM vehicle_observations WHERE content_hash=v_hash LIMIT 1;
    IF v_obs_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'observation_id', v_obs_id, 'duplicate', true); END IF;
    INSERT INTO vehicle_observations (vehicle_id, observed_at, source_id, kind, content_hash,
      structured_data, confidence, confidence_score, submitted_by_user_id, observer_raw)
    VALUES (p_target_id, now(), v_source, p_kind::observation_kind, v_hash,
      coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('authored','user_interaction','needs_distill',true),
      'medium'::confidence_level, 0.6, v_uid, jsonb_build_object('user_id', v_uid))
    RETURNING id INTO v_obs_id;
    RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'observation_id', v_obs_id);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unsupported_kind', 'kind', p_kind);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_interaction(text, text, uuid, jsonb) TO authenticated;

-- A vehicle's engagement — native testimony straight from user_comments (canonical,
-- fast, clean; never the 13.9M auction corpus, never internal observations).
CREATE OR REPLACE FUNCTION public.get_vehicle_engagement(p_vehicle_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_follows int; v_amf boolean; v_comments int; v_contribs int; v_recent jsonb;
BEGIN
  SELECT count(*) INTO v_follows FROM user_interactions
   WHERE interaction_type='follow' AND target_type='vehicle' AND target_id=p_vehicle_id::text;
  SELECT EXISTS(SELECT 1 FROM user_interactions WHERE user_id=v_uid AND interaction_type='follow'
                  AND target_type='vehicle' AND target_id=p_vehicle_id::text) INTO v_amf;
  SELECT count(*) INTO v_comments FROM user_comments WHERE vehicle_id=p_vehicle_id;
  SELECT count(*) INTO v_contribs FROM vehicle_observations
   WHERE vehicle_id=p_vehicle_id AND structured_data->>'authored'='user_interaction'
     AND kind IN ('media','condition','specification','sighting');
  SELECT coalesce(jsonb_agg(r ORDER BY (r->>'at') DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT jsonb_build_object('id', u.id, 'text', u.comment_text, 'at', u.created_at,
             'author', coalesce(p.username, p.full_name, 'someone'),
             'is_me', (u.user_id = v_uid), 'editable', (u.user_id = v_uid)) AS r
    FROM user_comments u LEFT JOIN profiles p ON p.id = u.user_id
    WHERE u.vehicle_id = p_vehicle_id ORDER BY u.created_at DESC LIMIT 30
  ) s;
  RETURN jsonb_build_object('following_count', coalesce(v_follows,0), 'is_following', coalesce(v_amf,false),
    'comment_count', coalesce(v_comments,0), 'contribution_count', coalesce(v_contribs,0), 'recent_comments', v_recent);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_engagement(uuid) TO authenticated, anon;
