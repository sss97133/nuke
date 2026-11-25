-- assay_private_row_exposure() as live at 2026-11-25T12:25Z (pg_get_functiondef), verbatim, with the one config table it reads.
-- Callers create public.private_row_probes first.
CREATE TABLE IF NOT EXISTS public.platform_config (config_key text PRIMARY KEY, config_value jsonb);
-- The copy registry and its hash function (20261125204500, #3925), verbatim; the assay reads them.
CREATE TABLE IF NOT EXISTS public.private_row_policy_copies (
  reader        text NOT NULL CHECK (reader ~ '^[a-z_][a-z0-9_]*\(([a-z_][a-z0-9_ ]*(\[\])?(, *[a-z_][a-z0-9_ ]*(\[\])?)*)?\)$'),
  relation      text NOT NULL CHECK (relation ~ '^[a-z_][a-z0-9_]*$'),
  policy_filter text NOT NULL CHECK (policy_filter <> '' AND position(';' IN policy_filter) = 0),
  recorded_hash text NOT NULL CHECK (recorded_hash ~ '^[0-9a-f]{32}$'),
  owner_lane    text NOT NULL,
  note          text NOT NULL CHECK (note <> ''),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  active        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (reader, relation, policy_filter)
);
CREATE OR REPLACE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
RETURNS TABLE (policy_hash text, policies int) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_relation !~ '^[a-z_][a-z0-9_]*$' OR position(';' IN p_policy_filter) > 0 THEN
    RAISE EXCEPTION 'private_row_policy_hash: bad relation or filter';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT md5(string_agg(p.policyname || '':'' || p.permissive || '':'' || p.cmd || '':'' || p.roles::text || '':'' || coalesce(p.qual, ''''),
                           ''|'' ORDER BY p.policyname)), count(*)::int
       FROM pg_catalog.pg_policies p WHERE p.schemaname = ''public'' AND p.tablename = %L AND (%s)', p_relation, p_policy_filter);
END $f$;
CREATE OR REPLACE FUNCTION public.assay_private_row_exposure()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  p record; aud text; keys text[]; ktype text; seen bigint; per jsonb := '[]'::jsonb; exposed text[] := '{}'; hit boolean;
  priv text; sub text; t0 timestamptz := clock_timestamp(); err text; aud_out jsonb; label text; ids jsonb; returned int;
  -- private_row_watch_budget_v1
  skipped text[] := '{}';
  timed_out text[] := '{}'; stop boolean := false; tp timestamptz;
  budget_ms int := coalesce((SELECT CASE WHEN c.config_value->>'budget_ms' ~ '^\d{1,6}$' THEN (c.config_value->>'budget_ms')::int END
                               FROM public.platform_config c WHERE c.config_key = 'private_row_watch'), 20000);
BEGIN
  -- private_row_reader_probes_v1
  FOR p IN SELECT q.* FROM (SELECT x.*, row_number() OVER (ORDER BY x.rank, x.relation, x.reader) AS rot_n,
                                     count(*) OVER () AS rot_count
                                FROM public.private_row_probes x WHERE x.active) q
            ORDER BY (q.rot_n + extract(hour FROM now())::int) % q.rot_count, q.rank, q.relation, q.reader LOOP
    label := CASE WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;
    IF stop OR clock_timestamp() - t0 > make_interval(secs => budget_ms / 1000.0) THEN
      IF NOT label = ANY (skipped) THEN skipped := skipped || label; END IF;
      per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane, 'not_assessed', true);
      CONTINUE;
    END IF;
    priv := CASE p.subject_kind
      WHEN 'image' THEN format('x.%1$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicle_images vi JOIN public.vehicles v ON v.id = vi.vehicle_id
                                 WHERE vi.id = x.%1$I AND v.is_public AND v.deleted_at IS NULL AND public.vehicle_image_gallery_eligible(vi))', p.subject_column)
      WHEN 'vehicle' THEN format('x.%1$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = x.%1$I AND v.is_public AND v.deleted_at IS NULL)', p.subject_column)
      WHEN 'user' THEN format('x.%I IS NOT NULL', p.subject_column)
      WHEN 'flag' THEN format('coalesce(x.%I, false)', p.subject_column)
      WHEN 'visibility' THEN format('coalesce(x.%I, ''public'') <> ''public''', p.subject_column)
      WHEN 'withheld_column' THEN format('x.%1$I IS NOT NULL AND NOT has_column_privilege(''anon'', %2$L, %3$L, ''SELECT'')',
                                         p.subject_column, 'public.' || p.relation, p.subject_column)
    END;
    ktype := NULL;
    SELECT format_type(a.atttypid, a.atttypmod) INTO ktype FROM pg_attribute a
     WHERE a.attrelid = to_regclass(format('public.%I', p.relation)) AND a.attname = p.row_key AND NOT a.attisdropped;
    IF ktype IS NULL OR (p.reader <> '' AND NOT EXISTS (
        SELECT 1 FROM pg_proc f WHERE f.pronamespace = 'public'::regnamespace AND f.proname = p.reader)) THEN
      per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane, 'missing', true);
      CONTINUE;
    END IF;
    BEGIN  -- probe guard: the job's statement_timeout firing here ends this probe and the probing
    tp := clock_timestamp();
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
            EXECUTE format('SELECT count(*) FROM unnest($1::%s[]) k, LATERAL public.%I(k%s) r %s', ktype, p.reader,
                           coalesce(p.reader_tail, ''),
                           CASE WHEN p.reader_ids IS NULL THEN ''
                                ELSE format('WHERE coalesce(jsonb_path_query_first(to_jsonb(r), %L::jsonpath), ''null''::jsonb) <> ''null''::jsonb',
                                            p.reader_ids) END)
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
    EXCEPTION WHEN query_canceled THEN
      stop := true;
      IF NOT label = ANY (timed_out) THEN timed_out := timed_out || label; END IF;
      IF NOT label = ANY (skipped) THEN skipped := skipped || label; END IF;
      per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane,
                                       'not_assessed', true, 'timed_out', true,
                                       'ms', (extract(epoch FROM clock_timestamp() - tp) * 1000)::int);
      CONTINUE;
    END;
    IF hit AND NOT label = ANY (exposed) THEN exposed := exposed || label; END IF;
    per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane,
                                     'private_sampled', coalesce(returned, cardinality(keys), 0), 'visible', aud_out, 'exposed', hit,
                                     'ms', (extract(epoch FROM clock_timestamp() - tp) * 1000)::int);
  END LOOP;

  -- private_row_policy_copy_drift_v1
  DECLARE c record; h text; n int;
  BEGIN
    FOR c IN SELECT * FROM public.private_row_policy_copies WHERE active ORDER BY reader, relation LOOP
      label := c.reader || ' policy copy of ' || c.relation;
      IF to_regprocedure('public.' || c.reader) IS NULL THEN
        per := per || jsonb_build_object('relation', label, 'kind', 'policy_copy', 'owner', c.owner_lane, 'missing', true, 'exposed', false);
        CONTINUE;
      END IF;
      SELECT policy_hash, policies INTO h, n FROM public.private_row_policy_hash(c.relation, c.policy_filter);
      hit := h IS DISTINCT FROM c.recorded_hash;
      per := per || jsonb_build_object('relation', label, 'kind', 'policy_copy', 'owner', c.owner_lane, 'exposed', hit,
                                       'recorded', c.recorded_hash, 'live', h, 'policies', n, 'recorded_at', c.recorded_at);
      IF hit THEN exposed := exposed || label; END IF;
    END LOOP;
  END;
  RETURN jsonb_build_object('exposed_relations', cardinality(exposed), 'exposed', to_jsonb(exposed),
                            'probed_relations', (SELECT count(DISTINCT CASE WHEN reader = '' THEN relation ELSE reader || '()' END)
                                                   FROM public.private_row_probes WHERE active),
                            'probes', jsonb_array_length(per), 'relations', per, 'not_assessed', to_jsonb(skipped),
                            'timed_out', to_jsonb(timed_out), 'budget_ms', budget_ms,
                            'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int, 'assayed_at', now());
END $function$
;
