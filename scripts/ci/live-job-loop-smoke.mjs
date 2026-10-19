#!/usr/bin/env node
/**
 * Live job-loop smoke test against PRODUCTION that never commits a row.
 *
 * Each scenario is ONE transaction sent to the Management API (the q.sh path): BEGIN, synthetic users and a vehicle
 * created inside it, the job loop through its public Sign RPCs as those users (SET LOCAL ROLE authenticated + JWT
 * claims), the open readers as anon and as a signed-in stranger, assertions collected into a temp table, then
 * ROLLBACK. The script refuses to send SQL that contains COMMIT or does not end in ROLLBACK. Afterwards a read-only
 * query proves zero net rows: job-loop table counts unchanged and no synthetic id (prefix 5e0e5e0e) left anywhere.
 * A second scenario exercises the ownership review path (user submission, service approve_ownership_verification, audit
 * row, owner grant). Read-only checks on real data: scoreboard shape, the owner's provider profile, anon latency through
 * PostgREST (one cold call, then the median of five warm calls; 2 s, the owner's photo-heavy profile 3 s), and server-side
 * reader budgets inside rolled-back transactions as anon and as the owner (warm median of five < 500 ms, first call < 3 s).
 *
 *   SUPABASE_ACCESS_TOKEN=... VITE_SUPABASE_ANON_KEY=... node scripts/ci/live-job-loop-smoke.mjs [--json out.json]
 *   locally: (cd ~/nuke && dotenvx run -q -- node <worktree>/scripts/ci/live-job-loop-smoke.mjs)
 *
 * Exit 0 when every check passes, 1 otherwise. Secrets are read from the environment and never printed.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PROJECT = 'qkgaybvrernstplzjaam';
const REST = `https://${PROJECT}.supabase.co/rest/v1`;
const OWNER = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const OWNER_ACTOR = 'a0000001-0000-0000-0000-000000000001';
const LATENCY_BUDGET_S = 2;
const OWNER_PROFILE_BUDGET_S = 3;
// Server-side reader budgets (in the database, no network): warm median of five < 500 ms, first call in the session < 3 s,
// as anon and as the owner (rolled-back JWT simulation). The K2500 job is the biggest published job (34 requirements).
const SERVER_WARM_BUDGET_MS = 500;
const SERVER_COLD_BUDGET_MS = 3000;
const K2500_JOB = '3df0f925-1b79-49b4-9181-fd0f4c6e14ad';
const K2500_VEHICLE = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const SERVER_READERS = [
  ['open_requirements_read', 'public.open_requirements_read(NULL, 25, NULL)', [null, OWNER]],
  ['work_order_provider_matches_read (K2500)', `public.work_order_provider_matches_read('${K2500_JOB}')`, [OWNER]],
  ['provider_profile_read (owner)', `public.provider_profile_read('${OWNER}', NULL)`, [null, OWNER]],
  ['work_order_job_path_read (K2500)', `public.work_order_job_path_read('${K2500_JOB}')`, [null, OWNER]],
  ['work_order_operations_read (K2500)', `public.work_order_operations_read('${K2500_JOB}')`, [null, OWNER]],
  ['work_order_quotes_read (K2500)', `public.work_order_quotes_read('${K2500_JOB}')`, [null, OWNER]],
  ['work_order_offers_read (K2500)', `public.work_order_offers_read('${K2500_JOB}')`, [null, OWNER]],
  ['my_signature_queue (owner)', 'public.my_signature_queue()', [OWNER]],
  ['vehicle_work_orders_read (K2500 vehicle)', `public.vehicle_work_orders_read('${K2500_VEHICLE}')`, [null, OWNER]],
];
const token = process.env.SUPABASE_ACCESS_TOKEN;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!token) { console.error('live-job-loop-smoke: SUPABASE_ACCESS_TOKEN is not set'); process.exit(2); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function q(query, { attempt = 1 } = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`gave up after ${attempt} attempts (${res.status}): ${text.slice(0, 200)}`);
    await sleep((Number(res.headers.get('retry-after')) || 10 * attempt) * 1000);
    return q(query, { attempt: attempt + 1 });
  }
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* reported below */ }
  if (!res.ok || !Array.isArray(rows)) throw new Error(`query failed (${res.status}): ${text.slice(0, 600)}`);
  await sleep(1000);
  return rows;
}

function rolledBack(statements) {
  const sql = ['BEGIN', ...statements, 'ROLLBACK'].join(';\n') + ';';
  if (/\bcommit\b/i.test(sql) || /\bend\s+transaction\b/i.test(sql)) throw new Error('refusing to send SQL containing COMMIT');
  if (!/ROLLBACK;$/.test(sql)) throw new Error('scenario SQL must end in ROLLBACK');
  return sql;
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const synth = () => `5e0e5e0e${randomUUID().slice(8)}`;
const claims = (sub) => lit(JSON.stringify(sub ? { sub, role: 'authenticated' } : { role: 'anon' }));
const as = (sub) => sub
  ? `SELECT set_config('request.jwt.claims', ${claims(sub)}, true); SET LOCAL ROLE authenticated`
  : `SELECT set_config('request.jwt.claims', ${claims(null)}, true); SET LOCAL ROLE anon`;
const asService = `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true); SET LOCAL ROLE service_role`;
const ctx = (k) => `(SELECT v FROM smoke_ctx WHERE k = ${lit(k)})`;
const put = (k, expr) => `INSERT INTO smoke_ctx VALUES (${lit(k)}, (${expr})::jsonb)`;
const check = (step, cond, detail = 'NULL') =>
  `INSERT INTO smoke_log(step, ok, detail) SELECT ${lit(step)}, COALESCE((${cond}), false), (${detail})::jsonb`;
const refused = (step, call) => `DO $smoke$ BEGIN
  BEGIN PERFORM ${call}; INSERT INTO smoke_log(step, ok, detail) VALUES (${lit(step)}, false, '{"refused":false}');
  EXCEPTION WHEN OTHERS THEN INSERT INTO smoke_log(step, ok, detail) VALUES (${lit(step)}, true, jsonb_build_object('refused', true)); END;
END $smoke$`;
const PII = `'(@smoke\\.invalid|smoke-[0-9a-f]{4}|"(email|phone|phone_number|address|street|zip|full_name|customer_name|customer_phone|customer_email)": "[^"]+")'`;

// The scenario: client C posts a job on own vehicle V; mechanic M (self-claimed actor X) offers, is accepted, starts,
// quotes, the client accepts, completion is attested and accepted, invoiced, payment witnessed by both sides; stranger S
// contacts M through Nuke. Readers swept as anon and S.
function jobLoopScenario() {
  const C = synth(), M = synth(), S = synth(), V = synth(), X = synth();
  const user = (id, tag) => `(${lit(id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${lit(`smoke-${id.slice(4, 8)}-${tag}@smoke.invalid`)}, ${lit(JSON.stringify({ preferred_username: `smoke_${tag}_${id.slice(4, 8)}` }))}::jsonb, now(), now())`;
  const wo = `(${ctx('pr')}->>'work_order_id')::uuid`;
  const readers = (who) => [
    ['job_path', `work_order_job_path_read(${wo})`], ['resources', `work_order_resources_read(${wo})`],
    ['quotes', `work_order_quotes_read(${wo})`], ['offers', `work_order_offers_read(${wo})`],
    ['invoices', `work_order_invoices_read(${wo})`], ['evidence', `work_order_evidence_read(${wo})`],
    ['vehicle_work_orders', `vehicle_work_orders_read(${lit(V)})`], ['provider_profile', `provider_profile_read(${lit(M)})`],
    ['provider_job_record', `provider_job_record_read(${lit(M)})`], ['statement', `work_order_statement_read(${wo})`],
    ['open_requirements', `open_requirements_read(NULL, 50, NULL)`],
  ].map(([k, call]) => put(`read_${who}_${k}`, call));
  const signs = ['pr', 'mo', 'ma', 'st', 'q1', 'qa', 'at', 'ac', 'inv', 'pw1', 'pw2', 'cr'];
  const statements = [
    "SET LOCAL statement_timeout = '10s'",
    'CREATE TEMP TABLE smoke_ctx(k text PRIMARY KEY, v jsonb)',
    'CREATE TEMP TABLE smoke_log(n serial, step text, ok boolean, detail jsonb)',
    'GRANT ALL ON smoke_ctx, smoke_log TO PUBLIC',
    'GRANT USAGE ON SEQUENCE smoke_log_n_seq TO PUBLIC',
    `INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES ${user(C, 'client')}, ${user(M, 'mech')}, ${user(S, 'stranger')}`,
    `UPDATE profiles SET is_public = false WHERE id = ${lit(C)}`,
    `INSERT INTO vehicles(id, year, make, model, owner_id, uploaded_by, is_public) VALUES (${lit(V)}, 1984, 'Chevrolet', 'K10', ${lit(C)}, ${lit(C)}, true)`,
    `INSERT INTO actors(id, actor_type, name) VALUES (${lit(X)}, 'individual', 'Smoke Synthetic Actor')`,
    // Mechanic self-claims the actor (the Sign a user can make alone).
    as(M),
    `INSERT INTO account_link_claims(user_id, platform, handle, actor_id, verification_method) VALUES (${lit(M)}, 'nuke_actor', ${lit(X)}, ${lit(X)}, 'self_claim')`,
    'RESET ROLE',
    // Client posts the job.
    as(C),
    put('pr', `post_work_request(${lit(V)}, 'The exhaust leaks at the manifold. The brakes squeal when stopping.', NULL, NULL, now() + interval '21 days', 'open')`),
    'RESET ROLE',
    asService,
    put('jp_after_post', `read_work_order_job_path(${wo})`),
    'RESET ROLE',
    // Mechanic finds it and offers.
    as(M),
    put('req', `(SELECT r FROM jsonb_array_elements(${ctx('pr')}->'requirements') r WHERE r->>'description' ~* 'exhaust' LIMIT 1)`),
    put('open_m', `open_requirements_read(NULL, 100, 'skill')`),
    put('mo', `offer_on_requirement((${ctx('req')}->>'requirement_id')::uuid, jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('description', 'Manifold gasket and muffler', 'pricing_basis', 'flat', 'amount', 350, 'currency', 'USD', 'unit', NULL, 'quantity', NULL))), now() + interval '1 day', now() + interval '10 days', NULL)`),
    'RESET ROLE',
    // Client accepts with the reader's hash.
    as(C),
    put('ma', `accept_offer((${ctx('mo')}->>'offer_id')::uuid, (SELECT a->'args'->>'p_offer_hash' FROM jsonb_array_elements(work_order_offers_read(${wo})#>'{viewer,actions}') a WHERE a->>'action' = 'accept_offer' LIMIT 1))`),
    'RESET ROLE',
    // Mechanic starts, then quotes.
    as(M),
    put('st', `start_work(${wo}, (SELECT a->'args'->>'p_terms_hash' FROM jsonb_array_elements(work_order_job_path_read(${wo})#>'{viewer,actions}') a WHERE a->>'action' = 'start_work' LIMIT 1))`),
    put('q1', `issue_work_order_quote(${wo}, jsonb_build_array(jsonb_build_object('ref_kind', 'fee', 'ref_id', NULL, 'description', 'Exhaust repair', 'pricing_basis', 'flat', 'amount', 350, 'currency', 'USD', 'unit', NULL, 'quantity', NULL)), NULL, now() + interval '30 days', NULL)`),
    'RESET ROLE',
    as(C),
    put('queue_c_quote', `my_signature_queue()`),
    put('qa', `accept_work_order_quote((${ctx('q1')}->>'quote_id')::uuid, ${ctx('q1')}->>'quote_hash')`),
    'RESET ROLE',
    as(M),
    put('at', `attest_work_completion(${wo}, ${ctx('q1')}->>'quote_hash', 'Smoke: exhaust done', NULL)`),
    'RESET ROLE',
    as(C),
    put('ac', `accept_work_completion(${wo}, (${ctx('at')}->>'completion_id')::uuid, ${ctx('at')}->>'completion_hash')`),
    'RESET ROLE',
    as(M),
    put('inv', `issue_work_order_invoice(${wo}, jsonb_build_array(jsonb_build_object('quote_line', 0, 'description', 'Exhaust repair', 'pricing_basis', 'flat', 'amount', 350, 'currency', 'USD')), (${ctx('q1')}->>'quote_id')::uuid, now() + interval '14 days')`),
    'RESET ROLE',
    as(C),
    put('pw1', `record_work_order_payment((${ctx('inv')}->>'invoice_id')::uuid, 350, 'USD', 'card', now() - interval '5 minutes', 'smoke-ref')`),
    'RESET ROLE',
    as(M),
    put('pw2', `record_work_order_payment((${ctx('inv')}->>'invoice_id')::uuid, 350, 'USD', 'card', now() - interval '5 minutes', 'smoke-ref')`),
    'RESET ROLE',
    // Stranger contacts the mechanic through Nuke; the thread stays between the two.
    as(S),
    put('cr', `request_contact('work_order', ${wo}, 'Smoke: are you available next week?', ${lit(M)})`),
    'RESET ROLE',
    as(M),
    `SELECT respond_contact_request((${ctx('cr')}->>'request_id')::uuid, true)`,
    `SELECT post_contact_message((${ctx('cr')}->>'request_id')::uuid, 'Smoke reply inside the thread')`,
    'RESET ROLE',
    as(S),
    put('thread_s', `contact_thread_read((${ctx('cr')}->>'request_id')::uuid)`),
    ...readers('stranger'),
    'RESET ROLE',
    as(C),
    refused('contact thread: a third party (the client) is refused', `contact_thread_read((${ctx('cr')}->>'request_id')::uuid)`),
    put('invoices_client', `work_order_invoices_read(${wo})`),
    'RESET ROLE',
    as(null),
    ...readers('anon'),
    refused('contact thread: anon is refused', `contact_thread_read((${ctx('cr')}->>'request_id')::uuid)`),
    'RESET ROLE',
    asService,
    put('jp_service', `read_work_order_job_path(${wo})`),
    'RESET ROLE',
    // Assertions.
    check('post_work_request: job with requirements, not payment-authorized', `${ctx('pr')} ? 'work_order_id' AND jsonb_array_length(${ctx('pr')}->'requirements') >= 1 AND ${ctx('pr')}->>'payment_authorized' = 'false'`, `${ctx('pr')}->'requirements'`),
    check('open_requirements_read: the mechanic sees the posted requirement', `EXISTS (SELECT 1 FROM jsonb_array_elements(${ctx('open_m')}->'rows') r WHERE r->>'requirement_id' = ${ctx('req')}->>'requirement_id')`),
    check('offer_on_requirement: individual offer at self_claim', `${ctx('mo')} ? 'offer_id'`, ctx('mo')),
    check('accept_offer: client accepts with the reader hash', `${ctx('ma')}->>'payment_authorized' = 'false'`, ctx('ma')),
    check('start_work: accepted provider starts', `${ctx('st')}->>'duplicate' = 'false'`, ctx('st')),
    check('issue_work_order_quote: accepted provider quotes', `${ctx('q1')} @> '{"version":1,"payment_authorized":false}'`, ctx('q1')),
    check('my_signature_queue: client has quote_to_accept', `EXISTS (SELECT 1 FROM jsonb_array_elements(${ctx('queue_c_quote')}->'items') i WHERE i->>'kind' = 'quote_to_accept' AND i->>'ref_id' = ${ctx('q1')}->>'quote_id')`),
    check('accept_work_order_quote: client accepts the quote', `${ctx('qa')}->>'duplicate' = 'false'`, ctx('qa')),
    check('attest_work_completion: provider attests', `${ctx('at')} ? 'completion_id' AND ${ctx('at')}->>'payment_authorized' = 'false'`, ctx('at')),
    check('accept_work_completion: client accepts', `${ctx('ac')}->>'signer_role' = 'customer'`, ctx('ac')),
    check('issue_work_order_invoice: invoice, nothing moved', `${ctx('inv')} @> '{"payment_authorized":false,"money_moved":false}'`, ctx('inv')),
    check('record_work_order_payment: payer then payee witnesses settle; nothing disbursed', `${ctx('pw1')} @> '{"witness_side":"payer","payment_authorized":false,"disbursement":"not_performed"}' AND ${ctx('pw2')} @> '{"witness_side":"payee","payment_authorized":false,"disbursement":"not_performed","money_moved":false}'`, `jsonb_build_object('payer', ${ctx('pw1')}->'reconciliation', 'payee', ${ctx('pw2')}->'reconciliation')`),
    check('every Sign: payment_authorized never true, nothing disbursed', `NOT EXISTS (SELECT 1 FROM smoke_ctx WHERE k IN (${signs.map(lit).join(',')}) AND (v::text ~ '"payment_authorized": true' OR (v ? 'disbursement' AND v->>'disbursement' <> 'not_performed') OR (v ? 'money_moved' AND (v->>'money_moved')::boolean)))`, `(SELECT jsonb_agg(k) FROM smoke_ctx WHERE k IN (${signs.map(lit).join(',')}))`),
    check('job path (service) after posting: intake recorded; terms, execution, completion not yet', `${ctx('jp_after_post')}#>>'{stages,intake,state}' = 'recorded' AND ${ctx('jp_after_post')}#>>'{stages,terms,state}' <> 'recorded' AND ${ctx('jp_after_post')}#>>'{stages,execution,state}' <> 'recorded' AND ${ctx('jp_after_post')}#>>'{stages,completion,state}' <> 'recorded'`, `(SELECT jsonb_object_agg(k, v->'state') FROM jsonb_each(${ctx('jp_after_post')}->'stages') e(k, v))`),
    check('job path (service): intake, terms, execution, completion, accounting recorded', `${ctx('jp_service')}->'stages' @> '{"intake":{"state":"recorded"},"terms":{"state":"recorded"},"execution":{"state":"recorded"},"completion":{"state":"recorded"},"accounting":{"state":"recorded"}}'`, `(SELECT jsonb_object_agg(k, v->'state') FROM jsonb_each(${ctx('jp_service')}->'stages') e(k, v))`),
    check('job path (anon): accounting withheld from a visitor', `${ctx('read_anon_job_path')}#>>'{stages,accounting,state}' IN ('withheld', 'not_reported') OR NOT (${ctx('read_anon_job_path')}#>'{stages,accounting}') ? 'reconciliation'`, `${ctx('read_anon_job_path')}#>'{stages,accounting,state}'`),
    check('open readers (anon + stranger): no contact fields, synthetic emails or the private client id', `NOT EXISTS (SELECT 1 FROM smoke_ctx WHERE k ~ '^read_' AND (v::text ~* ${PII} OR v::text ~ ${lit(C)}))`, `(SELECT jsonb_agg(k) FROM smoke_ctx WHERE k ~ '^read_' AND (v::text ~* ${PII} OR v::text ~ ${lit(C)}))`),
    check('open readers (anon + stranger): invoice payments, reconciliation and release withheld', `NOT EXISTS (SELECT 1 FROM smoke_ctx WHERE k ~ '^read_.*_invoices$' AND (v->'payments' <> 'null'::jsonb OR v->'reconciliation' <> 'null'::jsonb OR v->'release' <> 'null'::jsonb))`),
    check('open readers (anon + stranger): no payment references or private notes', `NOT EXISTS (SELECT 1 FROM smoke_ctx WHERE k ~ '^read_' AND v::text ~ '(smoke-ref|Smoke reply|are you available|"payment_authorized": true)')`),
    check('invoice reader (client, a party): payments visible', `jsonb_array_length(${ctx('invoices_client')}->'payments') = 2`),
    check('contact thread: the stranger and mechanic share the thread', `${ctx('thread_s')} @> '{"request":{"status":"accepted"},"messages":[{"body":"Smoke reply inside the thread"}]}'`),
    'SELECT jsonb_agg(jsonb_build_object(\'step\', step, \'ok\', ok, \'detail\', detail) ORDER BY n) AS log FROM smoke_log',
  ];
  return { name: 'job_loop', sql: rolledBack(statements), synthetic: { C, M, S, V, X } };
}

// The ownership review path: a signed-in user files a pending title verification for their own vehicle (the
// recompute trigger must not refuse them), the service-only approve_ownership_verification approves it with a
// reviewer, one audit row is appended, the owner permission is granted and vehicle_verified_owner turns true.
function ownershipReviewScenario() {
  const U = synth(), R = synth(), V = synth();
  const user = (id, tag) => `(${lit(id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${lit(`smoke-${id.slice(9, 13)}-${tag}@smoke.invalid`)}, now(), now())`;
  const ov = `(SELECT id FROM ownership_verifications WHERE user_id = ${lit(U)} AND vehicle_id = ${lit(V)})`;
  const statements = [
    "SET LOCAL statement_timeout = '10s'",
    'CREATE TEMP TABLE smoke_ctx(k text PRIMARY KEY, v jsonb)',
    'CREATE TEMP TABLE smoke_log(n serial, step text, ok boolean, detail jsonb)',
    'GRANT ALL ON smoke_ctx, smoke_log TO PUBLIC',
    'GRANT USAGE ON SEQUENCE smoke_log_n_seq TO PUBLIC',
    `INSERT INTO auth.users(id, instance_id, aud, role, email, created_at, updated_at) VALUES ${user(U, 'owner')}, ${user(R, 'reviewer')}`,
    `INSERT INTO vehicles(id, year, make, model, owner_id, uploaded_by, is_public) VALUES (${lit(V)}, 1977, 'Chevrolet', 'Blazer', ${lit(U)}, ${lit(U)}, true)`,
    as(U),
    `INSERT INTO ownership_verifications(user_id, vehicle_id, title_document_url, drivers_license_url, status) VALUES (${lit(U)}, ${lit(V)}, 'https://example.invalid/smoke-title.jpg', 'pending', 'pending')`,
    refused('approve_ownership_verification: a signed-in user cannot approve', `approve_ownership_verification(${ov}, ${lit(U)}, 'self')`),
    'RESET ROLE',
    check('submission: the user\'s own pending verification lands', `EXISTS (SELECT 1 FROM ownership_verifications WHERE id = ${ov} AND status = 'pending')`),
    asService,
    put('ap', `to_jsonb(approve_ownership_verification(${ov}, ${lit(R)}, 'smoke review'))`),
    'RESET ROLE',
    check('approve_ownership_verification: approved with reviewer, notes and clocks', `${ctx('ap')} = 'true'::jsonb AND EXISTS (SELECT 1 FROM ownership_verifications WHERE id = ${ov} AND status = 'approved' AND human_reviewer_id = ${lit(R)} AND human_review_notes = 'smoke review' AND approved_at IS NOT NULL AND human_reviewed_at IS NOT NULL)`),
    check('approve_ownership_verification: one audit row', `(SELECT count(*) FROM verification_audit_log WHERE verification_id = ${ov} AND action = 'approved' AND actor_id = ${lit(R)}) = 1`),
    check('approval grants the owner permission and verified ownership', `public.vehicle_verified_owner(${lit(U)}, ${lit(V)}) AND EXISTS (SELECT 1 FROM vehicle_user_permissions WHERE vehicle_id = ${lit(V)} AND user_id = ${lit(U)} AND role = 'owner' AND is_active)`),
    'SELECT jsonb_agg(jsonb_build_object(\'step\', step, \'ok\', ok, \'detail\', detail) ORDER BY n) AS log FROM smoke_log',
  ];
  return { name: 'ownership_review', sql: rolledBack(statements), synthetic: { U, R, V } };
}

// Zero net rows: counts of every job-loop table and residue of synthetic ids.
const JOB_TABLES = `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'r' AND c.relname ~ '^(work_order|account_link_claims|contact_|provider_vouches|actor_capabilit|owner_delegated_signs|facility_|actors$|verification_audit_log$)'`;
async function tableCounts() {
  const names = (await q(JOB_TABLES)).map((r) => r.relname).sort();
  const sql = names.map((t) => `SELECT ${lit(t)} AS t, count(*)::bigint AS n FROM public.${t}`).join(' UNION ALL ');
  return Object.fromEntries((await q(sql)).map((r) => [r.t, Number(r.n)]));
}
async function residue(since) {
  const lo = "'5e0e5e0e-0000-0000-0000-000000000000'::uuid", hi = "'5e0e5e0f-0000-0000-0000-000000000000'::uuid";
  const rows = await q(`SELECT
    (SELECT count(*) FROM auth.users WHERE id >= ${lo} AND id < ${hi}) AS users,
    (SELECT count(*) FROM public.profiles WHERE id >= ${lo} AND id < ${hi}) AS profiles,
    (SELECT count(*) FROM public.vehicles WHERE id >= ${lo} AND id < ${hi}) AS vehicles,
    (SELECT count(*) FROM public.actors WHERE id >= ${lo} AND id < ${hi}) AS actors,
    (SELECT count(*) FROM public.work_orders WHERE customer_id >= ${lo} AND customer_id < ${hi}) AS work_orders,
    (SELECT count(*) FROM public.account_link_claims WHERE user_id >= ${lo} AND user_id < ${hi}) AS claims,
    (SELECT count(*) FROM public.vehicle_observations WHERE ingested_at >= ${lit(since)}::timestamptz AND submitted_by_user_id >= ${lo} AND submitted_by_user_id < ${hi}) AS observations,
    (SELECT count(*) FROM public.contact_requests WHERE requester_user_id >= ${lo} AND requester_user_id < ${hi}) AS contact_requests,
    (SELECT count(*) FROM public.ownership_verifications WHERE user_id >= ${lo} AND user_id < ${hi}) AS ownership_verifications,
    (SELECT count(*) FROM public.vehicle_user_permissions WHERE user_id >= ${lo} AND user_id < ${hi}) AS vehicle_permissions`);
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

async function anonCall(name, body) {
  const times = [];
  let status = null, text = '';
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    const res = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    text = await res.text(); status = res.status;
    times.push((performance.now() - t0) / 1000);
    await sleep(500);
  }
  const warm = times.slice(1).sort((a, b) => a - b);
  return { status, cold_s: Number(times[0].toFixed(3)), warm_s: Number(warm[2].toFixed(3)), warm_samples_s: times.slice(1).map((t) => Number(t.toFixed(3))), text };
}

async function serverLatencyChecks() {
  const out = [];
  for (const [label, expr, viewers] of SERVER_READERS) {
    for (const sub of viewers) {
      const who = sub ? 'owner' : 'anon';
      try {
        const rows = await q(rolledBack([
          'CREATE TEMP TABLE smoke_lat(cold_ms numeric, warm_ms numeric[])',
          'GRANT ALL ON smoke_lat TO PUBLIC',
          as(sub),
          `DO $b$ DECLARE t0 timestamptz; c numeric; w numeric[] := '{}'; r jsonb; i int; BEGIN
             t0 := clock_timestamp(); r := ${expr}; c := extract(epoch FROM clock_timestamp() - t0) * 1000;
             FOR i IN 1..5 LOOP t0 := clock_timestamp(); r := ${expr}; w := w || round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1); END LOOP;
             INSERT INTO smoke_lat VALUES (round(c, 1), w); END $b$`,
          'SELECT cold_ms, warm_ms, (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x) FROM unnest(warm_ms) x) AS warm_median_ms FROM smoke_lat',
        ]));
        const r = rows[0] || {};
        const warm = Number(r.warm_median_ms), cold = Number(r.cold_ms);
        out.push({ step: `server ${who} ${label}: warm median < ${SERVER_WARM_BUDGET_MS} ms, first call < ${SERVER_COLD_BUDGET_MS} ms`,
          ok: warm < SERVER_WARM_BUDGET_MS && cold < SERVER_COLD_BUDGET_MS, detail: { cold_ms: cold, warm_median_ms: warm, warm_samples_ms: r.warm_ms } });
      } catch (e) {
        out.push({ step: `server ${who} ${label}`, ok: false, detail: { error: String(e.message).slice(0, 300) } });
      }
    }
  }
  return out;
}

async function readOnlyChecks() {
  const out = [];
  const [{ sb }] = await q('SELECT work_order_job_path_scoreboard() AS sb');
  const stages = Object.keys(sb?.stages || {});
  out.push({ step: 'scoreboard: 7 stages with state counts', ok: stages.length === 7, detail: { stages } });
  if (!anonKey) {
    out.push({ step: 'anon checks (no anon key in env)', ok: false, detail: { skipped: true } });
    return out;
  }
  for (const [label, name, body, budget = LATENCY_BUDGET_S] of [
    ['owner provider profile', 'provider_profile_read', { p_user_id: OWNER }, OWNER_PROFILE_BUDGET_S],
    ['actor provider profile', 'provider_profile_read', { p_actor_id: OWNER_ACTOR }],
    ['open requirements', 'open_requirements_read', {}],
    ['delegated-sign register', 'owner_delegated_signs_read', {}],
  ]) {
    const r = await anonCall(name, body);
    const leak = /@[a-z0-9-]+\.[a-z]|"(email|phone|phone_number|address|street|zip)": "[^"]+"/i.test(r.text);
    out.push({ step: `anon ${label}: 200, warm median < ${budget}s, no contact fields`, ok: r.status === 200 && r.warm_s < budget && !leak,
      detail: { status: r.status, cold_s: r.cold_s, warm_median_s: r.warm_s, warm_samples_s: r.warm_samples_s, leak } });
    if (label === 'owner provider profile' && r.status === 200) {
      const want = ['fabrication_exhaust', 'welding_tig', 'welding_mig'];
      out.push({ step: 'owner profile: derived skills shown (fabrication_exhaust, welding_tig, welding_mig)', ok: want.every((c) => r.text.includes(`"${c}"`)),
        detail: { found: want.filter((c) => r.text.includes(`"${c}"`)) } });
    }
  }
  return out;
}

const startedAt = new Date().toISOString();
const report = { started_at: startedAt, project: PROJECT, scenarios: [], read_only: [], net_rows: null, ok: false };
let failed = 0;
const before = await tableCounts();
const residueBefore = await residue(startedAt);
for (const build of [jobLoopScenario, ownershipReviewScenario]) {
  const s = build();
  const t0 = Date.now();
  try {
    const rows = await q(s.sql);
    const log = rows[0]?.log || [];
    const bad = log.filter((l) => !l.ok);
    failed += bad.length + (log.length ? 0 : 1);
    report.scenarios.push({ name: s.name, ok: bad.length === 0 && log.length > 0, seconds: (Date.now() - t0) / 1000, checks: log });
  } catch (e) {
    failed += 1;
    report.scenarios.push({ name: s.name, ok: false, seconds: (Date.now() - t0) / 1000, error: String(e.message).slice(0, 800) });
  }
}
try { report.read_only = await readOnlyChecks(); } catch (e) { report.read_only = [{ step: 'read-only checks', ok: false, detail: { error: String(e.message).slice(0, 400) } }]; }
try { report.read_only.push(...await serverLatencyChecks()); } catch (e) { report.read_only.push({ step: 'server latency checks', ok: false, detail: { error: String(e.message).slice(0, 400) } }); }
failed += report.read_only.filter((c) => !c.ok).length;
const after = await tableCounts();
const residueAfter = await residue(startedAt);
const moved = Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]).map((t) => ({ table: t, before: before[t] ?? 0, after: after[t] ?? 0 }));
const leftover = Object.entries(residueAfter).filter(([k, n]) => n > (residueBefore[k] ?? 0));
report.net_rows = { tables_counted: Object.keys(after).length, changed_tables: moved, synthetic_residue_before: residueBefore, synthetic_residue_after: residueAfter,
  ok: leftover.length === 0 && moved.length === 0, note: 'a changed count with zero synthetic residue means another writer moved that table during the run' };
if (leftover.length) failed += 1;
if (moved.length && !leftover.length) report.net_rows.ok = 'others_wrote';
report.ok = failed === 0;
report.finished_at = new Date().toISOString();

for (const s of report.scenarios) {
  console.log(`${s.ok ? 'PASS' : 'FAIL'} scenario ${s.name} (${s.seconds}s)${s.error ? `: ${s.error}` : ''}`);
  for (const c of s.checks || []) console.log(`  ${c.ok ? 'pass' : 'FAIL'} ${c.step}${c.ok ? '' : ` ${JSON.stringify(c.detail)?.slice(0, 300)}`}`);
}
for (const c of report.read_only) console.log(`${c.ok ? 'pass' : 'FAIL'} ${c.step} ${JSON.stringify(c.detail)}`);
console.log(`${leftover.length ? 'FAIL' : 'pass'} zero net rows: residue ${JSON.stringify(residueAfter)}; changed tables ${JSON.stringify(moved)}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
