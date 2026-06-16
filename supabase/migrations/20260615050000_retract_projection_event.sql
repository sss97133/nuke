-- Retraction primitive — the "reversible" in the abuse-resistance story.
--
-- Testimony is never deleted. To retract a claim we APPEND a retracting event (carrying the
-- reason + a pointer to the target) and set the target's retracted_at/retracted_by at it. The
-- marker SELF-retracts so every consensus/projection read (all filter `retracted_at IS NULL`)
-- ignores it — it exists only as the FK target + audit reason. Owner/high-trust op; not exposed
-- on the public MCP connector. Down-weighting handles bad actors at consensus time; this is the
-- hard, auditable removal for confirmed-bad or test/demo atoms.

CREATE OR REPLACE FUNCTION public.retract_projection_event(p_target uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; v_retractor uuid; v_new uuid;
BEGIN
  SELECT * INTO t FROM projection_event WHERE id = p_target;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','target not found'); END IF;
  IF t.retracted_at IS NOT NULL THEN RETURN jsonb_build_object('error','already retracted','retracted_by',t.retracted_by); END IF;

  INSERT INTO model_registry (slug, provider, caller_kind, base_trust, notes)
  VALUES ('owner-retraction','owner','platform',0.95,'High-trust retraction actor')
  ON CONFLICT (slug) DO UPDATE SET last_seen = now() RETURNING id INTO v_retractor;
  IF v_retractor IS NULL THEN SELECT id INTO v_retractor FROM model_registry WHERE slug='owner-retraction'; END IF;

  INSERT INTO projection_event (request_envelope, result_envelope, result_kind, model_id, model_caller, prompt_sha256, observed_at)
  VALUES (
    jsonb_build_object('subject_id', t.request_envelope->>'subject_id', 'attribute', t.request_envelope->>'attribute', 'op','retraction'),
    jsonb_build_object('label','__retracted__','retracts', p_target, 'reason', p_reason, 'confidence', 1.0),
    'projection', v_retractor, 'owner:retraction', t.prompt_sha256, now()
  ) RETURNING id INTO v_new;

  UPDATE projection_event SET retracted_by = v_new, retracted_at = now() WHERE id = p_target;  -- target
  UPDATE projection_event SET retracted_by = v_new, retracted_at = now() WHERE id = v_new;      -- marker self-retracts
  RETURN jsonb_build_object('retracted', p_target, 'by_event', v_new, 'reason', p_reason);
END;
$$;

COMMENT ON FUNCTION public.retract_projection_event(uuid, text) IS
  'Reversible retraction: appends a self-retracting marker event (testimony preserved) and points the target''s retracted_at/retracted_by at it. Owner/high-trust only.';
