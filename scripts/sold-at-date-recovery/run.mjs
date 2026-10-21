#!/usr/bin/env node
/**
 * Run in-DB sold_at date recovery (M1, M2, M3, G1, A1, C1, C2).
 *
 *   # Via Supabase Management API (needs SUPABASE_ACCESS_TOKEN):
 *   dotenvx run -q -- node scripts/sold-at-date-recovery/run.mjs --apply
 *
 *   # Dry plan one rule:
 *   ... --rule M1 --limit 50
 *
 * Writes only through recover_vehicle_event_sold_at_batch. Revert:
 *   scripts/sold-at-date-recovery/revert.sql
 */
const PROJECT = "qkgaybvrernstplzjaam";
const RULES = ["M1", "G1", "C1", "C2", "A1", "M2", "M3"];
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const APPLY = args.includes("--apply");
const RULE_FILTER = opt("--rule", null);
const LIMIT = Math.min(Math.max(Number(opt("--limit", "100")) || 100, 1), 200);
const MAX_BATCHES = Math.max(Number(opt("--max-batches", "0")) || 0, 0); // 0 = until empty
const PACE_MS = Math.max(Number(opt("--pace-ms", "250")) || 250, 50);
const ASSERTED_BY = "scripts/sold-at-date-recovery/run.mjs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(query, attempt = 1) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (res.status === 429 || res.status >= 500 || /ThrottlerException/.test(text)) {
    if (attempt >= 8) throw new Error(`gave up (${res.status}): ${text.slice(0, 200)}`);
    await sleep(5000 * attempt);
    return api(query, attempt + 1);
  }
  let rows = null;
  try {
    rows = JSON.parse(text);
  } catch {
    /* below */
  }
  if (!res.ok) throw new Error(`query failed (${res.status}): ${text.slice(0, 500)}`);
  return rows;
}

async function runSql(sql) {
  return api(`SET statement_timeout = '55s'; ${sql}`);
}

const rules = RULE_FILTER ? [RULE_FILTER] : RULES;
const totals = {};

for (const rule of rules) {
  let after = null;
  let batches = 0;
  let corrected = 0;
  for (;;) {
    if (MAX_BATCHES > 0 && batches >= MAX_BATCHES) break;
    const planRows = await runSql(
      `SELECT public.plan_sold_at_date_recovery('${rule}', ${
        after ? `'${after}'::uuid` : "NULL"
      }, ${LIMIT}) AS plan`,
    );
    const plan = Array.isArray(planRows) ? planRows[0]?.plan : planRows?.plan;
    const n = Number(plan?.n || 0);
    if (!n) {
      console.log(JSON.stringify({ rule, done: true, corrected, batches }));
      break;
    }
    if (!APPLY) {
      console.log(
        JSON.stringify({
          rule,
          dry_run: true,
          n,
          sample: (plan.rows || []).slice(0, 2),
          next_after_id: plan.next_after_id,
        }),
      );
      break;
    }
    const payload = JSON.stringify(plan.rows).replace(/'/g, "''");
    const resRows = await runSql(
      `SELECT public.recover_vehicle_event_sold_at_batch('${payload}'::jsonb, '${ASSERTED_BY}') AS res`,
    );
    const res = Array.isArray(resRows) ? resRows[0]?.res : resRows?.res;
    const got = Number(res?.corrected_n || 0);
    corrected += got;
    batches += 1;
    after = plan.next_after_id;
    console.log(
      JSON.stringify({
        rule,
        batch: batches,
        planned: n,
        corrected: got,
        running: corrected,
        after,
        noop: Array.isArray(res?.noop) ? res.noop.length : 0,
      }),
    );
    await sleep(PACE_MS);
  }
  totals[rule] = { corrected, batches };
}

console.log(JSON.stringify({ apply: APPLY, totals }));
