-- Functions as read from production on 2026-10-20 ~01:10Z (pg_get_functiondef), for test_public_text_contact_guard.sql.

CREATE OR REPLACE FUNCTION public.work_order_text_is_personal(p_work_order_id uuid, p_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_text IS NULL THEN RETURN false; END IF;
  IF p_text ~ '(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})' THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.work_orders w,
      regexp_split_to_table(concat_ws(' ', w.customer_name,
        (SELECT p.full_name FROM public.profiles p WHERE p.id = w.customer_id)), '\s+') tok
    WHERE w.id = p_work_order_id AND length(lower(regexp_replace(tok, '\W', '', 'g'))) >= 3
      AND p_text ~* ('\m' || lower(regexp_replace(tok, '\W', '', 'g')) || '\M'));
END $function$
;

CREATE OR REPLACE FUNCTION public.text_redact_contact(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT regexp_replace(regexp_replace(p_text,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g'),
    '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', 'g')
$function$
;

CREATE OR REPLACE FUNCTION public.record_interaction(p_kind text, p_target_type text, p_target_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_source uuid; v_text text; v_hash text; v_obs_id uuid; v_exists uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'auth_required'); END IF;

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
$function$
;
