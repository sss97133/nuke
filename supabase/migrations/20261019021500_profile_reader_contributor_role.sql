-- Creator provenance is not ownership for explicitly contributed records.
-- Preserve the existing invoker reader, policies, grants and explicit ownership evidence.
SET lock_timeout = '3s';
SET statement_timeout = '10s';
DO $patch$
DECLARE
  d text := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  old_columns text := 'SELECT id, user_id, owner_id, uploaded_by,';
  new_columns text := 'SELECT id, user_id, owner_id, uploaded_by, entry_type,';
  old_role text := 'WHEN who.uid = v.user_id OR who.uid = v.owner_id';
  new_role text := 'WHEN (who.uid = v.user_id AND coalesce(v.entry_type, ''owner_claim'') <> ''contributor_data'') OR who.uid = v.owner_id';
BEGIN
  IF position(new_columns IN d) > 0 AND position(new_role IN d) > 0 THEN RETURN; END IF;
  IF position(old_columns IN d) = 0 OR position(old_role IN d) = 0
    OR (length(d) - length(replace(d, old_role, ''))) / length(old_role) <> 1 THEN
    RAISE EXCEPTION 'vehicle_profile_read viewer owner drift; review before applying';
  END IF;
  EXECUTE replace(replace(d, old_columns, new_columns), old_role, new_role);
END
$patch$;
