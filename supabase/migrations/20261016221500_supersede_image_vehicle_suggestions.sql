-- ============================================================================
-- vehicle_images: a sanctioned writer for vehicle suggestions; the owner's upload-clock suggestions superseded and
-- his suggestions and filings on merged vehicles moved to the merge target
-- ============================================================================
--
-- WHY (2026-10-15, measured on prod; uid 0b9f107a = the owner, 28,271 vehicle_images rows, read in created_at windows):
--   * photo-pipeline-orchestrator's Strategy 3 (retired in the PR that adds 20261016220000) wrote suggested_vehicle_id =
--     "the vehicle this user filed most recently by created_at in the last 7 days", image_vehicle_match_status
--     'ambiguous', no auto_suggestion_reasons. 7,086 of the owner's live rows carry that shape on a vehicle they are not
--     filed on: capture_relay_ios 4,679, iphoto 1,177, photo_auto_sync 851, user_upload 308, image_intake 71. On the
--     phone rows, R3500 b1edd5c1 alone covers 4,328 photos taken 2017-09-11 .. 2026-06-16 on 310 distinct days.
--   * scripts/capture-sessions.mjs --apply writes the same shape from capture bursts (taken_at gaps), so the shape alone
--     does not name the writer. The photo's own clock does: a suggestion is kept when the same user has a live photo of
--     that vehicle (or of the vehicle it was merged into) taken within 90 minutes, the script's burst gap. Measured:
--     796 kept (user_upload 302 of 308, image_intake 67 of 71, capture_relay_ios 276, photo_auto_sync 140, iphoto 11),
--     6,290 cleared (capture_relay_ios 4,403, iphoto 1,166, photo_auto_sync 711, user_upload 6, image_intake 4).
--   * Merged vehicles the owner's rows touch: 8bde1dda and eeb9fa61 (1966 Mustang) into 83f6f033, f05462f9 (1973
--     Charger) into 043c6d8b. Followed here: 8bde1dda (merge_proposals tier 1, owner confirmation: the teal car repainted
--     black, human_verified) and f05462f9 (tier 1, three bit-identical images and the VIN WH23G3A146256 read off its
--     title, human_verified). NOT followed: eeb9fa61. Its merge (worth_engine_dedup_2026-05-23, tier 2, AI decision on
--     a shared first-photo date, not human-verified, executed 2026-05-24) is known to be wrong: it is a different
--     turquoise '66 (listing screenshots, a Utah plate). Its fix is an un-merge, not following it, so its 12 live
--     suggestions and 12 live filings stay where they are, and its photos are not evidence for 83f6f033.
--     After the clear, 5 live suggestions point at 8bde1dda (burst-kept) and 44 live photos are filed on f05462f9. The
--     85 filed on 8bde1dda are superseded rows and stay put.
--   * No writer could clear or move a suggestion with a record: reject_vehicle_suggestion keys on a vehicle_suggestions
--     row and audits nothing; resort_image moves the filing.
--
-- WHAT:
--   1. supersede_image_vehicle_suggestion(image ids, from vehicle, to vehicle or NULL, reason, actor): compare-and-set on
--      suggested_vehicle_id (a row no longer suggesting `from` is skipped, so a re-run changes nothing), at most 1,000
--      ids a call, `to` must be a live vehicle, one reattribution_audit row per changed image. Clearing also resets an
--      'ambiguous' match status to NULL (that status described the suggestion). The audit row keeps old_vehicle_id and
--      new_vehicle_id NULL because the filing does not move (the reassign_observation_subject precedent); its reason
--      names both suggestions and both statuses. Suggestions are hints, not testimony; vehicle_id is never touched.
--      service_role only.
--   2. The owner's rows: the clear above, then suggestions on merged vehicles repointed to the end of the merge chain
--      (never through the held merge eeb9fa61), then live filings on merged vehicles moved by relink_testimony (audited, keeps merged_from_vehicle_id; a photo
--      whose file is already on the target is refused and left, and counted). Superseded rows are never touched.
--      Reads go one created_at range at a time on (user_id, created_at); writes commit in chunks of at most 500
--      suggestions or one relink, with pg_sleep between, so this file runs outside a single transaction. Every
--      top-level statement stays under the deploy's 120 s ceiling: the reads and the clear are split into created_at
--      ranges of at most ~5,000 of the owner's rows (the densest day, 2026-06-14, has 3,432), each its own CALL.
--   The run's counts are printed as NOTICEs in the deploy log.
--
-- Not here: gate-rejected photos still filed on real vehicles (scripts/quarantine-gate-rejected.mjs, dry run by default).
-- Live verification after CI applies:
--   select count(*) from reattribution_audit where reason like 'suggestion_superseded: upload-clock%';   -- ~6,290
--   select count(*) from reattribution_audit where reason like 'filed on merged vehicle%';                -- <= 44
--   live rows on eeb9fa61 (suggested or filed): unchanged, 12 and 12
-- Reversal: every changed suggestion has an audit row holding its prior value; the same writer called with from NULL
--   and to the prior vehicle restores it.

SET statement_timeout = '120s';
SET lock_timeout = '5s';

BEGIN;
CREATE OR REPLACE FUNCTION public.supersede_image_vehicle_suggestion(
  p_image_ids uuid[],
  p_from_vehicle_id uuid,
  p_to_vehicle_id uuid,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changed integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'supersede_image_vehicle_suggestion: a reason is required';
  END IF;
  IF p_image_ids IS NULL OR cardinality(p_image_ids) = 0 THEN
    RETURN jsonb_build_object('requested', 0, 'changed', 0, 'from', p_from_vehicle_id, 'to', p_to_vehicle_id);
  END IF;
  IF cardinality(p_image_ids) > 1000 THEN
    RAISE EXCEPTION 'supersede_image_vehicle_suggestion: at most 1000 ids a call, got %', cardinality(p_image_ids);
  END IF;
  IF p_from_vehicle_id IS NOT DISTINCT FROM p_to_vehicle_id THEN
    RAISE EXCEPTION 'supersede_image_vehicle_suggestion: from and to are the same';
  END IF;
  IF p_to_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM vehicles v WHERE v.id = p_to_vehicle_id AND v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'supersede_image_vehicle_suggestion: target % is not a live vehicle', p_to_vehicle_id;
  END IF;
  PERFORM set_config('app.writer', 'supersede_image_vehicle_suggestion', true);

  WITH target AS (
    SELECT vi.id, vi.image_vehicle_match_status AS old_status
    FROM vehicle_images vi
    WHERE vi.id = ANY (p_image_ids)
      AND vi.suggested_vehicle_id IS NOT DISTINCT FROM p_from_vehicle_id
    FOR UPDATE
  ), changed AS (
    UPDATE vehicle_images vi
       SET suggested_vehicle_id = p_to_vehicle_id,
           image_vehicle_match_status = CASE
             WHEN p_to_vehicle_id IS NULL AND t.old_status = 'ambiguous' THEN NULL
             ELSE vi.image_vehicle_match_status END
      FROM target t
     WHERE vi.id = t.id
    RETURNING vi.id, t.old_status, vi.image_vehicle_match_status AS new_status
  ), audited AS (
    INSERT INTO reattribution_audit (
      observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
    SELECT 'image', c.id, NULL, c.id, NULL,
      'suggestion_superseded: ' || p_reason
        || '; suggested_vehicle_id ' || coalesce(p_from_vehicle_id::text, 'none')
        || ' -> ' || coalesce(p_to_vehicle_id::text, 'none')
        || '; image_vehicle_match_status ' || coalesce(c.old_status, 'null') || ' -> ' || coalesce(c.new_status, 'null'),
      p_actor_user_id
    FROM changed c
    RETURNING 1
  )
  SELECT count(*) INTO v_changed FROM audited;

  RETURN jsonb_build_object('requested', cardinality(p_image_ids), 'changed', v_changed,
    'from', p_from_vehicle_id, 'to', p_to_vehicle_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.supersede_image_vehicle_suggestion(uuid[], uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_image_vehicle_suggestion(uuid[], uuid, uuid, text, uuid) TO service_role;
COMMENT ON FUNCTION public.supersede_image_vehicle_suggestion(uuid[], uuid, uuid, text, uuid) IS
  'Sanctioned writer for vehicle_images.suggested_vehicle_id: compare-and-set from one vehicle to another live vehicle '
  'or to none, at most 1,000 ids a call, one reattribution_audit row per changed image (vehicle ids NULL: the filing '
  'does not move; the reason names both suggestions and match statuses). Never touches vehicle_id. service_role only. '
  '20261016221500.';
COMMIT;

-- The end of a vehicle's merge chain (itself when it was never merged). NULL past ten hops, on a cycle, or when the chain
-- passes through a merge held for an un-merge (eeb9fa61, see the header): nothing follows those.
CREATE OR REPLACE FUNCTION pg_temp.merge_terminal(p_vehicle_id uuid) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  c_held_merges CONSTANT uuid[] := ARRAY['eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f']::uuid[];
  v uuid := p_vehicle_id; nxt uuid;
BEGIN
  FOR i IN 1..10 LOOP
    IF v = ANY (c_held_merges) THEN RETURN NULL; END IF;
    SELECT merged_into_vehicle_id INTO nxt FROM public.vehicles WHERE id = v;
    IF nxt IS NULL THEN RETURN v; END IF;
    v := nxt;
  END LOOP;
  RETURN NULL;
END $$;

DROP TABLE IF EXISTS pg_temp._filed_moments, pg_temp._merged_filings, pg_temp._kept, pg_temp._chunk;
-- The owner's live filed photos by the end of their vehicle's merge chain and capture time (the clock evidence a
-- suggestion may lean on), and his live photos filed on a merged vehicle.
CREATE TEMP TABLE _filed_moments (vehicle_id uuid, taken_at timestamptz);
CREATE TEMP TABLE _merged_filings (id uuid PRIMARY KEY, merged_id uuid, terminal uuid, done boolean DEFAULT false);
CREATE TEMP TABLE _kept (id uuid PRIMARY KEY);
CREATE TEMP TABLE _chunk (id uuid, from_vehicle uuid, burst boolean);

CREATE OR REPLACE PROCEDURE pg_temp.read_filings(p_from timestamptz, p_to timestamptz) LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _filed_moments (vehicle_id, taken_at)
  SELECT DISTINCT coalesce(pg_temp.merge_terminal(vi.vehicle_id), vi.vehicle_id), vi.taken_at
  FROM public.vehicle_images vi
  WHERE vi.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND vi.created_at >= p_from AND vi.created_at < p_to
    AND vi.vehicle_id IS NOT NULL AND vi.taken_at IS NOT NULL AND vi.is_superseded IS NOT TRUE;
  INSERT INTO _merged_filings (id, merged_id, terminal)
  SELECT vi.id, vi.vehicle_id, pg_temp.merge_terminal(vi.vehicle_id)
  FROM public.vehicle_images vi
  JOIN public.vehicles v ON v.id = vi.vehicle_id AND v.merged_into_vehicle_id IS NOT NULL
  WHERE vi.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND vi.created_at >= p_from AND vi.created_at < p_to
    AND vi.is_superseded IS NOT TRUE
  ON CONFLICT (id) DO NOTHING;
  COMMIT;
END $$;

-- Clears the owner's upload-clock suggestions created in [p_from, p_to), one day at a time, 500 rows a chunk.
CREATE OR REPLACE PROCEDURE pg_temp.clear_upload_clock(p_from timestamptz, p_to timestamptz) LANGUAGE plpgsql AS $$
DECLARE
  c_user CONSTANT uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  c_reason CONSTANT text := 'upload-clock suggestion (photo-pipeline-orchestrator Strategy 3, retired 2026-10-15): '
    || 'no photo of that vehicle by this user within 90 minutes of this capture';
  d timestamptz := p_from;
  r record;
  res jsonb;
  n integer;
  n_cleared integer := 0;
  n_kept integer := 0;
BEGIN
  WHILE d < p_to LOOP
    LOOP
      DELETE FROM _chunk;
      INSERT INTO _chunk (id, from_vehicle, burst)
      SELECT vi.id, vi.suggested_vehicle_id,
        vi.taken_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM _filed_moments f
          WHERE f.vehicle_id = coalesce(pg_temp.merge_terminal(vi.suggested_vehicle_id), vi.suggested_vehicle_id)
            AND f.taken_at BETWEEN vi.taken_at - interval '90 minutes' AND vi.taken_at + interval '90 minutes')
      FROM public.vehicle_images vi
      WHERE vi.user_id = c_user
        AND vi.created_at >= d AND vi.created_at < least(d + interval '1 day', p_to)
        AND vi.suggested_vehicle_id IS NOT NULL
        AND vi.image_vehicle_match_status = 'ambiguous'
        AND (vi.auto_suggestion_reasons IS NULL OR cardinality(vi.auto_suggestion_reasons) = 0)
        AND vi.vehicle_id IS DISTINCT FROM vi.suggested_vehicle_id
        AND vi.is_superseded IS NOT TRUE
        AND NOT EXISTS (SELECT 1 FROM _kept k WHERE k.id = vi.id)
      LIMIT 500;
      GET DIAGNOSTICS n = ROW_COUNT;
      EXIT WHEN n = 0;
      INSERT INTO _kept SELECT c.id FROM _chunk c WHERE c.burst;
      n_kept := n_kept + (SELECT count(*) FROM _chunk c WHERE c.burst);
      FOR r IN SELECT c.from_vehicle, array_agg(c.id) AS ids FROM _chunk c WHERE NOT c.burst GROUP BY c.from_vehicle LOOP
        res := public.supersede_image_vehicle_suggestion(r.ids, r.from_vehicle, NULL, c_reason, NULL);
        n_cleared := n_cleared + (res->>'changed')::int;
      END LOOP;
      COMMIT;
      PERFORM pg_sleep(0.1);
    END LOOP;
    d := d + interval '1 day';
  END LOOP;
  RAISE NOTICE 'upload-clock suggestions created % .. %: cleared %, kept % (a photo of that vehicle by the same user within 90 minutes)',
    p_from::date, p_to::date, n_cleared, n_kept;
END $$;

-- Repoints the owner's live suggestions on merged vehicles to the end of the chain (probes each merged vehicle).
CREATE OR REPLACE PROCEDURE pg_temp.repoint_merged_suggestions() LANGUAGE plpgsql AS $$
DECLARE
  c_user CONSTANT uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  m record;
  ids uuid[];
  res jsonb;
  n_repointed integer := 0;
  n_held integer := 0;
BEGIN
  FOR m IN
    SELECT v.id AS merged_id, pg_temp.merge_terminal(v.id) AS terminal
    FROM public.vehicles v
    WHERE v.merged_into_vehicle_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.vehicle_images vi
                  WHERE vi.suggested_vehicle_id = v.id AND vi.user_id = c_user AND vi.is_superseded IS NOT TRUE)
  LOOP
    IF m.terminal IS NULL THEN  -- a held merge: its suggestions stay where they are
      n_held := n_held + (SELECT count(*) FROM public.vehicle_images vi
                          WHERE vi.suggested_vehicle_id = m.merged_id AND vi.user_id = c_user AND vi.is_superseded IS NOT TRUE);
      CONTINUE;
    END IF;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.vehicles t WHERE t.id = m.terminal AND t.deleted_at IS NULL);
    LOOP
      SELECT array_agg(x.id) INTO ids FROM (
        SELECT vi.id FROM public.vehicle_images vi
        WHERE vi.suggested_vehicle_id = m.merged_id AND vi.user_id = c_user AND vi.is_superseded IS NOT TRUE
        LIMIT 500) x;
      EXIT WHEN ids IS NULL;
      res := public.supersede_image_vehicle_suggestion(ids, m.merged_id, m.terminal,
        format('suggested vehicle %s was merged into %s: the suggestion follows the merge', m.merged_id, m.terminal), NULL);
      n_repointed := n_repointed + (res->>'changed')::int;
      COMMIT;
      EXIT WHEN (res->>'changed')::int = 0;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END LOOP;
  RAISE NOTICE 'suggestions on merged vehicles repointed: %; left on a held merge or an unresolved chain: %', n_repointed, n_held;
END $$;

-- Moves up to p_max of the owner's live filings on merged vehicles, one relink a transaction (vehicle_id moves fire the
-- heavy per-row triggers).
CREATE OR REPLACE PROCEDURE pg_temp.relink_merged_filings(p_max integer) LANGUAGE plpgsql AS $$
DECLARE
  f record;
  res jsonb;
  n_relinked integer := 0;
  n_refused integer := 0;
  n_failed integer := 0;
  n_held integer := 0;
BEGIN
  FOR f IN SELECT * FROM _merged_filings WHERE NOT done ORDER BY id LIMIT p_max LOOP
    IF f.terminal IS NULL THEN n_held := n_held + 1; END IF;  -- a held merge: the filing stays where it is
    IF f.terminal IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.vehicles t WHERE t.id = f.terminal AND t.deleted_at IS NULL)
       AND EXISTS (SELECT 1 FROM public.vehicle_images vi
                   WHERE vi.id = f.id AND vi.vehicle_id = f.merged_id AND vi.is_superseded IS NOT TRUE) THEN
      BEGIN
        PERFORM set_config('app.writer', 'relink_testimony:merged-filings-20261016', true);
        res := public.relink_testimony('image', f.id, f.terminal,
          format('filed on merged vehicle %s (merged into %s): the filing follows the merge', f.merged_id, f.terminal), NULL);
        IF (res->>'success')::boolean THEN n_relinked := n_relinked + 1; ELSE n_refused := n_refused + 1; END IF;
      EXCEPTION WHEN OTHERS THEN
        n_failed := n_failed + 1;
        RAISE NOTICE 'relink of % failed: %', f.id, SQLERRM;
      END;
    END IF;
    UPDATE _merged_filings SET done = true WHERE id = f.id;
    COMMIT;
    PERFORM pg_sleep(0.15);
  END LOOP;
  RAISE NOTICE 'filings on merged vehicles: relinked %, refused (file already on target) %, failed %, left on a held merge or an unresolved chain %, left for a re-run %',
    n_relinked, n_refused, n_failed, n_held, (SELECT count(*) FROM _merged_filings WHERE NOT done);
END $$;

-- Read pass: ranges of the owner's created_at with at most ~5,000 rows each (counts as of 2026-10-15).
CALL pg_temp.read_filings('2025-09-01', '2025-12-01');
CALL pg_temp.read_filings('2025-12-01', '2026-03-01');
CALL pg_temp.read_filings('2026-03-01', '2026-03-21');
CALL pg_temp.read_filings('2026-03-21', '2026-04-01');
CALL pg_temp.read_filings('2026-04-01', '2026-06-01');
CALL pg_temp.read_filings('2026-06-01', '2026-06-15');
CALL pg_temp.read_filings('2026-06-15', '2026-07-01');
CALL pg_temp.read_filings('2026-07-01', now() + interval '1 day');
CREATE INDEX ON _filed_moments (vehicle_id, taken_at);

-- Clear pass: at most ~3,400 suggestions a call (2026-06-14 alone holds 3,376).
CALL pg_temp.clear_upload_clock('2025-09-01', '2026-06-01');
CALL pg_temp.clear_upload_clock('2026-06-01', '2026-06-14');
CALL pg_temp.clear_upload_clock('2026-06-14', '2026-06-15');
CALL pg_temp.clear_upload_clock('2026-06-15', '2026-07-01');
CALL pg_temp.clear_upload_clock('2026-07-01', now() + interval '1 day');

CALL pg_temp.repoint_merged_suggestions();

-- 56 live filings on merged vehicles on 2026-10-15 (44 move, 12 on the held merge stay); four calls of 30 leave room.
CALL pg_temp.relink_merged_filings(30);
CALL pg_temp.relink_merged_filings(30);
CALL pg_temp.relink_merged_filings(30);
CALL pg_temp.relink_merged_filings(30);

DROP TABLE _filed_moments, _merged_filings, _kept, _chunk;
RESET statement_timeout;
RESET lock_timeout;
