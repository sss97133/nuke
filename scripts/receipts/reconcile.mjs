#!/usr/bin/env node
/**
 * receipts:reconcile — settle who paid for a receipt, what it was for, and whose expense it
 * is, from the owner's own records. Nothing is asked of the owner: every question is put to
 * the evidence, and what the evidence cannot answer is listed as the evidence still missing.
 *
 * Replaces two routing rules that produced the 2026-05 errors:
 *   - "vendor category => entity": scripts/receipt-attribution-ingest.mjs scoped every
 *     auto-parts receipt to Viva ("matches viva auto-parts pattern", or an LLM guess).
 *   - "date proximity => vehicle": scripts/receipt-attribution-cleanup.mjs (WS-8, retired).
 *
 * The questions, in order:
 *   Q1 author        receipts.user_id
 *   Q2 how paid      payment_method + card last four (placeholders such as 1234 or **** are not cards)
 *   Q3 whose card    owner-only facts in vehicle_observations (structured_data.fact =
 *                    'payment_instrument_holder'); card numbers never live in this repo
 *   Q4 books line    an exact-amount line within 4 days in qb_transactions => the paying account, and
 *                    its holder from owner-only facts (fact = 'payment_account_holder'); an account held
 *                    by an organization makes that organization the payer
 *   Q5 entity claims owner statements (fact = 'entity_has_no_vendor_accounts'): a printed customer
 *                    name for such an entity is not evidence that it paid
 *   Q6 what for      the receipt's own words (OCR blocks, extracted vehicle hint, line items)
 *                    naming exactly one of the author's vehicles held on that date. Never the date alone.
 *
 * Decision: the payer is the card's holder, the author for cash, the books account's holder,
 * or unknown. The expense belongs to the author unless an organization's own instrument or
 * account paid. Scope stays 'unknown' (author known, placement pending evidence); a car named on the
 * receipt is recorded as a candidate until a second, independent signal places the expense on it. Decisions land through sanctioned writers only:
 * correct_receipt_scope (scope + history), reassign_observation_subject, reattribute_observation.
 *
 * Usage (dry run prints the answers; --apply lands them):
 *   dotenvx run -- node scripts/receipts/reconcile.mjs --org-scoped
 *   dotenvx run -- node scripts/receipts/reconcile.mjs --org=<organization id> --apply
 *   dotenvx run -- node scripts/receipts/reconcile.mjs --ids=path/to/ids.txt --apply
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ORG_SCOPED = argv.includes('--org-scoped');
const ORG_ID = (argv.find((a) => a.startsWith('--org=')) || '').slice(6) || null;
const IDS_FILE = (argv.find((a) => a.startsWith('--ids=')) || '').slice(6) || null;
const RUN = `reconcile-v1:${new Date().toISOString().slice(0, 10)}`;

const PLACEHOLDER_CARDS = new Set(['', '0000', '1234', 'null', '****', 'xxxx', 'none']);
const GENERIC_MODEL_WORDS = new Set(['SWB', 'LWB', 'COUPE', 'SEDAN', 'CREW', 'CAB', 'CLASSIC', 'SIERRA', 'SPIDER',
  'DUALLY', 'PICKUP', 'SUPER', 'SPORT', 'HOT', 'ROD', 'ROADSTER', 'CONVERTIBLE', 'WAGON', 'SERIES', 'EDITION',
  'TRUCK', 'CAR', 'VAN', 'UTILITY', 'VEHICLE', 'CHASSIS', 'BODY', 'ENGINE', 'GRAND', 'TOTAL', 'LIMITED', 'PLUS']);

const cardOf = (r) => {
  const c = String(r.card_last4 ?? r.raw_extraction?.data?.card_last_four ?? '').replace(/\D/g, '').slice(-4);
  return PLACEHOLDER_CARDS.has(c) || c.length !== 4 ? null : c;
};
const wordsOf = (r) => {
  const x = r.raw_extraction || {};
  const blocks = Array.isArray(x.ocr?.blocks) ? x.ocr.blocks.map((b) => b?.text || '') : [];
  const items = Array.isArray(x.data?.line_items) ? x.data.line_items.map((i) => `${i?.description || ''} ${i?.part_number || ''}`) : [];
  return ` ${[...blocks, x.data?.vehicle_hint || '', ...items, r.vendor_name || ''].join(' \n ').toUpperCase()} `;
};
const hasWord = (text, w) => new RegExp(`(^|[^A-Z0-9])${w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([^A-Z0-9]|$)`).test(text);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

async function loadReceipts() {
  let q = sb.from('receipts').select('id,user_id,vendor_name,transaction_date,total_amount,payment_method,card_last4,scope_type,scope_id,vehicle_id,submitted_observation_id,raw_extraction,is_superseded').or('is_superseded.is.null,is_superseded.eq.false');
  if (IDS_FILE) {
    const ids = fs.readFileSync(IDS_FILE, 'utf8').split(/[\s,]+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await sb.from('receipts').select('id,user_id,vendor_name,transaction_date,total_amount,payment_method,card_last4,scope_type,scope_id,vehicle_id,submitted_observation_id,raw_extraction,is_superseded').in('id', ids.slice(i, i + 100));
      if (error) throw error;
      out.push(...data.filter((r) => r.is_superseded !== true));
    }
    return out;
  }
  if (ORG_SCOPED || ORG_ID) q = q.eq('scope_type', 'org');
  if (ORG_ID) q = q.eq('scope_id', ORG_ID);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  return data;
}

async function loadFacts(userIds) {
  const { data, error } = await sb.from('vehicle_observations')
    .select('id,subject_type,subject_id,structured_data')
    .is('vehicle_id', null).or('is_superseded.is.null,is_superseded.eq.false')
    .in('structured_data->>fact', ['payment_instrument_holder', 'entity_has_no_vendor_accounts', 'payment_account_holder']);
  if (error) throw error;
  const cards = new Map();          // `${userId}:${last4}` -> fact
  const noAccountOrgs = new Map();  // orgId -> fact
  const accounts = [];              // { number, holder, obs }
  for (const o of data) {
    const sd = o.structured_data || {};
    if (sd.fact === 'payment_instrument_holder' && userIds.has(o.subject_id)) cards.set(`${o.subject_id}:${sd.instrument?.last4}`, { obs: o.id, grade: sd.grade, holder: sd.holder });
    if (sd.fact === 'entity_has_no_vendor_accounts') noAccountOrgs.set(sd.entity?.id, { obs: o.id, statement: sd.statement });
    if (sd.fact === 'payment_account_holder' && sd.account?.number) accounts.push({ number: String(sd.account.number), holder: sd.holder, obs: o.id });
  }
  return { cards, noAccountOrgs, accounts };
}

async function loadVehicles(userId) {
  const { data: garage, error } = await sb.rpc('get_user_garage', { p_user_id: userId });
  if (error) throw error;
  const ids = garage.map((g) => g.vehicle_id);
  const { data: rows } = await sb.from('vehicles').select('id,year,make,model,sale_date,purchase_date').in('id', ids);
  return (rows || []).map((v) => {
    const tokens = String(v.model || '').toUpperCase().split(/[^A-Z0-9-]+/).filter((t) => t.length >= 3 && /[A-Z]/.test(t) && !GENERIC_MODEL_WORDS.has(t));
    return { ...v, tokens };
  });
}

async function booksMatch(r) {
  const amt = num(r.total_amount);
  if (!amt || !r.transaction_date) return null;
  const d = new Date(r.transaction_date);
  const lo = new Date(d.getTime() - 4 * 864e5).toISOString().slice(0, 10);
  const hi = new Date(d.getTime() + 4 * 864e5).toISOString().slice(0, 10);
  const { data } = await sb.from('qb_transactions').select('id,date,line_amount,payment_account,vendor_name')
    .gte('date', lo).lte('date', hi).in('line_amount', [amt, -amt]).limit(5);
  return data && data.length === 1 ? data[0] : null;
}

async function liveObservation(id) {
  let cur = id;
  for (let i = 0; cur && i < 10; i++) {
    const { data } = await sb.from('vehicle_observations').select('id,vehicle_id,subject_type,subject_id,is_superseded,superseded_by').eq('id', cur).maybeSingle();
    if (!data) return null;
    if (!data.is_superseded) return data;
    cur = data.superseded_by;
  }
  return null;
}

function decide(r, facts, vehicles, books) {
  const a = { q1_author: r.user_id };
  const unresolved = [];
  const card = cardOf(r);
  const method = String(r.payment_method || r.raw_extraction?.data?.payment_method || '').toLowerCase();
  a.q2_paid = { method: method || null, card_last4: card };

  let payer = null;
  if (card) {
    const f = facts.cards.get(`${r.user_id}:${card}`);
    if (f) { payer = { type: 'user', id: r.user_id, via: `card ${card}`, grade: f.grade, fact: f.obs }; }
    else unresolved.push(`card ending ${card} is not a known instrument: find its statement or card alert`);
  } else if (method.includes('cash')) {
    payer = { type: 'user', id: r.user_id, via: 'cash at the counter by the author', grade: 'cash' };
  }
  a.q3_card = payer?.via?.startsWith('card') ? payer : (card ? 'unknown' : 'no card');
  if (!payer && books) {
    const acct = facts.accounts.find((x) => String(books.payment_account || '').includes(x.number));
    payer = acct && acct.holder?.type === 'organization'
      ? { type: 'organization', id: acct.holder.id, via: `books line ${books.id} from ${books.payment_account}`, grade: 'books+account', fact: acct.obs }
      : { type: 'user', id: r.user_id, via: `books line ${books.id} (${books.payment_account || 'account unnamed'})`, grade: acct ? 'books+account' : 'books', ...(acct ? { fact: acct.obs } : {}) };
  }
  a.q4_books = books ? { line: books.id, account: books.payment_account, date: books.date } : null;

  const words = wordsOf(r);
  const printed = [];
  if (hasWord(words, 'VIVA LAS VEGAS AUTOS') || hasWord(words, 'VIVA LAS VEGAS AUTOS INC') || hasWord(words, 'A CARS LIFE')) printed.push('c433d27e-2159-4f8c-b4ae-32a5e44a77cf');
  const accountSale = /COMMERCIAL INVOICE|CHARGE TO ACCOUNT|ON ACCOUNT|CHARGE SALE/.test(words);
  a.q5_printed_customer = printed.map((id) => ({ org: id, owner_says_no_account: facts.noAccountOrgs.has(id) }));
  if (accountSale) a.q5_account_sale = true;
  if (!payer && accountSale) unresolved.push('account sale: the account holder is not on file');
  if (!payer && !card && !accountSale && !books) unresolved.push('no payment evidence on the receipt and no matching books line');

  const when = r.transaction_date ? new Date(r.transaction_date) : null;
  // Only a sale before the receipt rules a car out. Recorded purchase dates are too often wrong to
  // rule one out (the 1966 Mustang's says 2023-12-13; it was bought in 2022).
  const held = (v) => !when || !v.sale_date || new Date(v.sale_date) >= when;
  const named = vehicles.filter((v) => v.tokens.some((t) => hasWord(words, t)) && held(v));
  let vehicle = null;
  if (named.length === 1) vehicle = named[0];
  else if (named.length > 1) {
    const byYear = named.filter((v) => v.year && hasWord(words, String(v.year)));
    if (byYear.length === 1) vehicle = byYear[0];
    else unresolved.push(`receipt names ${named.length} of the author's vehicles: ${named.map((v) => `${v.year} ${v.model}`).join(', ')}`);
  }
  // One word on a receipt makes a candidate, not an allocation: placing the expense on a car waits for a
  // second, independent signal (the part in that car's photos, a work session on it). v1 records the candidate.
  a.q6_vehicle_candidate = vehicle ? { id: vehicle.id, name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, via: 'named on the receipt' } : null;
  if (vehicle) unresolved.push(`candidate ${vehicle.year} ${vehicle.model} needs a second signal (photos or a work session) before allocation`);

  // An organization owns the expense only when its own card or account paid.
  if (payer?.type === 'organization') return { answers: a, payer, expense_of: { type: 'organization', id: payer.id }, scope: { type: 'org', id: payer.id }, unresolved };
  const scope = { type: 'unknown', id: null };
  return { answers: a, payer: payer || { type: 'unknown' }, expense_of: { type: 'user', id: r.user_id }, scope, unresolved };
}

async function main() {
  const receipts = await loadReceipts();
  const userIds = new Set(receipts.map((r) => r.user_id).filter(Boolean));
  const facts = await loadFacts(userIds);
  const vehiclesByUser = new Map();
  for (const u of userIds) vehiclesByUser.set(u, await loadVehicles(u));
  console.log(`${RUN} — ${receipts.length} receipts, ${facts.cards.size} known cards, apply=${APPLY}`);

  const tally = { payer_known: 0, payer_unknown: 0, vehicle_candidates: 0, landed: 0, failed: 0 };
  for (const r of receipts) {
    const books = cardOf(r) ? null : await booksMatch(r);
    const d = decide(r, facts, vehiclesByUser.get(r.user_id) || [], books);
    d.payer.type === 'unknown' ? tally.payer_unknown++ : tally.payer_known++;
    if (d.answers.q6_vehicle_candidate) tally.vehicle_candidates++;
    const line = `${r.id.slice(0, 8)} ${String(r.transaction_date || '').slice(0, 10)} ${String(r.vendor_name || '?').slice(0, 20).padEnd(20)} ${String(r.total_amount ?? '').padStart(9)}  was ${r.scope_type}  payer=${d.payer.via || 'unknown'}  scope=${d.scope.type}${d.answers.q6_vehicle_candidate ? ` candidate=${d.answers.q6_vehicle_candidate.name}` : ''}${d.unresolved.length ? `  missing: ${d.unresolved.join('; ')}` : ''}`;
    console.log(line);
    if (!APPLY) continue;

    const reason = `${RUN} ${JSON.stringify({ answers: d.answers, payer: d.payer, expense_of: d.expense_of, unresolved: d.unresolved })}`;
    const { error: e1 } = await sb.rpc('correct_receipt_scope', { p_receipt_ids: [r.id], p_scope_type: d.scope.type, p_scope_id: d.scope.id, p_reason: reason, p_actor_user_id: r.user_id });
    if (e1) { tally.failed++; console.log(`   scope write failed: ${e1.message}`); continue; }
    const live = r.submitted_observation_id ? await liveObservation(r.submitted_observation_id) : null;
    if (live && d.scope.type === 'vehicle' && live.vehicle_id !== d.scope.id) {
      const { error } = await sb.rpc('reattribute_observation', { p_observation_type: 'observation', p_observation_id: live.id, p_target_vehicle_id: d.scope.id, p_reason: reason, p_actor_user_id: r.user_id });
      if (error) { tally.failed++; console.log(`   allocate failed: ${error.message}`); continue; }
    } else if (live && !live.vehicle_id && !(live.subject_type === (d.expense_of.type === 'organization' ? 'organization' : 'user') && live.subject_id === d.expense_of.id)) {
      const { error } = await sb.rpc('reassign_observation_subject', { p_observation_id: live.id, p_subject_type: d.expense_of.type === 'organization' ? 'organization' : 'user', p_subject_id: d.expense_of.id, p_reason: reason, p_actor_user_id: r.user_id });
      if (error) { tally.failed++; console.log(`   subject write failed: ${error.message}`); continue; }
    }
    tally.landed++;
  }
  console.log(JSON.stringify(tally));
}

main().catch((e) => { console.error(e); process.exit(1); });
