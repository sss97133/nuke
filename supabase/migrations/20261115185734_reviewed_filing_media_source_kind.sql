-- A real retained-preview canary reached canonical observation intake, which
-- correctly refused provenance for photo_pipeline. Its existing supported kind
-- for image custody/attribution metadata is media. Preserve the source registry
-- and every proof/currentness check; align the consumer with that intake kind.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $repair$
DECLARE definition text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.attribute_testimony(uuid,uuid,jsonb)'::regprocedure)
     IS DISTINCT FROM '90280f53cd795167d04e01a3308c3032'
    OR NOT EXISTS(SELECT 1 FROM public.observation_sources WHERE slug='photo_pipeline'
      AND 'media'=ANY(supported_observations::text[])) THEN
  RAISE EXCEPTION 'reviewed filing owner or supported source kind drifted';
 END IF;
 SELECT pg_get_functiondef('public.attribute_testimony(uuid,uuid,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,$old$proof.kind IS DISTINCT FROM 'provenance'$old$)=0 THEN
  RAISE EXCEPTION 'reviewed filing kind predicate unavailable';
 END IF;
 EXECUTE replace(definition,$old$proof.kind IS DISTINCT FROM 'provenance'$old$,
                            $new$proof.kind IS DISTINCT FROM 'media'$new$);
END;
$repair$;
COMMIT;
