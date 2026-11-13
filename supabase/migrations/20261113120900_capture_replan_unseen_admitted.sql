-- Unseen admitted photos re-open a refused day (20261113120900). capture_day_replan_state kept a day refused by the gate
-- blocked until a photo of that day ARRIVED after the refusal (or a related filing landed). 20261113120700 admitted unfiled
-- uploads that arrived long before, so days refused earlier never re-planned with them (10 days / 116 photos on 2026-11-09).
-- New evidence now also includes a planner-eligible unfiled photo absent from the refused plan that only became eligible
-- after the refusal. Eligibility time per kind lives in capture_set_admission_epochs (seeded with the 120700 apply time).
-- Owner note: capture landing code is Codex-owned; this is a draft for review.
-- Revert: supabase/sql/revert_20261113120900_capture_replan_unseen_admitted.sql
DO $$ BEGIN
  IF md5(pg_get_functiondef('public.capture_day_replan_state(uuid, date)'::regprocedure)) <> 'a872c072bd702a360071a733f7b69dc4' THEN
    RAISE EXCEPTION 'capture_day_replan_state drifted from the 20261113120800 body; re-record before patching';
  END IF;
  IF to_regprocedure('public.capture_set_photo_admits(text, uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'needs capture_set_photo_admits (20261113120700)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.capture_set_admission_epochs (
  rule text PRIMARY KEY,
  admitted_from timestamptz NOT NULL,
  note text
);
ALTER TABLE public.capture_set_admission_epochs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_set_admission_epochs FROM anon, authenticated;
INSERT INTO public.capture_set_admission_epochs (rule, admitted_from, note)
VALUES ('unfiled_uploads',
        coalesce((SELECT min(saved_at) FROM public.capture_admit_uploads_prev_defs), now()),
        '20261113120700: unfiled user/owner/drop-folder/direct-pull uploads with a camera clock enter the planner')
ON CONFLICT (rule) DO NOTHING;

CREATE OR REPLACE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from timestamptz := p_day::timestamp AT TIME ZONE 'America/Los_Angeles';
  v_to   timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles';
  c record; v_photos boolean; v_anchor boolean; v_unseen boolean;
BEGIN
  SELECT id, state, run_id, coalesce(updated_at, created_at) AS at INTO c
  FROM capture_landing_chunks
  WHERE user_id = p_user AND t_from = v_from AND t_to = v_to
    AND NOT coalesce(dry, false)  -- 20261113120800: a dry run is a preview, never a pending plan
  ORDER BY created_at DESC LIMIT 1;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'never_planned');
  END IF;
  IF c.state IN ('planned', 'awaiting_gate') THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'plan_pending', 'chunk', c.id, 'state', c.state);
  END IF;
  IF c.state <> 'gate_failed' THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'last_plan_' || c.state, 'chunk', c.id);
  END IF;
  -- refused: new evidence is a photo of that day that arrived after the refusal, or a gate-passed filing after the
  -- refusal onto a vehicle the day's open review rows propose, or in the same capture session (set_key) or capture day
  -- (20261113120100: no longer any vehicle when they propose none)
  SELECT EXISTS (SELECT 1 FROM vehicle_images v
                 WHERE v.user_id = p_user AND v.vehicle_id IS NULL AND v.taken_at >= v_from AND v.taken_at < v_to
                   AND v.created_at > c.at)
    INTO v_photos;
  SELECT EXISTS (
           WITH vehs AS (
             SELECT array_agg(DISTINCT r.to_vehicle_id) FILTER (WHERE r.to_vehicle_id IS NOT NULL) a, array_agg(DISTINCT r.set_key) s
             FROM capture_set_review r
             WHERE r.user_id = p_user AND r.status = 'open'
               AND (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) = p_day)
           SELECT 1 FROM capture_set_links l
           JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
           JOIN vehicle_images vi ON vi.id = l.image_id, vehs
           WHERE l.reverted_at IS NULL AND vi.user_id = p_user AND l.created_at > c.at
             AND (l.vehicle_id = ANY (coalesce(vehs.a, '{}'::uuid[])) OR l.set_key = ANY (coalesce(vehs.s, '{}'::text[]))
                  OR (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date = p_day))
    INTO v_anchor;
  -- 20261113120900: a photo the refused plan never saw and could not have seen: planner-eligible and unfiled now, absent
  -- from the refused run's candidates and review rows, and eligible only since the refusal (it arrived later, or the planner
  -- admitted its kind later: capture_set_admission_epochs, e.g. unfiled uploads from 20261113120700, or its camera clock was
  -- recovered later from the stored file: exif_data.capture_clock.at). Photos the planner
  -- saw and chose not to propose never count, so a re-plan that leaves one out is not re-armed by it again.
  SELECT EXISTS (
           SELECT 1 FROM vehicle_images v
           WHERE v.user_id = p_user AND v.vehicle_id IS NULL AND v.taken_at >= v_from AND v.taken_at < v_to
             AND public.capture_set_photo_admits(v.source, v.vehicle_id, v.exif_data) AND nullif(v.image_url, '') IS NOT NULL
             AND NOT (coalesce(v.is_duplicate, false) OR coalesce(v.is_superseded, false) OR coalesce(v.is_sensitive, false)
                      OR coalesce(v.vision_gate_status::text, '') IN ('rejected_personal', 'rejected_misattributed'))
             AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = v.id AND dp.revoked_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM capture_set_links l WHERE l.image_id = v.id AND l.reverted_at IS NULL)
             AND greatest(v.created_at,
                          CASE WHEN v.source = ANY (public.capture_set_photo_sources()) THEN '-infinity'::timestamptz
                               ELSE coalesce((SELECT max(e.admitted_from) FROM capture_set_admission_epochs e
                                              WHERE e.rule = 'unfiled_uploads'), '-infinity'::timestamptz) END,
                          -- a camera clock recovered later from the stored file (capture_clock_from_file.py) admits it then
                          coalesce((v.exif_data -> 'capture_clock' ->> 'at')::timestamptz, '-infinity'::timestamptz)) > c.at
             AND NOT EXISTS (SELECT 1 FROM capture_set_candidates k WHERE k.run_id = c.run_id AND v.id = ANY (k.image_ids))
             AND NOT EXISTS (SELECT 1 FROM capture_set_review r WHERE r.run_id = c.run_id AND v.id = ANY (r.image_ids)))
    INTO v_unseen;
  IF v_photos OR v_anchor OR v_unseen THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'new_evidence_since_refusal', 'chunk', c.id,
                              'new_photos', v_photos, 'new_anchor', v_anchor, 'unseen_photos', v_unseen);
  END IF;
  RETURN jsonb_build_object('blocked', true, 'reason', 'refused_no_new_evidence', 'chunk', c.id, 'refused_at', c.at);
END $function$;
