#!/usr/bin/env node
/**
 * scripts/data/fold-ownership-periods.mjs
 *
 * Drives public.fold_vehicle_ownership_periods(after, limit, apply) in vehicle-id chunks: the fold from the log of
 * sold lots to owner periods (public.vehicle_ownerships, identity-keyed). Dry by default. Each call is one
 * transaction well under the 10 s role cap (about 1 s per 400 vehicles measured 2026-10-20 on a dry run), so the
 * run is resumable from the last cursor and safe to stop at any time. Needs SUPABASE_ACCESS_TOKEN.
 *
 *   dotenvx run -q -- node scripts/data/fold-ownership-periods.mjs                       # dry run, whole table
 *   dotenvx run -q -- node scripts/data/fold-ownership-periods.mjs --after <uuid>        # resume from a cursor
 *   dotenvx run -q -- node scripts/data/fold-ownership-periods.mjs --apply --max-chunks 5 # write five chunks, then stop
 *
 * Flags: --apply (write), --limit N (vehicles per call, default 400, max 2000), --after UUID (cursor),
 *        --max-chunks N (stop after N calls), --pause-ms N (between calls, default 300).
 * Prints the cursor after every chunk and the summed counts at the end. A re-run over the same inputs writes nothing.
 */
const PROJECT = 'qkgaybvrernstplzjaam';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('fold-ownership-periods: SUPABASE_ACCESS_TOKEN is not set');
  process.exit(2);
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const APPLY = process.argv.includes('--apply');
const LIMIT = Math.min(2000, Math.max(1, Number(arg('--limit', '400'))));
const MAX_CHUNKS = Number(arg('--max-chunks', '0')) || Infinity;
const PAUSE = Number(arg('--pause-ms', '300'));
let after = arg('--after', null);
if (after && !/^[0-9a-f-]{36}$/i.test(after)) {
  console.error('fold-ownership-periods: --after must be a uuid');
  process.exit(2);
}

async function sql(query) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    if (res.status === 429 || /Throttler/.test(JSON.stringify(body))) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  throw new Error('throttled five times');
}

const sum = (a, b) => {
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === 'number') a[k] = (a[k] ?? 0) + v;
    else if (v && typeof v === 'object') a[k] = sum(a[k] ?? {}, v);
  }
  return a;
};

const total = {};
let chunks = 0;
console.log(`fold-ownership-periods: ${APPLY ? 'APPLY' : 'dry run'}, ${LIMIT} vehicles per call, from ${after ?? 'the start'}`);
while (chunks < MAX_CHUNKS) {
  const rows = await sql(
    `select public.fold_vehicle_ownership_periods(${after ? `'${after}'::uuid` : 'null'}, ${LIMIT}, ${APPLY}) as r`,
  );
  const r = rows[0].r;
  if (r.skipped) {
    console.error(`skipped: ${r.skipped}`);
    process.exit(3);
  }
  if (r.done) break;
  chunks++;
  after = r.next_after;
  sum(total, {
    vehicles: r.vehicles, periods: r.periods, vehicles_with_periods: r.vehicles_with_periods,
    vehicles_not_folded: r.vehicles_not_folded, would_insert: r.would_insert, would_supersede: r.would_supersede,
    unchanged: r.unchanged, periods_by_state: r.periods_by_state, chain_flags: r.chain_flags, flags: r.flags,
  });
  if (chunks % 10 === 0) console.log(`chunk ${chunks}, cursor ${after}`);
  await new Promise((res) => setTimeout(res, PAUSE));
}
console.log(JSON.stringify({ applied: APPLY, chunks, last_cursor: after, ...total }, null, 2));
