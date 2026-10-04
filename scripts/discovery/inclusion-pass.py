#!/usr/bin/env python3
"""inclusion-pass: the join discovery engine.

For each island table (non-empty, no foreign key in or out, per v_schema_atlas) it samples the
values of every candidate key column and tests them for inclusion in entity key columns.
Inclusion is a hypothesis, not proof of identity, cardinality or a valid foreign key.

  uuid columns   -> the id of the most-referenced entity tables (vehicles, organizations, ...)
  text key-ish   -> vehicles.vin, external_identities.handle, observation_sources.slug
                    (columns named like vin / username / handle / slug / author / seller / buyer / bidder)

Read-only. Samples are at most 1500 distinct values from a block sample, so rates are estimates:
confirm a candidate on the full table (distinct values anti-join) before declaring a key.
Candidates go to --json for registration as veins; nothing here writes to the database.

  python3 scripts/discovery/inclusion-pass.py --islands 40 --json out.json
  python3 scripts/discovery/inclusion-pass.py --tables analysis_events,vehicle_grades
  python3 scripts/discovery/inclusion-pass.py --catalog --json /private/path/catalog.json

Catalog mode records all public-schema mechanisms, including function bodies, for private
review. It never prints those bodies or queries testimony rows. Catalog dependencies and
lexical body mentions are separate evidence stages; neither proves runtime use.
"""
import argparse, json, os, re, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path

QSH = os.environ.get("QSH", os.path.expanduser("~/nuke/scripts/data/q.sh"))
SAMPLE = 1500
MIN_VALUES = 30
MIN_RATE = 0.3
TEXT_KEY = re.compile(r"(^|_)(vin|username|user_name|handle|slug|author|seller|buyer|bidder)(_|$)", re.I)
NEVER = re.compile(r"(email|phone|address|password|token|secret|ssn)", re.I)  # private data stays out

def q(sql):
    try:
        result = subprocess.run([QSH, "BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; " + sql + "; COMMIT;"],
                                capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError("database query process failed")
        data = json.loads(result.stdout)
        if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
            raise RuntimeError("database query returned an error or invalid row envelope")
        return data
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        raise RuntimeError("database query failed; inspection is incomplete") from exc

def identifier(name):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", name):
        raise ValueError("invalid public-schema identifier")
    return '"' + name + '"'

def save_json(filename, value):
    destination = Path(filename).expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=destination.parent, delete=False) as stream:
        temporary = stream.name
        try:
            json.dump(value, stream, indent=1)
            stream.write("\n")
        except BaseException:
            os.unlink(temporary)
            raise
    os.replace(temporary, destination)

CATALOG_QUERIES = {
    "relations": """SELECT c.oid, c.relname AS name, c.relkind AS kind,
      c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
      obj_description(c.oid,'pg_class') AS description,
      CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS view_definition
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname""",
    "columns": """SELECT c.relname AS relation, a.attnum AS position, a.attname AS name,
      format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
      a.attgenerated AS generated, a.attidentity AS identity,
      col_description(c.oid,a.attnum) AS description,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname,a.attnum""",
    "constraints": """SELECT c.conrelid::regclass::text AS relation, c.conname AS name,
      c.contype AS kind, c.convalidated AS validated, c.condeferrable AS deferrable,
      c.condeferred AS initially_deferred, pg_get_constraintdef(c.oid,true) AS definition,
      CASE WHEN c.contype='f' THEN c.confrelid::regclass::text END AS target,
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,pos)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.pos) AS columns,
      ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,pos)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.pos) AS target_columns
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname='public' AND c.conrelid<>0 ORDER BY relation,c.conname""",
    "indexes": """SELECT t.relname AS relation, x.relname AS name,
      i.indisunique AS is_unique, i.indisvalid AS valid, i.indisready AS ready,
      pg_get_indexdef(i.indexrelid) AS definition, pg_get_expr(i.indpred,i.indrelid) AS predicate
      FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
      JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' ORDER BY t.relname,x.relname""",
    "functions": """SELECT p.oid, p.proname AS name, p.prokind AS kind,
      pg_get_function_identity_arguments(p.oid) AS arguments, l.lanname AS language,
      p.prosecdef AS security_definer, p.provolatile AS volatility, p.proacl::text AS execute_acl,
      obj_description(p.oid,'pg_proc') AS description, p.prosrc AS body
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' ORDER BY p.proname,p.oid""",
    "triggers": """SELECT c.relname AS relation, t.tgname AS name, t.tgenabled AS enabled,
      t.tgfoid AS function_oid, pg_get_triggerdef(t.oid,true) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname""",
    "dependencies": """SELECT DISTINCT v.relname AS source, r.relname AS target,
      a.attname AS target_column, d.deptype AS dependency_kind, 'view' AS source_kind
      FROM pg_depend d JOIN pg_rewrite w ON w.oid=d.objid AND d.classid='pg_rewrite'::regclass
      JOIN pg_class v ON v.oid=w.ev_class JOIN pg_namespace vn ON vn.oid=v.relnamespace
      JOIN pg_class r ON r.oid=d.refobjid AND d.refclassid='pg_class'::regclass
      JOIN pg_namespace rn ON rn.oid=r.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=d.refobjsubid
      WHERE vn.nspname='public' AND rn.nspname='public' AND v.oid<>r.oid
      UNION SELECT DISTINCT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      r.relname, a.attname, d.deptype, 'function'
      FROM pg_depend d JOIN pg_proc p ON p.oid=d.objid AND d.classid='pg_proc'::regclass
      JOIN pg_namespace pn ON pn.oid=p.pronamespace
      JOIN pg_class r ON r.oid=d.refobjid AND d.refclassid='pg_class'::regclass
      JOIN pg_namespace rn ON rn.oid=r.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=d.refobjsubid
      WHERE pn.nspname='public' AND rn.nspname='public' ORDER BY source,target,target_column""",
    "owners": """SELECT table_name, column_name, owned_by, description,
      do_not_write_directly, write_via FROM public.pipeline_registry ORDER BY table_name,column_name""",
    "atlas": """SELECT table_name, activity, n_cols, n_cols_described, fk_in, fk_out,
      registry_owners, writers_30d, last_write, crons_mentioning FROM public.v_schema_atlas ORDER BY table_name""",
    "jobs": """SELECT jobid,jobname,schedule,active,declared_writer,runs_24h,failed_24h,
      consecutive_failures,last_status,last_run_at FROM public.v_job_health ORDER BY jobid""",
    "policies": """SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
      FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname""",
    "types": """SELECT t.typname AS name, t.typtype AS kind,
      obj_description(t.oid,'pg_type') AS description,
      CASE WHEN t.typtype='d' THEN format_type(t.typbasetype,t.typtypmod) END AS domain_base,
      ARRAY(SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid=t.oid ORDER BY e.enumsortorder) AS enum_values
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typtype IN ('e','d','r','m') ORDER BY t.typname""",
    "partition_inheritance": """SELECT c.relname AS child, p.relname AS parent,
      c.relispartition AS is_partition, i.inhseqno AS sequence
      FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
      JOIN pg_class p ON p.oid=i.inhparent JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,i.inhseqno""",
    "extensions": """SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
      FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname""",
}

def export_catalog(filename):
    catalog = {name: q(sql) for name, sql in CATALOG_QUERIES.items()}
    names = {r["name"] for r in catalog["relations"]}
    mentions = []
    for routine in catalog["functions"]:
        tokens = set(re.findall(r"[A-Za-z_][A-Za-z_0-9]*", routine.get("body") or ""))
        for relation in sorted(tokens & names):
            mentions.append({"function_oid": routine["oid"], "relation": relation,
                             "evidence_stage": "lexical_candidate", "runtime_verified": False})
    catalog["function_relation_mentions"] = mentions
    catalog["scope"] = {"schema": "public", "captured_at": datetime.now(timezone.utc).isoformat(),
                        "snapshot": "separate read-only transactions per section",
                        "testimony_rows_read": False, "semantic_review_complete": False,
                        "limitations": ["Catalog dependencies are not a complete PL/pgSQL or dynamic SQL call graph.",
                                        "Lexical mentions can be comments or literals; they do not prove a join.",
                                        "Atlas and job sensors do not prove every writer or reader is observed.",
                                        "Function bodies and definitions are private review material."]}
    catalog["coverage"] = {name: len(rows) for name, rows in catalog.items() if isinstance(rows, list)}
    catalog["coverage"]["columns_described"] = sum(bool(c.get("description")) for c in catalog["columns"])
    save_json(filename, catalog)
    print(json.dumps({"scope": "public catalog", "coverage": catalog["coverage"],
                      "semantic_review_complete": False, "artifact": str(Path(filename).expanduser())}))
    return catalog

def lit(vals):
    return "array[" + ",".join("'" + v.replace("'", "''") + "'" for v in vals) + "]"

def targets():
    top = q("select table_name from v_schema_atlas where fk_in>=8 and table_name !~ '^(zz_|_)' order by fk_in desc limit 12") or []
    uu = []
    for r in top:
        t = r["table_name"]
        identifier(t)
        pk = q(f"select 1 x from information_schema.columns where table_schema='public' and table_name='{t}' and column_name='id' and data_type='uuid'")
        if pk: uu.append((t, "id"))
    return uu, [("vehicles", "vin", "upper"), ("external_identities", "handle", "lower"), ("observation_sources", "slug", "lower")]

def run(tables, as_json):
    uu_targets, tx_targets = targets()
    found = []
    for t in tables:
        table_sql = 'public.' + identifier(t)
        est = (q(f"select est_rows from v_schema_atlas where table_name='{t}'") or [{"est_rows": 0}])[0]["est_rows"]
        pct = min(100, max(0.001, SAMPLE * 2.0 / max(est, 1) * 100))
        cols = q(f"select column_name, data_type from information_schema.columns where table_schema='public' and table_name='{t}'") or []
        for c in cols:
            cn, dt = c["column_name"], c["data_type"]
            column_sql = identifier(cn)
            if cn == "id" or NEVER.search(cn): continue
            is_uuid = dt == "uuid"
            is_text = dt in ("text", "character varying") and TEXT_KEY.search(cn)
            if not (is_uuid or is_text): continue
            s = q(f"select distinct {column_sql}::text v from {table_sql} tablesample system({pct:.4f}) where {column_sql} is not null limit {SAMPLE}")
            vals = [r["v"] for r in (s or []) if r["v"]]
            if len(vals) < MIN_VALUES: continue
            if is_uuid:
                for tt, tc in uu_targets:
                    m = q(f"select count(*) n from public.{identifier(tt)} where {identifier(tc)}=any({lit(vals)}::uuid[])")
                    if m is not None and m[0]["n"] / len(vals) >= MIN_RATE:
                        found.append(dict(table=t, column=cn, kind="uuid", target=f"{tt}.{tc}", sample=len(vals), matched=m[0]["n"]))
            else:
                for tt, tc, fn in tx_targets:
                    v2 = [getattr(v, fn)() for v in vals]
                    m = q(f"select count(distinct {fn}({identifier(tc)})) n from public.{identifier(tt)} where {fn}({identifier(tc)})=any({lit(v2)})")
                    if m is not None and m[0]["n"] / len(set(v2)) >= MIN_RATE:
                        found.append(dict(table=t, column=cn, kind="text", target=f"{tt}.{tc}", sample=len(set(v2)), matched=m[0]["n"]))
    for f in found:
        f["rate"] = round(f["matched"] / f["sample"], 3)
        f["evidence_stage"] = "sample_inclusion"
        f["semantic_identity_verified"] = False
        f["requires_platform_scope"] = f["target"] == "external_identities.handle"
    found.sort(key=lambda f: -f["rate"])
    if as_json: save_json(as_json, found)
    for f in found: print(f)
    print("done", len(found), "candidate edges over", len(tables), "tables")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    selection = ap.add_mutually_exclusive_group()
    selection.add_argument("--tables"); selection.add_argument("--islands", type=int)
    selection.add_argument("--catalog", action="store_true")
    ap.add_argument("--json")
    a = ap.parse_args()
    if a.catalog and not a.json: ap.error("--catalog requires --json to keep definitions private")
    if a.islands is not None and a.islands < 1: ap.error("--islands must be positive")
    try:
        if a.catalog:
            export_catalog(a.json)
        else:
            if a.tables: tabs = [t.strip() for t in a.tables.split(",")]
            else:
                rows = q(f"select table_name from v_schema_atlas where est_rows>=1000 and fk_in=0 and fk_out=0 order by est_rows desc limit {a.islands or 40}")
                tabs = [r["table_name"] for r in rows]
            if not tabs: sys.exit("no tables")
            run(tabs, a.json)
    except (RuntimeError, ValueError) as exc:
        sys.exit(str(exc))
