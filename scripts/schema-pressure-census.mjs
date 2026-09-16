#!/usr/bin/env node
/**
 * schema-pressure-census — the SENSE+DECIDE halves of the crystallization organ.
 *
 * Skylar 2026-07-02: "natural growth of a db is a misnomer… for me it means the schema
 * expands without human interaction — the agent knows how and where to expand the
 * structural side, the schema. We can't stop til it's self sufficient."
 *
 * This measures data pressure inside the high-traffic jsonb columns and emits RANKED,
 * EVIDENCE-CARRYING expansion decisions: which keys have crystallized (high fill, stable
 * scalar type, recent writes → PROMOTE to a typed column), which are live namespaces
 * (structured objects under active write → REGISTER, leave as jsonb), and which are
 * sediment (one-off script residue, no recent writes → RETIRE-CANDIDATE, never deleted,
 * just marked). The EXECUTE half applies only ADDITIVE expansions, each migration citing
 * the census row that justified it — schema changes carry source DNA like any other write.
 *
 * Read-only. Timeout-safe: every aggregate is scoped (user/vehicle or time window).
 *
 * Usage:
 *   node scripts/schema-pressure-census.mjs                  # human summary to stdout
 *   node scripts/schema-pressure-census.mjs --json           # machine-readable proposals
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const JSON_OUT = process.argv.includes('--json');

// Census targets: (table, jsonb column, scope predicate that keeps the aggregate indexed).
// Scope is a REPRESENTATIVE bounded slice, not the fleet — pressure is a rate, not a total.
const TARGETS = [
  {
    table: 'vehicle_images', column: 'ai_scan_metadata',
    scopeSql: `user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' and ai_scan_metadata is not null`,
    scopeLabel: "skylar's library (~26k rows, indexed by user_id)",
  },
  {
    table: 'vehicle_observations', column: 'structured_data',
    scopeSql: `ingested_at > now() - interval '30 days' and structured_data is not null`,
    scopeLabel: 'last 30 days of observations (indexed by ingested_at)',
  },
];

// Promotion thresholds (the DECIDE rules — documented, not vibed):
const PROMOTE_MIN_FILL = 0.5;    // present on >=50% of scoped rows
const PROMOTE_TYPE_PURITY = 0.95; // >=95% one scalar type
const SEDIMENT_MAX_ROWS = 25;    // <=25 rows in scope = one-off residue

// Paginated key census in JS — keeps every DB touch an indexed range scan (no fleet-wide
// jsonb aggregate, no statement-timeout exposure), at the cost of streaming the scoped
// slice through the client. Scopes are sized for that trade.
async function censusTarget(t) {
  const PAGE = 1000;
  const keyStats = new Map(); // key -> { rows, types: Map, sampleValues: [], newestSeen: null }
  let scanned = 0;
  for (let offset = 0; ; offset += PAGE) {
    let q = sb.from(t.table).select(`id, ${t.column}`).order('id', { ascending: true }).range(offset, offset + PAGE - 1);
    if (t.table === 'vehicle_images') {
      q = q.eq('user_id', '0b9f107a-d124-49de-9ded-94698f63c1c4').not(t.column, 'is', null);
    } else {
      q = q.gt('ingested_at', new Date(Date.now() - 30 * 864e5).toISOString()).not(t.column, 'is', null);
    }
    const { data, error } = await q;
    if (error) { console.error(`census ${t.table}: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const obj = row[t.column];
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      scanned++;
      for (const [k, v] of Object.entries(obj)) {
        if (!keyStats.has(k)) keyStats.set(k, { rows: 0, types: new Map(), samples: [] });
        const s = keyStats.get(k);
        s.rows++;
        const ty = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v;
        s.types.set(ty, (s.types.get(ty) || 0) + 1);
        if (s.samples.length < 2 && ty !== 'object' && ty !== 'array') s.samples.push(String(v).slice(0, 60));
      }
    }
    if (data.length < PAGE) break;
    await new Promise((r) => setTimeout(r, 50)); // breathe
  }
  return { scanned, keyStats };
}

function decide(t, scanned, keyStats) {
  const proposals = [];
  for (const [key, s] of keyStats.entries()) {
    const fill = scanned ? s.rows / scanned : 0;
    const [topType, topCount] = [...s.types.entries()].sort((a, b) => b[1] - a[1])[0] || ['?', 0];
    const purity = s.rows ? topCount / s.rows : 0;
    let decision, rationale;
    if (s.rows <= SEDIMENT_MAX_ROWS) {
      decision = 'RETIRE_CANDIDATE';
      rationale = `sediment: ${s.rows} rows in scope — one-off script residue; mark, never delete`;
    } else if (fill >= PROMOTE_MIN_FILL && purity >= PROMOTE_TYPE_PURITY && topType !== 'object' && topType !== 'array') {
      decision = 'PROMOTE_TO_COLUMN';
      rationale = `crystallized: ${(fill * 100).toFixed(0)}% fill, ${(purity * 100).toFixed(0)}% ${topType} — ready for a typed column (additive, nullable, backfill from jsonb)`;
    } else if (topType === 'object' && fill >= 0.2) {
      decision = 'LIVE_NAMESPACE';
      rationale = `active structured namespace (${(fill * 100).toFixed(0)}% fill) — correct as jsonb; register writer ownership`;
    } else {
      decision = 'WATCH';
      rationale = `accumulating: ${(fill * 100).toFixed(0)}% fill, ${topType} — below promotion threshold, re-census next cycle`;
    }
    proposals.push({
      table: t.table, column: t.column, key,
      rows: s.rows, scanned, fill: +(fill.toFixed(3)),
      dominant_type: topType, type_purity: +(purity.toFixed(3)),
      samples: s.samples, decision, rationale,
      scope: t.scopeLabel, censused_at: new Date().toISOString(),
    });
  }
  const rank = { PROMOTE_TO_COLUMN: 0, LIVE_NAMESPACE: 1, WATCH: 2, RETIRE_CANDIDATE: 3 };
  proposals.sort((a, b) => rank[a.decision] - rank[b.decision] || b.fill - a.fill);
  return proposals;
}

const all = [];
for (const t of TARGETS) {
  const { scanned, keyStats } = await censusTarget(t);
  all.push(...decide(t, scanned, keyStats));
}

if (JSON_OUT) {
  console.log(JSON.stringify(all, null, 2));
} else {
  let cur = '';
  for (const p of all) {
    const head = `${p.table}.${p.column}`;
    if (head !== cur) { cur = head; console.log(`\n== ${head} · scope: ${p.scope} · scanned ${p.scanned} rows`); }
    console.log(`  ${p.decision.padEnd(18)} ${p.key.padEnd(28)} ${String(p.rows).padStart(6)} rows · ${(p.fill * 100).toFixed(0).padStart(3)}% · ${p.dominant_type}${p.type_purity < 1 ? ` (${(p.type_purity * 100).toFixed(0)}% pure)` : ''} — ${p.rationale}`);
  }
  const counts = all.reduce((m, p) => (m[p.decision] = (m[p.decision] || 0) + 1, m), {});
  console.log(`\nTOTALS: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
}
