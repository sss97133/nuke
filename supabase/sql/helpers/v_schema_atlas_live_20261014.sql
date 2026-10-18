-- Live definition of public.v_schema_atlas on 2026-10-14 05:46Z (pg_get_viewdef(oid, true)),
-- base64 SHA-256 9HlM42Hc0M4rA6FDQltdavnEUJoToVG8NeXHCQJFxNk=. Owner postgres; SELECT for service_role only. Test fixture only.
CREATE OR REPLACE VIEW public.v_schema_atlas AS
 WITH t AS (
         SELECT c.oid,
            c.relname AS table_name,
            c.reltuples::bigint AS est_rows,
            (c.relpages + COALESCE(tc.relpages, 0))::bigint * current_setting('block_size'::text)::bigint AS heap_toast_bytes,
            obj_description(c.oid, 'pg_class'::name) AS purpose
           FROM pg_class c
             LEFT JOIN pg_class tc ON tc.oid = c.reltoastrelid
          WHERE c.relnamespace = 'public'::regnamespace::oid AND (c.relkind = ANY (ARRAY['r'::"char", 'p'::"char"]))
        ), cols AS (
         SELECT a.attrelid AS oid,
            count(*) AS n_cols,
            count(*) FILTER (WHERE d.description IS NOT NULL) AS n_cols_described
           FROM pg_attribute a
             JOIN t t_1 ON t_1.oid = a.attrelid
             LEFT JOIN pg_description d ON d.objoid = a.attrelid AND d.classoid = 'pg_class'::regclass::oid AND d.objsubid = a.attnum
          WHERE a.attnum > 0 AND NOT a.attisdropped
          GROUP BY a.attrelid
        ), act AS (
         SELECT pg_stat_user_tables.relid AS oid,
            pg_stat_user_tables.n_tup_ins + pg_stat_user_tables.n_tup_upd + pg_stat_user_tables.n_tup_del AS writes,
            COALESCE(pg_stat_user_tables.seq_scan, 0::bigint) + COALESCE(pg_stat_user_tables.idx_scan, 0::bigint) AS reads
           FROM pg_stat_user_tables
          WHERE pg_stat_user_tables.schemaname = 'public'::name
        ), fk_out AS (
         SELECT pg_constraint.conrelid AS oid,
            count(*) AS n,
            array_agg(DISTINCT pg_constraint.confrelid::regclass::text) AS parents
           FROM pg_constraint
          WHERE pg_constraint.contype = 'f'::"char"
          GROUP BY pg_constraint.conrelid
        ), fk_in AS (
         SELECT pg_constraint.confrelid AS oid,
            count(*) AS n
           FROM pg_constraint
          WHERE pg_constraint.contype = 'f'::"char"
          GROUP BY pg_constraint.confrelid
        ), trg AS (
         SELECT pg_trigger.tgrelid AS oid,
            count(*) AS n
           FROM pg_trigger
          WHERE NOT pg_trigger.tgisinternal
          GROUP BY pg_trigger.tgrelid
        ), reg AS (
         SELECT pipeline_registry.table_name,
            count(*) AS fields,
            array_agg(DISTINCT pipeline_registry.owned_by) AS owners
           FROM pipeline_registry
          GROUP BY pipeline_registry.table_name
        ), wr AS (
         SELECT write_receipts.tbl,
            array_agg(DISTINCT write_receipts.writer) AS writers,
            count(*) FILTER (WHERE write_receipts.writer = 'undeclared'::text) AS undeclared_stmts,
            max(write_receipts.at) AS last_write
           FROM write_receipts
          WHERE write_receipts.at > (now() - '30 days'::interval)
          GROUP BY write_receipts.tbl
        ), cr AS (
         SELECT t_1.table_name,
            array_agg(j.jobname ORDER BY j.jobname) AS crons
           FROM t t_1
             JOIN cron.job j ON j.active AND j.command ~* (('\m'::text || t_1.table_name::text) || '\M'::text)
          GROUP BY t_1.table_name
        )
 SELECT t.table_name,
        CASE
            WHEN COALESCE(act.writes, 0::bigint) > 0 THEN 'written'::text
            WHEN COALESCE(act.reads, 0::bigint) > 0 THEN 'read-only'::text
            ELSE 'idle'::text
        END AS activity,
    act.writes AS writes_since_stats_reset,
    act.reads AS reads_since_stats_reset,
    t.est_rows,
    t.heap_toast_bytes,
    cols.n_cols,
    cols.n_cols_described,
    COALESCE(fo.n, 0::bigint) AS fk_out,
    fo.parents AS fk_parents,
    COALESCE(fi.n, 0::bigint) AS fk_in,
    COALESCE(trg.n, 0::bigint) AS triggers,
    t.purpose,
    reg.fields AS registry_fields,
    reg.owners AS registry_owners,
    wr.writers AS writers_30d,
    wr.undeclared_stmts AS undeclared_stmts_30d,
    wr.last_write,
    cr.crons AS crons_mentioning
   FROM t
     LEFT JOIN cols ON cols.oid = t.oid
     LEFT JOIN act ON act.oid = t.oid
     LEFT JOIN fk_out fo ON fo.oid = t.oid
     LEFT JOIN fk_in fi ON fi.oid = t.oid
     LEFT JOIN trg ON trg.oid = t.oid
     LEFT JOIN reg ON reg.table_name = t.table_name
     LEFT JOIN wr ON wr.tbl = t.table_name
     LEFT JOIN cr ON cr.table_name = t.table_name;
