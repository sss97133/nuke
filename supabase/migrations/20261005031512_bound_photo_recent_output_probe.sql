-- Live owner read timed out. Plan fetched metadata before LIMIT and estimated
-- ~80M recent joined rows. Limit source IDs first and use existence counts;
-- preserve grains, denominators, owner gate and every other reader field.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
DO $repair$
DECLARE
  definition text:=pg_get_functiondef('public.get_photo_library_stats(uuid)'::regprocedure);
  old_1 text:=$old1$      ), recent AS MATERIALIZED (
        SELECT i.id, i.ai_processing_status, i.created_at,
               v.ai_scan_metadata->>'classifier_failed' = 'true' AS classifier_failed
        FROM images i JOIN public.vehicle_images v ON v.id = i.id
        ORDER BY i.created_at DESC NULLS LAST, i.id DESC LIMIT 100
      )$old1$;
  new_1 text:=$new1$      ), recent_ids AS MATERIALIZED (
        SELECT id, ai_processing_status, created_at FROM images
        ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 100
      ), recent AS MATERIALIZED (
        SELECT r.id, r.ai_processing_status, r.created_at,
               v.ai_scan_metadata->>'classifier_failed' = 'true' AS classifier_failed
        FROM recent_ids r JOIN public.vehicle_images v ON v.id=r.id
      )$new1$;
  old_2 text:=$old2$          'with_analysis_records',count(a.image_id),'with_work_extractions',count(w.image_id),
          'with_witnesses',count(ow.image_id))
          FROM recent r LEFT JOIN analysis a ON a.image_id=r.id
          LEFT JOIN work w ON w.image_id=r.id LEFT JOIN witnesses ow ON ow.image_id=r.id),$old2$;
  new_2 text:=$new2$          'with_analysis_records',(SELECT count(*) FROM recent r WHERE EXISTS (SELECT 1 FROM analysis a WHERE a.image_id=r.id)),
          'with_work_extractions',(SELECT count(*) FROM recent r WHERE EXISTS (SELECT 1 FROM work w WHERE w.image_id=r.id)),
          'with_witnesses',(SELECT count(*) FROM recent r WHERE EXISTS (SELECT 1 FROM witnesses ow WHERE ow.image_id=r.id)))
          FROM recent r),$new2$;
BEGIN
  IF strpos(definition,old_1)=0 OR strpos(definition,old_2)=0 THEN
    RAISE EXCEPTION 'Photo reader changed; expected recent probe fragments absent';
  END IF;
  EXECUTE replace(replace(definition,old_1,new_1),old_2,new_2);
END $repair$;
NOTIFY pgrst,'reload schema';
COMMIT;
