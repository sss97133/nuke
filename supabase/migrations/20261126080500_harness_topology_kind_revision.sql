-- Preserve explicit route-point kind corrections in the existing revision owner.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE b text:=pg_get_functiondef('public.load_harness_topology_points(uuid,jsonb,text)'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($old$n_kept int; n_bad int;$old$,$new$n_kept int; n_bad int; n_reclassified int;$new$),
 ($old$coalesce(nullif(btrim(r->>'kind'), ''), 'device'),$old$,$new$nullif(btrim(r->>'kind'), ''),$new$),
 ($old$  WHERE p.node_code IS NOT NULL;$old$,$new$  WHERE p.node_code IS NOT NULL;
  -- Omission is not a reclassification. Existing points retain their recorded
  -- kind; the historical device default applies only to a new point.
  UPDATE topo_point p SET kind=coalesce(p.kind,(SELECT n.kind FROM public.harness_topology_nodes n WHERE n.id=p.live_id),'device');$new$),
 ($old$-- a new row only when the point moved (coordinates to the millimetre); new words alone do not move it (pass 36)$old$,
  $new$-- Geometry or an explicit kind change creates a revision. New words alone do not.$new$),
 ($old$AND round(n.pos_z_m, 3) = round(p.z, 3));$old$,
  $new$AND round(n.pos_z_m, 3) = round(p.z, 3) AND n.kind IS NOT DISTINCT FROM p.kind);$new$),
 ($old$-- RSI pass 36: a point that has not moved keeps its row$old$,
  $new$-- Same geometry and kind retain the current row.$new$),
 ($old$  -- one live row per point (harness_topology_nodes_live_key): retire the live row, write the new one, then link them$old$,
  $new$  SELECT count(*) INTO n_reclassified FROM topo_point p JOIN public.harness_topology_nodes n ON n.id=p.live_id
   WHERE p.new_id IS NOT NULL AND n.kind IS DISTINCT FROM p.kind;
  -- one live row per point (harness_topology_nodes_live_key): retire the live row, write the new one, then link them$new$),
 ($old$'points_unchanged', n_kept)$old$,$new$'points_unchanged', n_kept,'points_reclassified',n_reclassified)$new$)
 ) changes(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'route point revision anchor drift: %',left(a,90); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $patch$;
COMMENT ON FUNCTION public.load_harness_topology_points(uuid,jsonb,text) IS 'Existing service-only route-point writer. Geometry changes to the millimetre or explicit kind corrections supersede the prior point and retain its history. Omitted/blank kind preserves an existing kind, defaulting to device only for new points. Text-only edits retain the row. points_reclassified is a subset of historical points_moved (revised existing rows); no physical move, electrical connection or construction release is inferred. Callers retain the existing endpoint/branch relinking sequence.';
COMMIT;
