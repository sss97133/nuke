-- DRAFT, NOT APPLIED. Per-image cohort graph: derivation, drains, backfill enqueuers.
-- Every write is a diff: insert missing current edges, supersede stale ones, never delete.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Derive the per-image edges for a batch of photos. Returns the number of edges inserted plus superseded.
CREATE OR REPLACE FUNCTION public.image_cohort_derive(p_ids uuid[], p_rule text DEFAULT 'image_cohort_v1')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_changed integer := 0; v_n integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _ice_want (
    image_id uuid, cohort_kind text, cohort_key text, cohort_id uuid, basis text, basis_id uuid,
    originator_user_id uuid, visibility text, rule_version text) ON COMMIT DROP;
  TRUNCATE _ice_want;

  INSERT INTO _ice_want (image_id, cohort_kind, cohort_key, cohort_id, basis, basis_id, originator_user_id, visibility, rule_version)
  -- place cell: the 0.001-degree cell of the photo's own GPS (the geo_cell_zcta grain)
  SELECT vi.id, 'place_cell', round(vi.latitude, 3)::text || ':' || round(vi.longitude, 3)::text, NULL,
         'vehicle_images.gps', NULL, vi.user_id,
         CASE WHEN coalesce(vi.is_sensitive, false) OR vi.vision_gate_status = 'rejected_personal' THEN 'private' ELSE 'inherit' END, p_rule
  FROM vehicle_images vi WHERE vi.id = ANY (p_ids) AND vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL
  UNION ALL
  -- ZCTA, only when the cell is already keyed (key_geo_cells_zcta); unknown stays unknown
  SELECT vi.id, 'zcta', g.zcta, NULL, 'geo_cell_zcta', NULL, vi.user_id,
         CASE WHEN coalesce(vi.is_sensitive, false) OR vi.vision_gate_status = 'rejected_personal' THEN 'private' ELSE 'inherit' END, p_rule
  FROM vehicle_images vi
  JOIN geo_cell_zcta g ON g.cell_lat = round(vi.latitude, 3) AND g.cell_lng = round(vi.longitude, 3) AND g.zcta IS NOT NULL
  WHERE vi.id = ANY (p_ids)
  UNION ALL
  -- capture session / image set
  SELECT m.image_id, 'capture_session', m.image_set_id::text, m.image_set_id, 'image_set_members', m.id, vi.user_id, 'inherit', p_rule
  FROM image_set_members m JOIN vehicle_images vi ON vi.id = m.image_id WHERE m.image_id = ANY (p_ids)
  UNION ALL
  -- work order evidence
  SELECT w.image_id, 'work_order', w.work_order_id::text, w.work_order_id, 'work_order_evidence_images', w.attachment_id, vi.user_id, 'inherit', p_rule
  FROM work_order_evidence_images w JOIN vehicle_images vi ON vi.id = w.image_id WHERE w.image_id = ANY (p_ids)
  UNION ALL
  -- data-set membership (#3729), active members only
  SELECT d.member_id, 'data_set', d.set_id::text, d.set_id, 'data_set_members', NULL, vi.user_id, 'inherit', p_rule
  FROM data_set_members d JOIN vehicle_images vi ON vi.id = d.member_id
  WHERE d.member_type = 'image' AND d.state = 'active' AND d.member_id = ANY (p_ids);
  -- garage / garage_site: added when the garage model (#3448) is applied, from garage_stay_evidence:
  --   originator_user_id = evidence originator, place_garage_id = stay.garage_id,
  --   originator_rank = garage_member_rank(stay.garage_id, originator) at observed_at.

  -- supersede current edges no longer wanted
  UPDATE image_cohort_edges e SET superseded_at = now()
  WHERE e.image_id = ANY (p_ids) AND e.superseded_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM _ice_want w WHERE w.image_id = e.image_id AND w.cohort_kind = e.cohort_kind AND w.cohort_key = e.cohort_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;

  -- insert wanted edges not yet current
  INSERT INTO image_cohort_edges (image_id, cohort_kind, cohort_key, cohort_id, basis, basis_id, originator_user_id, visibility, rule_version)
  SELECT DISTINCT ON (w.image_id, w.cohort_kind, w.cohort_key)
         w.image_id, w.cohort_kind, w.cohort_key, w.cohort_id, w.basis, w.basis_id, w.originator_user_id, w.visibility, w.rule_version
  FROM _ice_want w
  ON CONFLICT (image_id, cohort_kind, cohort_key) WHERE superseded_at IS NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;
  RETURN v_changed;
END $$;

-- The fold: a vehicle's own cohorts. Keys are lower case: 'ford', 'ford:mustang', 'ford:mustang:1967'.
CREATE OR REPLACE FUNCTION public.vehicle_cohort_derive(p_ids uuid[], p_rule text DEFAULT 'vehicle_cohort_v1')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_changed integer := 0; v_n integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _vce_want (
    vehicle_id uuid, cohort_kind text, cohort_key text, cohort_id uuid, role text, basis text, basis_id uuid,
    rule_version text) ON COMMIT DROP;
  TRUNCATE _vce_want;
  INSERT INTO _vce_want (vehicle_id, cohort_kind, cohort_key, cohort_id, role, basis, basis_id, rule_version)
  SELECT v.id, k.kind, k.key, NULL, NULL, k.basis, v.id, p_rule
  FROM vehicles v
  CROSS JOIN LATERAL (VALUES
    ('make',       lower(btrim(v.make)),                                                         'vehicles.make'),
    ('model',      lower(btrim(v.make)) || ':' || lower(btrim(v.model)),                         'vehicles.model'),
    ('year_model', lower(btrim(v.make)) || ':' || lower(btrim(v.model)) || ':' || v.year::text,   'vehicles.year'),
    ('generation', lower(btrim(v.make)) || ':' || lower(btrim(v.model)) || ':g:' || lower(btrim(v.generation)), 'vehicles.generation'),
    ('series',     lower(btrim(v.make)) || ':s:' || lower(btrim(v.series)),                      'vehicles.series')
  ) AS k(kind, key, basis)
  WHERE v.id = ANY (p_ids) AND k.key IS NOT NULL AND k.key <> '' AND k.key !~ '(^:|::|:$|:g:$|:s:$)'
  UNION ALL
  SELECT ov.vehicle_id, 'organization', ov.organization_id::text, ov.organization_id, ov.relationship_type,
         'organization_vehicles', ov.id, p_rule
  FROM organization_vehicles ov
  WHERE ov.vehicle_id = ANY (p_ids) AND coalesce(ov.user_rejected, false) = false
    AND (ov.end_date IS NULL OR ov.end_date >= current_date);

  UPDATE vehicle_cohort_edges e SET superseded_at = now()
  WHERE e.vehicle_id = ANY (p_ids) AND e.superseded_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM _vce_want w WHERE w.vehicle_id = e.vehicle_id AND w.cohort_kind = e.cohort_kind
                    AND w.cohort_key = e.cohort_key AND coalesce(w.role,'') = coalesce(e.role,''));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;
  INSERT INTO vehicle_cohort_edges (vehicle_id, cohort_kind, cohort_key, cohort_id, role, basis, basis_id, rule_version)
  SELECT DISTINCT ON (w.vehicle_id, w.cohort_kind, w.cohort_key, coalesce(w.role,''))
         w.vehicle_id, w.cohort_kind, w.cohort_key, w.cohort_id, w.role, w.basis, w.basis_id, w.rule_version
  FROM _vce_want w
  ON CONFLICT (vehicle_id, cohort_kind, cohort_key, coalesce(role,'')) WHERE superseded_at IS NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;
  RETURN v_changed;
END $$;

-- Throttled drain shared shape: paused flag, active-backend ceiling, time budget, SKIP LOCKED claims.
CREATE OR REPLACE FUNCTION public.image_cohort_drain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce((SELECT config_value FROM platform_config WHERE config_key = 'image_cohort_graph'), '{"paused":true}');
  v_batch int := least(coalesce((cfg->>'image_batch')::int, 500), 2000);
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => coalesce((cfg->>'budget_ms')::int, 2000) / 1000.0);
  v_ids uuid[]; v_done int := 0; v_changed int := 0;
BEGIN
  IF coalesce((cfg->>'paused')::boolean, true) THEN RETURN jsonb_build_object('skipped', 'paused'); END IF;
  IF (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') > coalesce((cfg->>'max_active_backends')::int, 40) THEN
    RETURN jsonb_build_object('skipped', 'busy');
  END IF;
  PERFORM set_config('statement_timeout', '5s', true);
  PERFORM set_config('lock_timeout', '1s', true);
  LOOP
    EXIT WHEN clock_timestamp() >= v_deadline OR v_done >= v_batch;
    WITH c AS (SELECT image_id FROM image_cohort_queue ORDER BY enqueued_at LIMIT 200 FOR UPDATE SKIP LOCKED),
         d AS (DELETE FROM image_cohort_queue q USING c WHERE q.image_id = c.image_id RETURNING q.image_id)
    SELECT array_agg(image_id) INTO v_ids FROM d;
    EXIT WHEN v_ids IS NULL;
    v_changed := v_changed + public.image_cohort_derive(v_ids);
    v_done := v_done + cardinality(v_ids);
  END LOOP;
  RETURN jsonb_build_object('images', v_done, 'edges_changed', v_changed,
                            'queue_left', (SELECT count(*) FROM image_cohort_queue));
END $$;

CREATE OR REPLACE FUNCTION public.vehicle_cohort_drain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce((SELECT config_value FROM platform_config WHERE config_key = 'image_cohort_graph'), '{"paused":true}');
  v_batch int := least(coalesce((cfg->>'vehicle_batch')::int, 2000), 5000);
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => coalesce((cfg->>'budget_ms')::int, 2000) / 1000.0);
  v_ids uuid[]; v_done int := 0; v_changed int := 0;
BEGIN
  IF coalesce((cfg->>'paused')::boolean, true) THEN RETURN jsonb_build_object('skipped', 'paused'); END IF;
  IF (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') > coalesce((cfg->>'max_active_backends')::int, 40) THEN
    RETURN jsonb_build_object('skipped', 'busy');
  END IF;
  PERFORM set_config('statement_timeout', '5s', true);
  PERFORM set_config('lock_timeout', '1s', true);
  LOOP
    EXIT WHEN clock_timestamp() >= v_deadline OR v_done >= v_batch;
    WITH c AS (SELECT vehicle_id FROM vehicle_cohort_queue ORDER BY enqueued_at LIMIT 500 FOR UPDATE SKIP LOCKED),
         d AS (DELETE FROM vehicle_cohort_queue q USING c WHERE q.vehicle_id = c.vehicle_id RETURNING q.vehicle_id)
    SELECT array_agg(vehicle_id) INTO v_ids FROM d;
    EXIT WHEN v_ids IS NULL;
    v_changed := v_changed + public.vehicle_cohort_derive(v_ids);
    v_done := v_done + cardinality(v_ids);
  END LOOP;
  RETURN jsonb_build_object('vehicles', v_done, 'edges_changed', v_changed,
                            'queue_left', (SELECT count(*) FROM vehicle_cohort_queue));
END $$;

-- Backfill enqueuers: keyset pages, one short statement each. Call repeatedly with the returned cursor.
CREATE OR REPLACE FUNCTION public.image_cohort_backfill_enqueue(p_after uuid DEFAULT NULL, p_limit int DEFAULT 2000)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH page AS (
    SELECT id FROM vehicle_images
    WHERE user_id IS NOT NULL AND (p_after IS NULL OR id > p_after)
    ORDER BY id LIMIT least(p_limit, 5000)
  ), ins AS (
    INSERT INTO image_cohort_queue (image_id, reason) SELECT id, 'backfill' FROM page ON CONFLICT DO NOTHING
  )
  SELECT id FROM page ORDER BY id DESC LIMIT 1;   -- next cursor; NULL = done (no max(uuid) aggregate)
$$;

CREATE OR REPLACE FUNCTION public.vehicle_cohort_backfill_enqueue(p_after uuid DEFAULT NULL, p_limit int DEFAULT 5000)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH page AS (
    SELECT id FROM vehicles WHERE (p_after IS NULL OR id > p_after) ORDER BY id LIMIT least(p_limit, 10000)
  ), ins AS (
    INSERT INTO vehicle_cohort_queue (vehicle_id, reason) SELECT id, 'backfill' FROM page ON CONFLICT DO NOTHING
  )
  SELECT id FROM page ORDER BY id DESC LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.image_cohort_derive(uuid[], text), public.vehicle_cohort_derive(uuid[], text),
  public.image_cohort_drain(), public.vehicle_cohort_drain(),
  public.image_cohort_backfill_enqueue(uuid, int), public.vehicle_cohort_backfill_enqueue(uuid, int)
  FROM PUBLIC, anon, authenticated;

commit;
