-- supersede_timeline_events + plan_bat_live_end_supersessions: retire a wrong timeline event whole, never edit it.
--
-- WHY (2026-10-15): extract-bat-core before 4.5.0 wrote an auction END row (auction_ended, "BaT ended • bid to $X")
-- on every read of a RUNNING BaT lot, dated the scheduled end and priced at the bid of that read. Its
-- insert-if-absent key (vehicle, event_type, event_date, source_url) kept the row; the sale added a second one.
-- Measured on prod 2026-10-15 (the plan below, run read-only per event_date day, 15:31-15:45Z): 7,312 extract-bat-core
-- auction_ended rows on 7,280 vehicles were created before the end they name, all dated 2026-01..10 (none before:
-- yearly and monthly counts back to 2000); 1,303 of them for lots still running (e.g. a live 1997 911 Carrera 4S,
-- vehicle 6856fc3d, shows "auction ended" with $109,993 while bidding stands at $250,000). vehicle_profile_read folds
-- timeline_events into the timeline every visitor sees, web and phone.
--
-- SHAPE: timeline_events has no supersession columns and no reader filters a status (vehicle_profile_read counts every
-- row), so a flag in place would still show. The existing archive superseded_rows (owner-sanctioned 2026-09-28; writers
-- correct_vehicle_event_link, supersede_vehicle_event_episode, resolve_dangling_vehicle_events, retire_rows) keeps a
-- retired row whole: row_data = to_jsonb(row), the citation, the reason, who asserted it. Every reader stops counting
-- it with no reader change. Restore = INSERT jsonb_populate_record(NULL::timeline_events, row_data), set restored_at.
--
-- supersede_timeline_events(rows, asserted_by), per row {event_id, expected_vehicle_id, expected_event_type,
-- replacement_event_id?, source{type, ref, ...}, reason}:
--   * a cited source (type and ref) and a reason of 10+ characters are required, else the call raises (nothing written);
--   * system rows only (source_type 'system'); never an image_upload row (its delete trigger removes the photo);
--   * stale (vehicle or type differ from the plan) and missing rows are reported, not written; a row already retired
--     returns 'already' (idempotent);
--   * a replacement must be a live row of the same vehicle and the same metadata.source_url;
--   * referenced rows are left alone and listed. Inbound links, prod catalog 2026-10-15: FKs ON DELETE CASCADE from
--     timeline_event_comments.event_id, image_tags, work_order_parts, work_order_labor, device_attributions
--     (timeline_event_id) and generated_invoices.event_id; ON DELETE SET NULL from image_sets and auction_listing_images
--     (timeline_event_id); no FK from receipts, organization_images, contribution_submissions,
--     work_organization_matches, vehicle_images (timeline_event_id) and timeline_event_conflicts (primary_event_id,
--     conflicting_event_id). vehicle_images (52.5M rows) is probed through the row's vehicle (idx_vehicle_images_created_at);
--   * bounds: the caller sets statement_timeout 1..60 s; lock_timeout 3 s; at most 500 rows per call. Delete-path
--     triggers on timeline_events (prod 2026-10-15): tr_delete_timeline_event_image (image_upload only),
--     trigger_update_build_patterns (returns at once for a vehicle with no uploaded_by), the completion enqueue and a
--     no-op feed refresh;
--   * SECURITY DEFINER, search_path public, pg_temp; EXECUTE for service_role only.
--
-- plan_bat_live_end_supersessions(from, to, limit, after): the plan for one event_date window (read only), in id order
-- after the cursor id. Rows:
-- extract-bat-core auction_ended rows (source 'bat', source_type 'system') created before the end they name: the
-- recorded data-ends instant when the row carries one (metadata.occurred_at_source 'data-ends'), else 00:00 UTC of
-- event_date. Each names the listing's end row read after the close, when one exists, as its replacement (a sold or
-- reserve-not-met row first, else an auction_ended row not written early); class says which: replaced_by_<type>,
-- still_running (event_date today or later) or no_closing_read. At most 500 rows per call; the event_date index
-- bounds the window. Runner: scripts/bat-corrections/supersede-live-end-events.mjs (dry run by default).
--
-- Contract: supabase/sql/test_timeline_event_supersession.sql (PostgreSQL 17). Applied by CI, never by hand. No row
-- changes in this migration.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.supersede_timeline_events(p_rows jsonb, p_asserted_by text DEFAULT 'agent')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'supersede_timeline_events';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  r            jsonb;
  v_id         uuid;
  v_rep_id     uuid;
  v_ev         timeline_events%ROWTYPE;
  v_rep        timeline_events%ROWTYPE;
  v_refs       text[];
  v_retired    jsonb := '[]'::jsonb;
  v_already    jsonb := '[]'::jsonb;
  v_missing    jsonb := '[]'::jsonb;
  v_stale      jsonb := '[]'::jsonb;
  v_refused    jsonb := '[]'::jsonb;
  v_referenced jsonb := '[]'::jsonb;
BEGIN
  -- Bounds: the caller bounds the statement; this function bounds its lock waits.
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array', c_writer;
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION '%: at most 500 rows per call (got %)', c_writer, jsonb_array_length(p_rows);
  END IF;
  IF coalesce(btrim(p_asserted_by), '') = '' THEN
    RAISE EXCEPTION '%: asserted_by is required', c_writer;
  END IF;
  -- Every row is cited and argued, or nothing is written.
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF coalesce(r -> 'source' ->> 'type', '') = '' OR coalesce(r -> 'source' ->> 'ref', '') = '' THEN
      RAISE EXCEPTION '%: event % has no cited source (source.type, source.ref)', c_writer, r ->> 'event_id';
    END IF;
    IF length(btrim(coalesce(r ->> 'reason', ''))) < 10 THEN
      RAISE EXCEPTION '%: event % needs a reason of 10+ characters', c_writer, r ->> 'event_id';
    END IF;
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id := (r ->> 'event_id')::uuid;
    v_rep_id := nullif(r ->> 'replacement_event_id', '')::uuid;

    SELECT * INTO v_ev FROM timeline_events WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM superseded_rows s
                 WHERE s.source_table = 'timeline_events' AND s.row_id = v_id AND s.restored_at IS NULL) THEN
        v_already := v_already || to_jsonb(v_id);
      ELSE
        v_missing := v_missing || to_jsonb(v_id);
      END IF;
      CONTINUE;
    END IF;
    IF v_ev.vehicle_id IS DISTINCT FROM nullif(r ->> 'expected_vehicle_id', '')::uuid
       OR v_ev.event_type IS DISTINCT FROM (r ->> 'expected_event_type') THEN
      v_stale := v_stale || jsonb_build_object('event_id', v_id, 'live_vehicle_id', v_ev.vehicle_id,
                                               'live_event_type', v_ev.event_type);
      CONTINUE;
    END IF;
    IF v_ev.source_type IS DISTINCT FROM 'system' OR v_ev.event_type = 'image_upload' THEN
      v_refused := v_refused || jsonb_build_object('event_id', v_id,
        'why', CASE WHEN v_ev.event_type = 'image_upload' THEN 'image_upload row (its delete removes the photo)'
                    ELSE 'not a system row (source_type ' || coalesce(v_ev.source_type, 'null') || ')' END);
      CONTINUE;
    END IF;
    IF v_rep_id IS NOT NULL THEN
      SELECT * INTO v_rep FROM timeline_events WHERE id = v_rep_id;
      IF NOT FOUND OR v_rep.id = v_ev.id OR v_rep.vehicle_id IS DISTINCT FROM v_ev.vehicle_id
         OR (v_rep.metadata ->> 'source_url') IS DISTINCT FROM (v_ev.metadata ->> 'source_url') THEN
        v_refused := v_refused || jsonb_build_object('event_id', v_id, 'replacement_event_id', v_rep_id,
          'why', 'replacement is not a live row of the same vehicle and listing');
        CONTINUE;
      END IF;
    END IF;

    -- Inbound links: a cascade would take the linked rows along, a set-null would orphan them.
    v_refs := ARRAY(
      SELECT l.tbl FROM (VALUES
        ('timeline_event_comments', EXISTS (SELECT 1 FROM timeline_event_comments x WHERE x.event_id = v_id)),
        ('image_tags',              EXISTS (SELECT 1 FROM image_tags x WHERE x.timeline_event_id = v_id)),
        ('work_order_parts',        EXISTS (SELECT 1 FROM work_order_parts x WHERE x.timeline_event_id = v_id)),
        ('work_order_labor',        EXISTS (SELECT 1 FROM work_order_labor x WHERE x.timeline_event_id = v_id)),
        ('device_attributions',     EXISTS (SELECT 1 FROM device_attributions x WHERE x.timeline_event_id = v_id)),
        ('generated_invoices',      EXISTS (SELECT 1 FROM generated_invoices x WHERE x.event_id = v_id)),
        ('image_sets',              EXISTS (SELECT 1 FROM image_sets x WHERE x.timeline_event_id = v_id)),
        ('auction_listing_images',  EXISTS (SELECT 1 FROM auction_listing_images x WHERE x.timeline_event_id = v_id)),
        ('receipts',                EXISTS (SELECT 1 FROM receipts x WHERE x.timeline_event_id = v_id)),
        ('organization_images',     EXISTS (SELECT 1 FROM organization_images x WHERE x.timeline_event_id = v_id)),
        ('contribution_submissions', EXISTS (SELECT 1 FROM contribution_submissions x WHERE x.timeline_event_id = v_id)),
        ('work_organization_matches', EXISTS (SELECT 1 FROM work_organization_matches x WHERE x.timeline_event_id = v_id)),
        ('timeline_event_conflicts', EXISTS (SELECT 1 FROM timeline_event_conflicts x
                                             WHERE x.primary_event_id = v_id OR x.conflicting_event_id = v_id)),
        ('vehicle_images',          EXISTS (SELECT 1 FROM vehicle_images x
                                             WHERE x.vehicle_id = v_ev.vehicle_id AND x.timeline_event_id = v_id))
      ) AS l(tbl, linked) WHERE l.linked);
    IF cardinality(v_refs) > 0 THEN
      v_referenced := v_referenced || jsonb_build_object('event_id', v_id, 'linked_from', to_jsonb(v_refs));
      CONTINUE;
    END IF;

    INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
    VALUES ('timeline_events', v_ev.id, to_jsonb(v_ev), p_asserted_by,
            (r -> 'source') || jsonb_build_object('writer', c_writer, 'replacement_event_id', v_rep_id,
                                                  'expected_event_type', v_ev.event_type),
            btrim(r ->> 'reason'));
    DELETE FROM timeline_events WHERE id = v_ev.id;
    v_retired := v_retired || to_jsonb(v_id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'requested', jsonb_array_length(p_rows),
    'retired', jsonb_array_length(v_retired), 'retired_ids', v_retired, 'already', v_already, 'missing', v_missing,
    'stale', v_stale, 'refused', v_refused, 'referenced', v_referenced, 'asserted_by', p_asserted_by);
END;
$function$;

REVOKE ALL ON FUNCTION public.supersede_timeline_events(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supersede_timeline_events(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_timeline_events(jsonb, text) TO service_role;
COMMENT ON FUNCTION public.supersede_timeline_events(jsonb, text) IS
  'Sanctioned timeline_events supersession: retires a system row whole into superseded_rows (row_data, citation, reason, asserted_by, replacement_event_id) and removes it from timeline_events, so every reader stops counting it. Cited source and reason required; stale, missing, referenced, non-system and image_upload rows are reported, not written; a replacement must be a live row of the same vehicle and listing; caller statement_timeout 1..60 s; <= 500 rows; service role only. Restore = re-insert row_data.';

CREATE OR REPLACE FUNCTION public.plan_bat_live_end_supersessions(
  p_from date, p_to date, p_limit integer DEFAULT 200, p_after uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $plan$
WITH args AS (SELECT p_from AS lo, p_to AS hi, least(greatest(coalesce(p_limit, 200), 1), 500) AS lim, p_after AS after),
early AS (
  SELECT t.id, t.vehicle_id, t.event_type, t.event_date, t.created_at, t.metadata ->> 'source_url' AS url,
         e.claimed_end, e.basis
  FROM args, public.timeline_events t
  CROSS JOIN LATERAL (
    SELECT CASE WHEN t.metadata ->> 'occurred_at_source' = 'data-ends'
                 AND t.metadata ->> 'occurred_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
                THEN (t.metadata ->> 'occurred_at')::timestamptz ELSE t.event_date::timestamptz END AS claimed_end,
           CASE WHEN t.metadata ->> 'occurred_at_source' = 'data-ends'
                 AND t.metadata ->> 'occurred_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
                THEN 'data-ends' ELSE 'event_date' END AS basis) e
  WHERE t.event_date >= args.lo AND t.event_date < args.hi
    AND t.event_type = 'auction_ended' AND t.data_source = 'extract-bat-core'
    AND t.source = 'bat' AND t.source_type = 'system'
    AND t.created_at < e.claimed_end
    AND (args.after IS NULL OR t.id > args.after)
  ORDER BY t.id
  LIMIT (SELECT lim FROM args)
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
         'event_id', x.id,
         'expected_vehicle_id', x.vehicle_id,
         'expected_event_type', x.event_type,
         'replacement_event_id', rep.id,
         'class', CASE WHEN rep.id IS NOT NULL THEN 'replaced_by_' || rep.event_type
                       WHEN x.event_date >= current_date THEN 'still_running'
                       ELSE 'no_closing_read' END,
         'event_date', x.event_date,
         'source', jsonb_build_object(
           'type', 'timeline_row', 'ref', x.url,
           'finding', 'created before the end it names: a read of the running lot, not its result',
           'created_at', x.created_at, 'claimed_end', x.claimed_end, 'claimed_end_basis', x.basis),
         'reason', 'BaT end event written while the auction was still running: its date was the scheduled end and its amount the bid at that read, not a result')
       ORDER BY x.id), '[]'::jsonb)
FROM early x
LEFT JOIN LATERAL (
  SELECT r.id, r.event_type
  FROM public.timeline_events r
  WHERE r.vehicle_id = x.vehicle_id AND r.id <> x.id
    AND r.event_type IN ('auction_sold', 'auction_reserve_not_met', 'auction_ended')
    AND r.metadata ->> 'source_url' = x.url
    AND NOT (r.event_type = 'auction_ended' AND r.created_at < CASE
          WHEN r.metadata ->> 'occurred_at_source' = 'data-ends' AND r.metadata ->> 'occurred_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
          THEN (r.metadata ->> 'occurred_at')::timestamptz ELSE r.event_date::timestamptz END)
  ORDER BY (r.event_type <> 'auction_ended') DESC, r.created_at DESC
  LIMIT 1
) rep ON true
$plan$;

REVOKE ALL ON FUNCTION public.plan_bat_live_end_supersessions(date, date, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plan_bat_live_end_supersessions(date, date, integer, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_bat_live_end_supersessions(date, date, integer, uuid) TO service_role;
COMMENT ON FUNCTION public.plan_bat_live_end_supersessions(date, date, integer, uuid) IS
  'Read-only plan for supersede_timeline_events over one event_date window [from, to), in id order after p_after: extract-bat-core auction_ended rows created before the end they name (the recorded data-ends instant, else 00:00 UTC of event_date), each with the listing''s end row read after the close as replacement when one exists, and a class (replaced_by_<type>, still_running, no_closing_read). <= 500 rows; service role only.';

DO $comment$
DECLARE c text := obj_description('public.superseded_rows'::regclass, 'pg_class');
BEGIN
  IF position('supersede_timeline_events' IN coalesce(c, '')) = 0 THEN
    EXECUTE format('COMMENT ON TABLE public.superseded_rows IS %L', coalesce(c, '') ||
      ' Also supersede_timeline_events (2026-10-15): timeline_events rows retired whole (source.replacement_event_id names the row that states the event instead).');
  END IF;
END;
$comment$;

COMMIT;
