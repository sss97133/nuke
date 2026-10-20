#!/usr/bin/env node
/**
 * GUARDRAIL: no-pii-exposure
 *
 * Doctrine (owner, 2026-10-19): data is open by default except personal information (e-mail, phone, street address,
 * private legal names, precise location and device identity); payments reach only their parties; contact goes through
 * platform requests. A column whose name says it holds personal information may be readable by anon or authenticated
 * only through a path the allowlist (pii-exposure-allowlist.json) names with a reason.
 *
 * Static mode (default; CI through scripts/ci/verify.sh): scans migrations at or after FLOOR for statements that open a
 * personal column to anon, authenticated or PUBLIC:
 *   - GRANT SELECT | ALL [(columns)] ON <table> TO anon | authenticated | PUBLIC (incl. ON ALL TABLES IN SCHEMA public)
 *   - CREATE POLICY / ALTER POLICY on <table> FOR SELECT | ALL (default) for those roles (default PUBLIC) USING (true)
 *   - ALTER TABLE <table> DISABLE ROW LEVEL SECURITY
 *   - CREATE [OR REPLACE] [MATERIALIZED] VIEW <view> without security_invoker = true (it runs as its owner), counting
 *     personal-looking identifiers in its body; ALTER VIEW <view> SET (security_invoker = false) or RESET it
 * A table's personal columns come from pii-columns.json (live snapshot; refresh with --refresh), the free-form columns
 * pii-freeform-columns.json lists (contact details found in their content), and columns the scanned migrations add whose
 * names match PII_COLUMN.
 * Limits: statements built at run time (EXECUTE format(...)) are not seen; the live mode covers them.
 *
 * Live mode (--live): asks production (scripts/data/q.sh, read-only) for every personal column anon or authenticated can
 * select through a view that runs as its owner, a table without row level security, or a permissive SELECT policy that
 * is literally true, and reports each one the allowlist does not name.
 *
 * Content mode (--live --content): samples up to 300 rows anon can read of every free-form column (text/json, names
 * like notes, description, contact_info, raw/metadata) on relations open to anon, counts rows with an e-mail address or a
 * formatted phone number (CONTACT_EMAIL, CONTACT_PHONE; the phone pattern of work_order_text_is_personal and
 * text_redact_contact, with separators required), and reports each column with hits that pii-freeform-columns.json does
 * not list. Rolled back; counts only.
 *
 * Exit: 0 clean, 1 exposure, 2 setup error. Flags: --live [--content], --refresh, --json.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const FLOOR = '20261020163000';
export const PII_COLUMN = new RegExp('(^|_)(e?mail|email_address|phone|phone_number|mobile_phone|cell_phone|fax|street|'
  + 'street_address|address|address_line[12]|mailing_address|home_address|billing_address|shipping_address|zip|zip_code|'
  + 'postal_code|ssn|ssn_last4|dob|date_of_birth|birthdate|tax_id|tax_ids|ein|license_number|drivers_license|first_name|'
  + 'last_name|full_name|legal_name|full_legal_name|ip_address|user_agent|latitude|longitude|lat|lng|lon|camera_serial|'
  + 'device_fingerprint|raw_exif|exif_data|owner_contact|owner_name|contact_email|contact_phone|contact_name|'
  + 'customer_email|customer_phone|customer_name|guest_email|guest_phone|guest_name|card_last4|payment_token)$', 'i');
const API_ROLES = ['anon', 'authenticated'];
export const CONTACT_EMAIL = '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}';
export const CONTACT_PHONE = '(^|[^0-9])\\(?[2-9]\\d{2}\\)?[-. ][2-9]\\d{2}[-. ]\\d{4}([^0-9]|$)';
const FREEFORM_NAME = '(contact|note|description|descr|comment|bio|about|message|body|^text$|_text$|content|detail|raw|metadata|meta$|payload|extracted|ocr|summary|remark|info$|transcript|caption|reason|instructions|evidence|data$|attributes|properties|context)';

/** Free-form columns with personal content, by table, from pii-freeform-columns.json. */
export function freeformColumns(list) {
  const out = {};
  for (const e of list.columns) out[e.table] = [...new Set([...(out[e.table] || []), ...e.columns])];
  return out;
}

const bare = (name) => name.replace(/"/g, '').replace(/^public\./i, '').trim().toLowerCase();

/** Blanks comments, quoted strings and dollar-quoted bodies (keeping length), so statements split on real semicolons. */
export function maskSql(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) { const j = sql.indexOf('\n', i); const end = j < 0 ? sql.length : j; out += ' '.repeat(end - i); i = end; continue; }
    if (rest.startsWith('/*')) { const j = sql.indexOf('*/', i + 2); const end = j < 0 ? sql.length : j + 2; out += ' '.repeat(end - i); i = end; continue; }
    const dollar = rest.match(/^\$[A-Za-z_]*\$/);
    if (dollar) {
      const tag = dollar[0]; const j = sql.indexOf(tag, i + tag.length); const end = j < 0 ? sql.length : j + tag.length;
      out += tag + ' '.repeat(Math.max(0, end - i - 2 * tag.length)) + tag; i = end; continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += "'" + ' '.repeat(Math.max(0, j - i - 1)) + "'"; i = j + 1; continue;
    }
    out += sql[i]; i += 1;
  }
  return out;
}

function audiences(roleText) {
  const roles = roleText.toLowerCase().split(',').map((r) => r.trim().replace(/"/g, ''));
  if (roles.includes('public')) return [...API_ROLES];
  return API_ROLES.filter((r) => roles.includes(r));
}

/** Columns the statements add (CREATE TABLE / ALTER TABLE ADD COLUMN) whose names look personal, by table. */
function addedColumns(statements) {
  const added = {};
  for (const s of statements) {
    let m = s.match(/^\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)\s*\(([\s\S]*)\)\s*$/i);
    if (m) {
      const cols = m[2].split(/,(?![^()]*\))/).map((c) => c.trim().split(/\s+/)[0]).filter(Boolean).map(bare);
      added[bare(m[1])] = [...(added[bare(m[1])] || []), ...cols.filter((c) => PII_COLUMN.test(c))];
    }
    m = s.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."]+)\s+([\s\S]*)$/i);
    if (m) {
      for (const a of m[2].matchAll(/ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi)) {
        const c = bare(a[1]);
        if (PII_COLUMN.test(c)) added[bare(m[1])] = [...(added[bare(m[1])] || []), c];
      }
    }
  }
  return added;
}

/** Each statement in one migration that opens personal columns: { table, audience, columns, statement }. */
export function findExposures(sql, piiColumns) {
  const masked = maskSql(sql);
  const statements = masked.split(';').map((s) => s.trim()).filter(Boolean);
  const added = addedColumns(statements);
  const columnsOf = (t) => [...new Set([...(piiColumns[t] || []), ...(added[t] || [])])];
  const hits = [];
  const hit = (table, auds, columns, statement) => {
    for (const audience of auds) if (columns.length) hits.push({ table, audience, columns: [...columns].sort(), statement: statement.replace(/\s+/g, ' ').slice(0, 160) });
  };
  for (const s of statements) {
    let m = s.match(/^GRANT\s+([\s\S]+?)\s+ON\s+([\s\S]+?)\s+TO\s+([\s\S]+?)(?:\s+WITH\s+GRANT\s+OPTION)?$/i);
    if (m && !/^\s*(EXECUTE|USAGE)/i.test(m[1]) && !/^(FUNCTION|PROCEDURE|ROUTINE|SCHEMA|SEQUENCE|ALL\s+(FUNCTIONS|SEQUENCES|ROUTINES))\b/i.test(m[2].trim())) {
      const privs = m[1];
      const auds = audiences(m[3]);
      if (auds.length && /\b(SELECT|ALL)\b/i.test(privs)) {
        const listed = privs.match(/SELECT\s*\(([^)]*)\)/i);
        if (/^ALL\s+TABLES\s+IN\s+SCHEMA\s+public$/i.test(m[2].trim())) {
          for (const t of Object.keys(piiColumns)) hit(t, auds, columnsOf(t), s);
        } else {
          for (const t of m[2].replace(/^TABLE\s+/i, '').split(',').map(bare)) {
            const cols = listed ? listed[1].split(',').map(bare).filter((c) => columnsOf(t).includes(c) || PII_COLUMN.test(c)) : columnsOf(t);
            hit(t, auds, cols, s);
          }
        }
      }
      continue;
    }
    m = s.match(/^(CREATE|ALTER)\s+POLICY\s+(?:"[^"]+"|\w+)\s+ON\s+([\w."]+)([\s\S]*)$/i);
    if (m) {
      const rest = m[3];
      const cmd = (rest.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i) || [null, 'ALL'])[1].toUpperCase();
      const restrictive = /\bAS\s+RESTRICTIVE\b/i.test(rest);
      const roles = (rest.match(/\bTO\s+([\w",\s]+?)(?=\s+(USING|WITH\s+CHECK)\b|$)/i) || [null, 'public'])[1];
      const openUsing = /\bUSING\s*\(\s*\(?\s*true\s*\)?\s*\)/i.test(rest);
      if (!restrictive && (cmd === 'ALL' || cmd === 'SELECT') && openUsing) {
        hit(bare(m[2]), audiences(roles), columnsOf(bare(m[2])), s);
      }
      continue;
    }
    m = s.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."]+)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY$/i);
    if (m) { hit(bare(m[1]), API_ROLES, columnsOf(bare(m[1])), s); continue; }
    m = s.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)\s*([\s\S]*?)\bAS\b([\s\S]*)$/i);
    if (m) {
      const invoker = !m[1] && /security_invoker\s*=?\s*(true|on|1)\b/i.test(m[3]);
      if (!invoker) {
        const idents = [...m[4].matchAll(/[A-Za-z_][\w]*/g)].map((x) => x[0].toLowerCase()).filter((x) => PII_COLUMN.test(x));
        hit(bare(m[2]), API_ROLES, [...new Set(idents)], s);
      }
      continue;
    }
    m = s.match(/^ALTER\s+VIEW\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s+(SET\s*\(\s*security_invoker\s*=\s*(false|off|0)\s*\)|RESET\s*\(\s*security_invoker\s*\))/i);
    if (m) { hit(bare(m[1]), API_ROLES, columnsOf(bare(m[1])), s); continue; }
  }
  return hits;
}

/** Hits the allowlist does not cover, one entry per uncovered (table, audience) with its uncovered columns. */
export function unallowed(hits, allowlist) {
  const out = [];
  for (const h of hits) {
    const covered = new Set(allowlist.filter((a) => a.table === h.table && (a.audience || API_ROLES).includes(h.audience)).flatMap((a) => a.columns));
    const left = h.columns.filter((c) => !covered.has(c) && !covered.has('*'));
    if (left.length) out.push({ ...h, columns: left });
  }
  return out;
}

function loadJson(name) {
  const p = join(HERE, name);
  if (!existsSync(p)) { console.error(`missing ${p}`); process.exit(2); }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function q(sql) {
  const out = execFileSync(join(ROOT, 'scripts/data/q.sh'), [sql], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const rows = JSON.parse(out);
  if (!Array.isArray(rows)) { console.error(out); process.exit(2); }
  return rows;
}

const piiRegexSql = PII_COLUMN.source.replace(/'/g, "''");
const LIVE_SQL = `WITH pii AS (
  SELECT c.oid relid, c.relname, c.relkind, c.relrowsecurity rls,
         coalesce(c.reloptions::text, '') LIKE '%security_invoker=true%' invoker, a.attname
  FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~* '${piiRegexSql}'
), aud AS (
  SELECT p.*, r.rolname audience FROM pii p CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  WHERE has_column_privilege(r.rolname, p.relid, p.attname, 'SELECT')
), open_policy AS (
  SELECT pol.polrelid relid, r.rolname audience FROM pg_policy pol CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  WHERE pol.polpermissive AND pol.polcmd IN ('r', '*')
    AND regexp_replace(coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''), '[\\s()]', '', 'g') = 'true'
    AND (pol.polroles = '{0}' OR (SELECT oid FROM pg_roles WHERE rolname = r.rolname) = ANY (pol.polroles))
  GROUP BY 1, 2
)
SELECT a.relname AS "table", a.audience, array_agg(a.attname::text ORDER BY a.attname) AS columns,
  CASE WHEN a.relkind IN ('v', 'm') AND NOT a.invoker THEN 'view runs as owner'
       WHEN a.relkind IN ('r', 'p', 'f') AND NOT a.rls THEN 'no row level security' ELSE 'policy true' END AS statement
FROM aud a LEFT JOIN open_policy o ON o.relid = a.relid AND o.audience = a.audience
WHERE (a.relkind IN ('v', 'm') AND NOT a.invoker) OR (a.relkind IN ('r', 'p', 'f') AND NOT a.rls) OR o.relid IS NOT NULL
GROUP BY a.relname, a.audience, a.relkind, a.invoker, a.rls ORDER BY 1, 2`;

const CANDIDATES_SQL = `SELECT c.relname AS t, c.relkind AS k, greatest(c.reltuples, 0)::bigint AS est,
  array_agg(a.attname::text ORDER BY a.attname) AS cols
FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm') AND a.attnum > 0 AND NOT a.attisdropped
  AND format_type(a.atttypid, a.atttypmod) IN ('text', 'jsonb', 'json', 'character varying', 'text[]')
  AND a.attname ~* '${FREEFORM_NAME}' AND has_column_privilege('anon', c.oid, a.attname, 'SELECT')
  AND ((c.relkind IN ('v', 'm') AND coalesce(c.reloptions::text, '') NOT LIKE '%security_invoker=true%')
    OR (c.relkind IN ('r', 'p') AND NOT c.relrowsecurity)
    OR EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid AND pol.polpermissive AND pol.polcmd IN ('r', '*')
      AND regexp_replace(coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''), '[\\s()]', '', 'g') = 'true'
      AND (pol.polroles = '{0}' OR (SELECT oid FROM pg_roles WHERE rolname = 'anon') = ANY (pol.polroles))))
GROUP BY c.relname, c.relkind, c.reltuples ORDER BY 1`;

/** SQL that samples, as anon and rolled back, how many readable rows of each column carry contact details. */
export function contentProbeSql(relations) {
  const lines = ['BEGIN;', "SET LOCAL lock_timeout = '1s';", 'CREATE TEMP TABLE pii_probe (t text, c text, n int, email int, phone int);',
    'GRANT INSERT ON pii_probe TO anon;', 'SET LOCAL ROLE anon;', `SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);`];
  for (const r of relations) {
    let src = `public."${r.t.replace(/"/g, '""')}"`;
    if (r.k === 'r' && r.est > 200000) src += ` TABLESAMPLE SYSTEM (${Math.max(0.01, Math.min(10, 300000 / r.est)).toFixed(3)})`;
    for (const c of r.cols) {
      const col = `"${c.replace(/"/g, '""')}"`;
      lines.push(`INSERT INTO pii_probe SELECT '${r.t}', '${c}', count(v), count(v) FILTER (WHERE v ~ '${CONTACT_EMAIL}'), `
        + `count(v) FILTER (WHERE v ~ '${CONTACT_PHONE}') FROM (SELECT ${col}::text v FROM ${src} WHERE ${col} IS NOT NULL LIMIT 300) s;`);
    }
  }
  lines.push('RESET ROLE;', 'SELECT t, c, n, email, phone FROM pii_probe WHERE email + phone > 0;', 'ROLLBACK;');
  return lines.join('\n');
}

function contentHits(listed) {
  const rels = q(CANDIDATES_SQL);
  const found = [];
  const run = (batch) => {
    const out = execFileSync(join(ROOT, 'scripts/data/q.sh'), [contentProbeSql(batch)], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const rows = JSON.parse(out);
    if (!Array.isArray(rows)) return false;
    for (const r of rows) if ('email' in r) found.push(r);
    return true;
  };
  for (let i = 0; i < rels.length; i += 10) {
    const batch = rels.slice(i, i + 10);
    if (!run(batch)) for (const r of batch) if (!run([r])) console.error(`content: ${r.t} unreadable as anon (skipped)`);
  }
  return found.filter((r) => !(listed[r.t] || []).includes(r.c)).map((r) => ({
    table: r.t, audience: 'anon', columns: [r.c], file: 'production',
    statement: `contact details in ${r.email + r.phone} of ${r.n} sampled rows (e-mail ${r.email}, phone ${r.phone})` }));
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--refresh')) {
    const rows = q(`SELECT c.relname AS t, array_agg(a.attname::text ORDER BY a.attname) AS cols FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~* '${piiRegexSql}'
      GROUP BY 1 ORDER BY 1`);
    const snap = Object.fromEntries(rows.map((r) => [r.t, r.cols]));
    writeFileSync(join(HERE, 'pii-columns.json'), JSON.stringify(snap, null, 1) + '\n');
    console.log(`pii-columns.json: ${rows.length} relations`);
    return 0;
  }
  const allowlist = loadJson('pii-exposure-allowlist.json').entries;
  let hits;
  if (args.has('--live') && args.has('--content')) {
    hits = contentHits(freeformColumns(loadJson('pii-freeform-columns.json')));
  } else if (args.has('--live')) {
    hits = q(LIVE_SQL).map((r) => ({ ...r, file: 'production' }));
  } else {
    const pii = loadJson('pii-columns.json');
    for (const [t, cols] of Object.entries(freeformColumns(loadJson('pii-freeform-columns.json')))) pii[t] = [...new Set([...(pii[t] || []), ...cols])];
    const dir = join(ROOT, 'supabase/migrations');
    hits = readdirSync(dir).filter((f) => f.endsWith('.sql') && f.split('_')[0] >= FLOOR).sort()
      .flatMap((f) => findExposures(readFileSync(join(dir, f), 'utf8'), pii).map((h) => ({ ...h, file: f })));
  }
  const bad = args.has('--content') ? hits : unallowed(hits, allowlist);
  if (args.has('--json')) console.log(JSON.stringify(bad, null, 1));
  else for (const b of bad) console.log(`EXPOSURE ${b.file}: ${b.table} -> ${b.audience}: ${b.columns.join(',')} (${b.statement})`);
  if (bad.length) {
    console.error(`no-pii-exposure: ${bad.length} exposure(s). Close the path, or add the columns to scripts/guardrails/pii-exposure-allowlist.json with the reason they are public.`);
    return 1;
  }
  if (!args.has('--json')) console.log(`no-pii-exposure: clean (${args.has('--content') ? 'production content' : args.has('--live') ? 'production' : `migrations >= ${FLOOR}`})`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
