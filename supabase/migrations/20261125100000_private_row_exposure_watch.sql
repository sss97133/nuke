-- private_row_exposure_v1: a standing assay of photo, user and document rows that anon or a stranger can read.
--
-- WHY. Audit 2026-11-25 (board, ta-skeptic; counts only): logged out, image_descriptions served 9,581 rows on unfiled
-- photos, image_vehicle_mismatches 1,667 of 1,750 on unfiled photos, image_condition_observations 600 unfiled + 662 on
-- non-public cars, user_presence 869 rows naming a user; any signed-in user read image_angle_observations (18,770 rows
-- on non-public cars) and three more photo-reading tables. Each fix lands per table (owners on the board); this is the
-- acceptance that stays: the lead's order "a standing assay to v_job_health: count of tables in that family whose anon
-- or cross-user probe returns > 0 private rows; target 0".
--
-- ROWS. private_row_probes: one row per (relation, subject kind, subject column): which rows of the relation are
--   private and who owns the fix. Kinds (the predicate, run as postgres):
--     image       the subject column names a photo that is not gallery-eligible on a public, undeleted vehicle
--     vehicle     the subject column names a vehicle that is not public or is deleted
--     user        the subject column names a user (the row is that user's activity)
--     flag        the boolean subject column is true
--     visibility  the text subject column is not 'public'
--   service_records.cost (audit row 13) is a column mask on rows that are public, not a private row: not probed here.
--
-- READING. assay_private_row_exposure(): per probe, up to sample_size keys of private rows (as postgres), then the number of
--   those rows anon, and an authenticated caller with a random sub (a stranger: no uploads, no ties), can SELECT, each
--   under SET LOCAL ROLE inside a subtransaction, so the role and claims never leak past the probe. exposed_relations =
--   relations where either audience sees > 0 of them; target 0. A relation that no longer exists reads missing.
--   No row is read for its content; only keys and counts.
-- JOB. private-row-exposure-watch (hourly, :41) runs private_row_exposure_watch(), which raises while exposed_relations > 0,
--   naming each relation, its owner and the visible counts, so v_job_health shows the job failed with that list until the
--   fixes deploy. Measured on production 2026-11-25 (rolled back): 2.3 s; 14 of 15 relations exposed.
-- NOT CHANGED. No probed table, policy or grant. Both functions run as their caller (SET ROLE is refused in a definer
--   function) and only postgres may execute them.
-- REVERT. SELECT cron.unschedule('private-row-exposure-watch'); DROP FUNCTION public.private_row_exposure_watch(),
--   public.assay_private_row_exposure(); DROP TABLE public.private_row_probes;
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.private_row_probes (
  relation text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('image', 'vehicle', 'user', 'flag', 'visibility')),
  subject_column text NOT NULL,
  row_key text NOT NULL,
  rank smallint NOT NULL,
  owner_lane text NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) >= 12),
  audiences text[] NOT NULL DEFAULT '{anon,authenticated}' CHECK (audiences <@ '{anon,authenticated}'::text[] AND cardinality(audiences) > 0),
  sample_size integer NOT NULL DEFAULT 50 CHECK (sample_size BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (relation, subject_kind, subject_column)
);
COMMENT ON TABLE public.private_row_probes IS
  'private_row_exposure_v1: which rows of a relation are private (subject kind + column) and who owns the fix; read by assay_private_row_exposure(). Ranked by the 2026-11-25 exposure audit.';
ALTER TABLE public.private_row_probes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_row_probes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.private_row_probes TO service_role;

INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, owner_lane, note) VALUES
  (1, 'user_presence', 'id', 'user', 'user_id', 'ta-packet', 'who was on which car page when; client writes its own row only'),
  (2, 'image_descriptions', 'id', 'image', 'image_id', 'ta-pipeline', 'model description text of a photo'),
  (3, 'image_vehicle_mismatches', 'id', 'image', 'image_id', 'ta-pipeline', 'which car an unfiled photo looks like'),
  (4, 'image_condition_observations', 'id', 'image', 'image_id', 'ta-pipeline', 'condition readings of a photo'),
  (5, 'organization_images', 'id', 'visibility', 'visibility_level', 'ta-paper', 'org photos marked internal_only'),
  (5, 'organization_images', 'id', 'flag', 'contains_financial_data', 'ta-paper', 'org photos flagged as holding financial data'),
  (5, 'organization_images', 'id', 'flag', 'is_sensitive', 'ta-paper', 'org photos flagged sensitive'),
  (6, 'appraisal_canon_checks', 'observation_id', 'image', 'image_id', 'ta-pipeline', 'canon verdicts per photo (owner-run matview)'),
  (7, 'ai_scan_sessions', 'id', 'vehicle', 'vehicle_id', 'ta-pipeline', 'scan sessions with photo id lists'),
  (8, 'vehicle_views', 'id', 'user', 'user_id', 'ta-packet', 'who viewed which car when'),
  (9, 'image_angle_observations', 'id', 'image', 'image_id', 'ta-pipeline', 'angle readings of a photo'),
  (10, 'ai_angle_classifications_audit', 'id', 'image', 'image_id', 'ta-pipeline', 'angle audit of a photo'),
  (11, 'image_question_answers', 'id', 'image', 'image_id', 'ta-pipeline', 'answers read from a photo'),
  (12, 'image_spatial_metadata', 'id', 'image', 'image_id', 'ta-pipeline', 'spatial and repair readings of a photo'),
  (14, 'vehicle_field_sources', 'id', 'vehicle', 'vehicle_id', 'unassigned', 'field sources of a car'),
  (14, 'image_tags', 'id', 'vehicle', 'vehicle_id', 'unassigned', 'photo tags of a car'),
  (14, 'session_narratives', 'id', 'vehicle', 'vehicle_id', 'ta-pipeline', 'photo session narratives')
ON CONFLICT (relation, subject_kind, subject_column) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assay_private_row_exposure()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $fn$
DECLARE
  p record; aud text; keys text[]; ktype text; seen bigint; per jsonb := '[]'::jsonb; exposed text[] := '{}'; hit boolean;
  priv text; sub text; t0 timestamptz := clock_timestamp(); err text; aud_out jsonb;
BEGIN
  FOR p IN SELECT * FROM public.private_row_probes WHERE active ORDER BY rank, relation LOOP
    priv := CASE p.subject_kind
      WHEN 'image' THEN format('x.%1$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicle_images vi JOIN public.vehicles v ON v.id = vi.vehicle_id
                                 WHERE vi.id = x.%1$I AND v.is_public AND v.deleted_at IS NULL AND public.vehicle_image_gallery_eligible(vi))', p.subject_column)
      WHEN 'vehicle' THEN format('x.%1$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = x.%1$I AND v.is_public AND v.deleted_at IS NULL)', p.subject_column)
      WHEN 'user' THEN format('x.%I IS NOT NULL', p.subject_column)
      WHEN 'flag' THEN format('coalesce(x.%I, false)', p.subject_column)
      WHEN 'visibility' THEN format('coalesce(x.%I, ''public'') <> ''public''', p.subject_column)
    END;
    ktype := NULL;
    SELECT format_type(a.atttypid, a.atttypmod) INTO ktype FROM pg_attribute a
     WHERE a.attrelid = to_regclass(format('public.%I', p.relation)) AND a.attname = p.row_key AND NOT a.attisdropped;
    IF ktype IS NULL THEN
      per := per || jsonb_build_object('relation', p.relation, 'kind', p.subject_kind, 'owner', p.owner_lane, 'missing', true);
      CONTINUE;
    END IF;
    EXECUTE format('SELECT array_agg(k) FROM (SELECT x.%I::text AS k FROM public.%I x WHERE %s LIMIT %s) s',
                   p.row_key, p.relation, priv, p.sample_size) INTO keys;
    aud_out := '{}'::jsonb; hit := false;
    FOREACH aud IN ARRAY p.audiences LOOP
      seen := NULL; err := NULL;
      IF coalesce(cardinality(keys), 0) > 0 THEN
        sub := CASE aud WHEN 'authenticated' THEN gen_random_uuid()::text END;
        BEGIN
          PERFORM set_config('request.jwt.claims', jsonb_build_object('role', aud, 'sub', sub)::text, true);
          PERFORM set_config('role', aud, true);
          EXECUTE format('SELECT count(*) FROM public.%I x WHERE x.%I = ANY ($1::%s[])', p.relation, p.row_key, ktype)
             INTO seen USING keys;
          PERFORM set_config('role', 'none', true);
        EXCEPTION WHEN insufficient_privilege THEN
          seen := 0; err := 'denied';      -- the subtransaction's rollback also restores the role
        END;
        PERFORM set_config('role', 'none', true);
        PERFORM set_config('request.jwt.claims', '', true);
      END IF;
      hit := hit OR coalesce(seen, 0) > 0;
      aud_out := aud_out || jsonb_build_object(aud, coalesce(seen, 0));
    END LOOP;
    IF hit AND NOT p.relation = ANY (exposed) THEN exposed := exposed || p.relation; END IF;
    per := per || jsonb_build_object('relation', p.relation, 'kind', p.subject_kind, 'owner', p.owner_lane,
                                     'private_sampled', coalesce(cardinality(keys), 0), 'visible', aud_out, 'exposed', hit);
  END LOOP;
  RETURN jsonb_build_object('exposed_relations', cardinality(exposed), 'exposed', to_jsonb(exposed),
                            'probed_relations', (SELECT count(DISTINCT relation) FROM public.private_row_probes WHERE active),
                            'probes', jsonb_array_length(per), 'relations', per,
                            'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int, 'assayed_at', now());
END $fn$;

REVOKE ALL ON FUNCTION public.assay_private_row_exposure() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.private_row_exposure_watch()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $fn$
DECLARE r jsonb; msg text;
BEGIN
  r := public.assay_private_row_exposure();
  IF (r->>'exposed_relations')::int > 0 THEN
    SELECT string_agg(format('%s [%s] anon %s, stranger %s of %s', x->>'relation', x->>'owner',
                             coalesce(x#>>'{visible,anon}', '-'), coalesce(x#>>'{visible,authenticated}', '-'), x->>'private_sampled'), '; ')
      INTO msg FROM jsonb_array_elements(r->'relations') x WHERE (x->>'exposed')::boolean;
    RAISE EXCEPTION 'private rows readable in % of % relations: %', r->>'exposed_relations', r->>'probed_relations', msg;
  END IF;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.private_row_exposure_watch() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('private-row-exposure-watch', '41 * * * *', 'SELECT public.private_row_exposure_watch()');
