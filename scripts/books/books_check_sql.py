"""Shared pieces of the books view checks (books_large_sums_check.py, books_direction_check.py).

Everything runs against the live database in one transaction as the service role, rolled back at the end (read only unless a migration is tried). A migration that is not
deployed yet can be tried inside that same transaction (--migration): its views are created there, and its books_year_gate is created
under another name (books_year_gate_pending) so no existing function is touched or locked. A view's SQL can also be tested over synthetic
rows (no books data) by replacing the views it reads with CTEs.
"""
import json
import os
import re
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok  # noqa: E402,F401

SERVICE = "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
# The recorder's functions (record_books_gate_run and the readers it calls) read the role from the older claim as well.
SERVICE_WRITER = SERVICE + "select set_config('request.jwt.claim.role','service_role',true);\n"


def view_sql(migration_text, name):
    """The SELECT of `CREATE OR REPLACE VIEW public.<name> ... AS <select>;` in a migration file."""
    m = re.search(r'CREATE OR REPLACE VIEW public\.%s WITH \(security_invoker = true\) AS\n(.*?);\n\n(?:COMMENT ON VIEW|CREATE OR REPLACE VIEW|REVOKE)' % re.escape(name),
                  migration_text, re.S)
    if not m:
        sys.exit(f'view {name} not found in the migration')
    return m.group(1)


def views_ddl(migration_text, names):
    """The CREATE OR REPLACE VIEW statements of the named views, ready to run."""
    return ''.join(f'CREATE OR REPLACE VIEW public.{n} WITH (security_invoker = true) AS\n{view_sql(migration_text, n)};\n' for n in names)


def gate_candidate(migration_text):
    """The migration's books_year_gate under the name books_year_gate_pending (creating it touches no existing function)."""
    m = re.search(r'CREATE OR REPLACE FUNCTION public\.books_year_gate\(p_owner_id uuid, p_year integer\).*?\$function\$;', migration_text, re.S)
    if not m:
        sys.exit('books_year_gate not found in the migration')
    return m.group(0).replace('public.books_year_gate(', 'public.books_year_gate_pending(', 1)


def run(queries, migration=None, view_names=(), with_gate=False, timeout='100s'):
    """Run named single-value queries in one rolled-back transaction as the service role.

    queries: list of (name, sql) where sql is one SELECT expression-returning statement body, e.g. "select json_agg(...)" or
    "select public.books_year_gate(...)::text". Returns {name: (parsed_json, milliseconds)}.
    With migration: its views (view_names) are created first inside the transaction, and with_gate also creates books_year_gate_pending.
    """
    sql = f"begin{'' if migration else ' read only'};\nset local statement_timeout='{timeout}';\n{SERVICE}"
    if migration:
        text = open(migration).read()
        sql += views_ddl(text, view_names)
        if with_gate:
            sql += gate_candidate(text) + '\n'
    sql += '\\timing on\n'
    for name, body in queries:
        sql += f"select 'T|{name}|' || ({body.rstrip().rstrip(';')})::text;\n"
    sql += '\\timing off\nrollback;\n'
    out = psql(sql).splitlines()
    res, last = {}, None
    for line in out:
        if line.startswith('T|'):
            _, name, js = line.split('|', 2)
            last = name
            res[name] = [json.loads(js, parse_float=Decimal), None]
        elif line.startswith('Time: ') and last in res and res[last][1] is None:
            res[last][1] = float(line.split()[1])
    missing = [n for n, _ in queries if n not in res]
    if missing:
        raise RuntimeError(f'no output for {missing}: {" | ".join(out[-5:])}')
    return {k: (v[0], v[1]) for k, v in res.items()}


def with_substituted_views(view_select, sources):
    """The view's SELECT with the views/tables it reads replaced by CTEs over synthetic rows.

    sources: {name: (column_definitions, rows)}, e.g. {'v_books_audit_tiers': ('id uuid, amount numeric', [{...}])}; or {name: sql} to put another
    SELECT in its place (a view that reads a view). The view text must start with WITH (all the views here do); the synthetic CTEs are put in
    front of its own.
    """
    body = view_select
    ctes = []
    for name, src in sources.items():
        body = re.sub(r'public\.%s\b' % re.escape(name), name, body)
        if isinstance(src, str):
            ctes.append(f"{name} AS ({src})")
        else:
            cols, rows = src
            ctes.append(f"{name} AS (SELECT * FROM jsonb_to_recordset({q(json.dumps(rows, default=str))}::jsonb) AS t({cols}))")
    assert body.lstrip().startswith('WITH ') or body.lstrip().upper().startswith('SELECT '), 'view text must start with WITH or SELECT'
    if body.lstrip().startswith('WITH '):
        return 'WITH ' + ',\n'.join(ctes) + ',\n' + body.lstrip()[len('WITH '):]
    return 'WITH ' + ',\n'.join(ctes) + '\n' + body.lstrip()


def money(x):
    return f"{Decimal(x):,.2f}"
