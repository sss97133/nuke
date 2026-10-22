-- Rows protected by immutability triggers (e.g. guard_bat_sale_work on derivation_queue raises P0001) stay on the
-- secondary like constraint-blocked rows, instead of aborting the whole fold. Also skips seq-scanning large unindexed FK tables.
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fold_vehicle_into_primary_supersede(
  p_primary uuid, p_secondary uuid, p_run_id uuid, p_reason text DEFAULT 'identifier dedup')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; c record; v_moved int; v_left int; v_out jsonb := '{}'::jsonb;
  v_src jsonb;
BEGIN
  IF p_primary IS NULL OR p_secondary IS NULL OR p_primary = p_secondary THEN
    RAISE EXCEPTION 'fold: bad pair % -> %', p_secondary, p_primary;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_primary AND merged_into_vehicle_id IS NULL) THEN
    RAISE EXCEPTION 'fold: primary % missing or itself merged', p_primary;
  END IF;
  IF EXISTS (SELECT 1 FROM vehicles WHERE id = p_secondary AND merged_into_vehicle_id IS NOT NULL) THEN
    RETURN jsonb_build_object('skipped', 'already merged');
  END IF;

  -- Child tables: every single-column FK to vehicles(id) on a table with a uuid "id". Audit/proposal tables excluded.
  FOR c IN
    SELECT con.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute ida ON ida.attrelid = con.conrelid AND ida.attname = 'id' AND ida.atttypid = 'uuid'::regtype
    WHERE con.contype = 'f' AND con.confrelid = 'public.vehicles'::regclass AND array_length(con.conkey,1) = 1
      AND con.conrelid::regclass::text NOT IN ('merge_proposals','vehicle_merge_proposals','reattribution_audit','superseded_rows')
      -- Large tables with no index on the FK (analysis_events, derivation_queue) would be a seq scan per fold;
      -- their rows stay on the secondary, reachable via merged_into_vehicle_id.
      AND (EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = con.conrelid AND i.indkey[0] = con.conkey[1])
           OR (SELECT reltuples FROM pg_class WHERE oid = con.conrelid) < 100000)
  LOOP
    v_moved := 0; v_left := 0;
    FOR r IN EXECUTE format('SELECT id, to_jsonb(t) AS j FROM %s t WHERE %I = $1', c.tbl, c.col) USING p_secondary LOOP
      BEGIN
        v_src := jsonb_build_object('run_id', p_run_id, 'op', 'repoint', 'column', c.col, 'from', p_secondary, 'to', p_primary);
        INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
        VALUES (c.tbl::text, r.id, r.j, 'fold_vehicle_into_primary_supersede', v_src, p_reason);
        EXECUTE format('UPDATE %s SET %I = $1 WHERE id = $2', c.tbl, c.col) USING p_primary, r.id;
        v_moved := v_moved + 1;
      EXCEPTION WHEN unique_violation OR check_violation OR exclusion_violation OR raise_exception OR foreign_key_violation OR not_null_violation THEN
        v_left := v_left + 1;  -- subtransaction rolled back the backup row too
      END;
    END LOOP;
    IF v_moved + v_left > 0 THEN
      v_out := v_out || jsonb_build_object(c.tbl::text || '.' || c.col, jsonb_build_object('moved', v_moved, 'left', v_left));
    END IF;
  END LOOP;

  INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
  SELECT 'vehicles', v.id, to_jsonb(v), 'fold_vehicle_into_primary_supersede',
         jsonb_build_object('run_id', p_run_id, 'op', 'supersede', 'to', p_primary), p_reason
  FROM vehicles v WHERE v.id = p_secondary;
  UPDATE vehicles SET merged_into_vehicle_id = p_primary, is_public = false, updated_at = now() WHERE id = p_secondary;

  RETURN jsonb_build_object('primary', p_primary, 'secondary', p_secondary, 'children', v_out);
END $$;
