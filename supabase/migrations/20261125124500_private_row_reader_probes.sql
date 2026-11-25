-- private_row_reader_probes_v1: the exposure watch also probes SECURITY DEFINER readers, not only tables.
--
-- WHY. A definer function runs as its owner, so RLS on the tables it reads does not apply to its caller. The
-- 2026-11-25 sweep of definer readers that anon may execute found two that return private rows to anon:
--   get_image_deep_analysis(uuid): 50 of 50 sampled unfiled / non-public-car photos returned their analysis row;
--   intake_live_state(50, 10): 17 of 50 feed photos fail vehicle_image_gallery_eligible; the fleet names 2 cars
--   that are not public. A table probe cannot see either, so the hourly watch stayed blind to them.
--
-- WHAT CHANGES. private_row_probes gains a reader:
--   reader         '' = count the relation's own rows (as before); else a function in public, called as each audience.
--   reader_args    NULL = keyed reader: called once per sampled private key, reader(key); rows returned are visible.
--                  else = feed reader: called once with these constant arguments; reader_ids (a jsonpath over the
--                  jsonb_agg of its result) picks the subject ids it returned, and those that are private by the
--                  probe's subject_kind (judged as postgres against relation.row_key) are the visible count.
--   sample_filter  an extra predicate on the sampled source rows (alias x), so a keyed reader is probed with keys
--                  it has something to answer for.
--   The primary key becomes (relation, subject_kind, subject_column, reader).
-- Three probe rows are added (owner lane ta-pipeline), anon only: a definer reader answers every caller alike unless
-- its body tests the caller, and anon is the wider audience. The table stays postgres-only, so these SQL fragments
-- are written by migrations alone; CHECKs hold their shape.
-- The two intake_live_state rows land inactive: inside the hourly assay the reader ran past the 10 s postgres
-- statement timeout (measured 2026-11-25 in a rolled-back prototype; 1.0 s warm / 6.6 s cold alone as anon), and a
-- watch that times out reports its own cost, not the exposure. They are switched on in the migration that makes
-- intake_live_state cheap or caller-tested.
--
-- EXPECTED on deploy: the assay reports get_image_deep_analysis() exposed beside the tables (11 -> 12 exposed names).
--
-- REVERT. Re-run 20261125100000's assay body, then DELETE the rows with reader <> '' and drop the four columns.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.private_row_probes
  ADD COLUMN IF NOT EXISTS reader text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reader_args text,
  ADD COLUMN IF NOT EXISTS reader_ids text,
  ADD COLUMN IF NOT EXISTS sample_filter text;

ALTER TABLE public.private_row_probes DROP CONSTRAINT IF EXISTS private_row_probes_reader_shape;
ALTER TABLE public.private_row_probes ADD CONSTRAINT private_row_probes_reader_shape CHECK (
  reader ~ '^([a-z_][a-z0-9_]*)?$'
  AND (reader_args IS NULL) = (reader_ids IS NULL)
  AND (reader_args IS NULL OR (reader <> '' AND reader_args ~ '^[0-9, ]*$' AND reader_ids::jsonpath IS NOT NULL))
  AND (sample_filter IS NULL OR (reader_args IS NULL AND position(';' IN sample_filter) = 0)));

ALTER TABLE public.private_row_probes DROP CONSTRAINT IF EXISTS private_row_probes_pkey;
ALTER TABLE public.private_row_probes ADD CONSTRAINT private_row_probes_pkey
  PRIMARY KEY (relation, subject_kind, subject_column, reader);

COMMENT ON COLUMN public.private_row_probes.reader IS
  'private_row_reader_probes_v1: '''' probes the relation''s rows; a public function name probes that reader as each audience.';

INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, reader, reader_args, reader_ids,
                                       sample_filter, owner_lane, note, audiences, active) VALUES
  (20, 'image_observations', 'image_id', 'image', 'image_id', 'get_image_deep_analysis', NULL, NULL,
   'x.observed_by = ''caller-byok'' AND x.is_active', 'ta-pipeline',
   'definer reader: a photo''s deep analysis (narrative, intent, scene, place hint) by image id', '{anon}', true),
  (21, 'vehicle_images', 'id', 'image', 'id', 'intake_live_state', '50, 10', '$[*].feed[*].id', NULL, 'ta-pipeline',
   'definer feed: newest analysed photos with url and narrative line (inactive: cost)', '{anon}', false),
  (22, 'vehicles', 'id', 'vehicle', 'id', 'intake_live_state', '50, 10', '$[*].fleet[*].vehicle_id', NULL, 'ta-pipeline',
   'definer feed: per-car burn progress naming year, make and model (inactive: cost)', '{anon}', false)
ON CONFLICT (relation, subject_kind, subject_column, reader) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assay_private_row_exposure()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $fn$
DECLARE
  p record; aud text; keys text[]; ktype text; seen bigint; per jsonb := '[]'::jsonb; exposed text[] := '{}'; hit boolean;
  priv text; sub text; t0 timestamptz := clock_timestamp(); err text; aud_out jsonb; label text; ids jsonb; returned int;
BEGIN
  -- private_row_reader_probes_v1
  FOR p IN SELECT * FROM public.private_row_probes WHERE active ORDER BY rank, relation, reader LOOP
    label := CASE WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;
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
    IF ktype IS NULL OR (p.reader <> '' AND NOT EXISTS (
        SELECT 1 FROM pg_proc f WHERE f.pronamespace = 'public'::regnamespace AND f.proname = p.reader)) THEN
      per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane, 'missing', true);
      CONTINUE;
    END IF;
    keys := NULL;
    IF p.reader_args IS NULL THEN
      EXECUTE format('SELECT array_agg(k) FROM (SELECT x.%I::text AS k FROM public.%I x WHERE %s AND (%s) LIMIT %s) s',
                     p.row_key, p.relation, priv, coalesce(p.sample_filter, 'true'), p.sample_size) INTO keys;
    END IF;
    aud_out := '{}'::jsonb; hit := false; returned := NULL;
    FOREACH aud IN ARRAY p.audiences LOOP
      seen := NULL; err := NULL; ids := NULL;
      IF p.reader_args IS NOT NULL OR coalesce(cardinality(keys), 0) > 0 THEN
        sub := CASE aud WHEN 'authenticated' THEN gen_random_uuid()::text END;
        BEGIN
          PERFORM set_config('request.jwt.claims', jsonb_build_object('role', aud, 'sub', sub)::text, true);
          PERFORM set_config('role', aud, true);
          IF p.reader = '' THEN
            EXECUTE format('SELECT count(*) FROM public.%I x WHERE x.%I = ANY ($1::%s[])', p.relation, p.row_key, ktype)
               INTO seen USING keys;
          ELSIF p.reader_args IS NULL THEN
            EXECUTE format('SELECT count(*) FROM unnest($1::%s[]) k, LATERAL public.%I(k) r', ktype, p.reader)
               INTO seen USING keys;
          ELSE
            EXECUTE format('SELECT jsonb_path_query_array(coalesce(jsonb_agg(t), ''[]''), %L::jsonpath) FROM public.%I(%s) t',
                           p.reader_ids, p.reader, p.reader_args) INTO ids;
          END IF;
          PERFORM set_config('role', 'none', true);
        EXCEPTION WHEN insufficient_privilege THEN
          seen := 0; ids := NULL; err := 'denied';  -- the subtransaction's rollback also restores the role
        END;
        PERFORM set_config('role', 'none', true);
        PERFORM set_config('request.jwt.claims', '', true);
        IF ids IS NOT NULL THEN                      -- feed reader: judge what it returned, as postgres
          returned := greatest(coalesce(returned, 0), jsonb_array_length(ids));
          EXECUTE format('SELECT count(*) FROM jsonb_array_elements_text($1) e(k) JOIN public.%I x ON x.%I::text = e.k WHERE %s',
                         p.relation, p.row_key, priv) INTO seen USING ids;
        END IF;
      END IF;
      hit := hit OR coalesce(seen, 0) > 0;
      aud_out := aud_out || jsonb_build_object(aud, coalesce(seen, 0));
    END LOOP;
    IF hit AND NOT label = ANY (exposed) THEN exposed := exposed || label; END IF;
    per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane,
                                     'private_sampled', coalesce(returned, cardinality(keys), 0), 'visible', aud_out, 'exposed', hit);
  END LOOP;
  RETURN jsonb_build_object('exposed_relations', cardinality(exposed), 'exposed', to_jsonb(exposed),
                            'probed_relations', (SELECT count(DISTINCT CASE WHEN reader = '' THEN relation ELSE reader || '()' END)
                                                   FROM public.private_row_probes WHERE active),
                            'probes', jsonb_array_length(per), 'relations', per,
                            'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int, 'assayed_at', now());
END $fn$;

REVOKE ALL ON FUNCTION public.assay_private_row_exposure() FROM PUBLIC, anon, authenticated, service_role;
