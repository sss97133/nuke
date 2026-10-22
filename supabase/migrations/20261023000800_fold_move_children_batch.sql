-- Bounded pre-move for big fold children (e.g. 1,000+ vehicle_images whose per-row triggers cascade into vehicles).
-- Moves at most p_limit rows of one child table from secondary to primary, writing the same 'repoint' before-images
-- as fold_vehicle_into_primary_supersede, so revert_vehicle_fold_run(run_id) restores them unchanged.
-- Call repeatedly until it returns 0, then run the regular fold. No triggers are disabled.
CREATE OR REPLACE FUNCTION public.fold_move_children_batch(
  p_primary uuid, p_secondary uuid, p_run_id uuid, p_table text, p_column text DEFAULT 'vehicle_id',
  p_limit int DEFAULT 200, p_reason text DEFAULT 'identifier dedup')
RETURNS int LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF p_primary IS NULL OR p_secondary IS NULL OR p_primary = p_secondary OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'fold batch: bad pair % -> %', p_secondary, p_primary;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND con.confrelid = 'public.vehicles'::regclass AND array_length(con.conkey,1) = 1
      AND con.conrelid = to_regclass('public.' || p_table) AND a.attname = p_column) THEN
    RAISE EXCEPTION 'fold batch: %.% is not a vehicles FK', p_table, p_column;
  END IF;
  FOR r IN EXECUTE format('SELECT id, to_jsonb(t) AS j FROM public.%I t WHERE %I = $1 ORDER BY id LIMIT $2', p_table, p_column)
           USING p_secondary, p_limit LOOP
    BEGIN
      INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
      VALUES (p_table, r.id, r.j, 'fold_move_children_batch',
              jsonb_build_object('run_id', p_run_id, 'op', 'repoint', 'column', p_column, 'from', p_secondary, 'to', p_primary), p_reason);
      EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I = $3', p_table, p_column, p_column)
        USING p_primary, r.id, p_secondary;
      n := n + 1;
    EXCEPTION WHEN unique_violation OR check_violation OR exclusion_violation OR raise_exception OR foreign_key_violation OR not_null_violation THEN
      NULL; -- left on the secondary, same as the main fold
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fold_move_children_batch(uuid,uuid,uuid,text,text,int,text) FROM PUBLIC, anon, authenticated;
