#!/usr/bin/env node
// Expense footprints: find spending that left a trace but no booked expense, for one book owner and one tax year.
//
// The database reader public.accounting_expense_footprints(owner, year, limit, external) does the matching. It reads
// the owner's receipts, photos (work episodes) and timeline costs itself. This script adds the traces that live only
// on the owner's machine, passes them to the reader as `external` (they are not stored), and writes the result locally:
//   --ebay-csv <file>   marketplace purchase history (columns date,total,order,title)
//   --mail              Apple Mail's Envelope Index: order confirmations and shipping notices (needs Full Disk Access)
//   --messages          Messages chat.db: outgoing texts that name a payment and an amount (needs Full Disk Access)
//   --traces <file>     a JSON array of traces already in the reader's shape
// No agent and no network beyond the one database read. Run yearly:
//   dotenvx run -- node scripts/books/expense-footprints.mjs --owner <uuid> --year 2024 --ebay-csv <file> --out <dir>
// --dry-run prints the collected traces and skips the database.
// Output: <out>/footprints-<year>.json (reader rows) and <out>/footprints-<year>.md (ranked list). Both are private:
// keep them outside the repository.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_EXTERNAL = 500;

// ---- trace adapters (pure: rows in, reader traces out) ----

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas and line breaks inside quotes. */
export function csvRecords(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const money = v => {
  const m = String(v ?? '').replace(/[$,\s]/g, '').match(/^\d{1,9}(?:\.\d{1,2})?$/);
  return m && Number(m[0]) > 0 ? Number(m[0]).toFixed(2) : null;
};
const isoDay = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

/** Marketplace purchase history rows (date,total,order,title) to order traces. */
export function ebayTraces(records, { year, exclude } = {}) {
  const out = [];
  for (const r of records) {
    const date = isoDay(r.date); const amount = money(r.total);
    if (!date || (year && !date.startsWith(String(year)))) continue;
    if (exclude && exclude.test(r.title || '')) continue;
    out.push({ kind: 'marketplace_order', ref: r.order || undefined, date, amount, vendor: 'eBay', what: (r.title || '').slice(0, 200), where: 'eBay purchase history' });
  }
  return out;
}

const ORDER_SUBJECT = /\b(order|purchase|receipt|invoice|payment received|thanks for your order)\b/i;
const SHIP_SUBJECT = /\b(shipped|on its way|out for delivery|delivered|shipping confirmation|tracking)\b/i;
const NOT_ORDER = /\b(newsletter|sale ends|% off|deal|webinar|unsubscribe|statement is ready|sign[- ]in|password|verify)\b/i;
const ORDER_NO = /(?:order|invoice|confirmation)\s*(?:#|no\.?|number)?\s*:?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,30})\b/i;
const TOTAL = /(?:order total|grand total|total charged|amount charged|amount paid|total)\s*:?\s*(?:USD)?\s*\$\s?([0-9][0-9,]*\.[0-9]{2})/i;

/** Mail envelope rows {id, received (unix s), sender, senderName, subject, summary} to order/shipping traces. */
export function mailTraces(rows, { year } = {}) {
  const out = [];
  for (const m of rows) {
    const subject = m.subject || ''; const text = `${subject}\n${m.summary || ''}`;
    const isOrder = ORDER_SUBJECT.test(subject); const isShip = SHIP_SUBJECT.test(subject);
    if ((!isOrder && !isShip) || NOT_ORDER.test(subject)) continue;
    const date = new Date(Number(m.received) * 1000).toISOString().slice(0, 10);
    if (year && !date.startsWith(String(year))) continue;
    const ref = (subject.match(ORDER_NO) || (m.summary || '').match(ORDER_NO) || [])[1];
    const amount = money((text.match(TOTAL) || [])[1]);
    if (!ref && !amount) continue;
    const domain = String(m.sender || '').split('@')[1] || '';
    out.push({ kind: isOrder && amount ? 'order' : 'shipping', ref: ref || `mail-${m.id}`, date, amount,
      vendor: (m.senderName || domain || 'mail').slice(0, 120), what: subject.slice(0, 200), where: `Mail message ${m.id}` });
  }
  return out;
}

const PAY_WORDS = /\b(paid|pay(?:ing)?|sent|send(?:ing)?|zelle|venmo|cash ?app|apple ?cash|deposit|labor|parts?)\b/i;
const AMOUNT = /\$\s?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,6})(?:\.([0-9]{2}))?\b/;

/** Outgoing text rows {id, secs (Apple seconds since 2001), text} to payment traces with an amount. */
export function messageTraces(rows, { year } = {}) {
  const out = [];
  for (const m of rows) {
    const text = String(m.text || '');
    if (!m.fromMe || !PAY_WORDS.test(text)) continue;
    const a = text.match(AMOUNT); if (!a) continue;
    const amount = money(`${a[1].replace(/,/g, '')}${a[2] ? '.' + a[2] : ''}`); if (!amount) continue;
    const date = new Date((Number(m.secs) + 978307200) * 1000).toISOString().slice(0, 10);
    if (year && !date.startsWith(String(year))) continue;
    out.push({ kind: 'payment_text', ref: `text-${m.id}`, date, amount, vendor: null, what: text.slice(0, 200), where: `Messages row ${m.id}` });
  }
  return out;
}

// ---- local stores (read-only) ----

async function sqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(file, { readOnly: true });
}

export async function readMailRows(file, year) {
  const db = await sqlite(file);
  const t0 = Date.UTC(year, 0, 1) / 1000; const t1 = Date.UTC(year + 1, 0, 1) / 1000;
  return db.prepare(`SELECT m.ROWID AS id, m.date_received AS received, ad.address AS sender, ad.comment AS senderName,
      s.subject AS subject, coalesce(su.summary, '') AS summary
    FROM messages m JOIN subjects s ON s.ROWID = m.subject LEFT JOIN addresses ad ON ad.ROWID = m.sender
    LEFT JOIN summaries su ON su.ROWID = m.summary
    WHERE m.deleted = 0 AND m.date_received >= ? AND m.date_received < ? ORDER BY m.date_received`).all(t0, t1);
}

/** Text of a message: the text column, else the string inside attributedBody (typedstream). */
export function messageText(text, body) {
  if (text) return text;
  if (!body) return '';
  const b = Buffer.from(body); const i = b.indexOf('NSString'); if (i < 0) return '';
  let j = b.indexOf(Buffer.from([0x01, 0x2b]), i); if (j < 0) return '';
  j += 2; let n = b[j]; j += 1;
  if (n === 0x81) { n = b.readUInt16LE(j); j += 2; } else if (n === 0x82) { n = b.readUIntLE(j, 3); j += 3; }
  return b.subarray(j, j + n).toString('utf8');
}

export async function readMessageRows(file, year) {
  const db = await sqlite(file);
  // Apple stores nanoseconds since 2001, beyond a JavaScript number: compare and return seconds.
  const secs = d => Date.UTC(d, 0, 1) / 1000 - 978307200;
  return db.prepare('SELECT ROWID AS id, date / 1000000000 AS secs, is_from_me AS fromMe, text, attributedBody AS body FROM message WHERE date / 1000000000 >= ? AND date / 1000000000 < ? ORDER BY date')
    .all(secs(year), secs(year + 1)).map(r => ({ id: r.id, secs: r.secs, fromMe: r.fromMe === 1, text: messageText(r.text, r.body) }));
}

// ---- the reader ----

/** One read-only call as the owner: claims set for the transaction, role authenticated, rolled back at the end. */
export function readerSql(owner, year, limit, external) {
  if (!UUID.test(owner)) throw new Error('owner must be a uuid');
  if (!Number.isInteger(year)) throw new Error('year must be an integer');
  const ext = JSON.stringify(external);
  if (ext.includes('$ext$')) throw new Error('external traces contain the quoting marker');
  const claims = JSON.stringify({ sub: owner, role: 'authenticated' });
  return ['BEGIN TRANSACTION READ ONLY;', "SET LOCAL statement_timeout = '60s';",
    `SELECT set_config('request.jwt.claims', '${claims}', true), set_config('request.jwt.claim.sub', '${owner}', true), set_config('request.jwt.claim.role', 'authenticated', true) \\g /dev/null`,
    'SET LOCAL ROLE authenticated;',
    `SELECT row_to_json(f) FROM public.accounting_expense_footprints('${owner}'::uuid, ${year}, ${limit}, $ext$${ext}$ext$::jsonb) f;`,
    'ROLLBACK;', ''].join('\n');
}

function runReader(sql) {
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (!pw) throw new Error('SUPABASE_DB_PASSWORD is not set: run under dotenvx run --');
  const host = process.env.FOOTPRINTS_DB_HOST || 'aws-0-us-west-1.pooler.supabase.com';
  const user = process.env.FOOTPRINTS_DB_USER || 'postgres.qkgaybvrernstplzjaam';
  const r = spawnSync('psql', ['-h', host, '-p', '6543', '-U', user, '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: sql, env: { ...process.env, PGPASSWORD: pw }, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`reader failed: ${(r.stderr || '').trim().slice(0, 500)}`);
  return r.stdout.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
}

// ---- report ----

const usd = v => (v == null ? 'unknown' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function markdown(rows, { year }) {
  const summary = rows.find(r => r.trace_kind === 'summary');
  const gaps = rows.filter(r => r.trace_kind !== 'summary');
  const s = summary?.reasons || {};
  const lines = [`# Expense footprints ${year}`, '',
    `Gaps: ${s.gaps ?? 0} uncited traces of ${s.traces ?? 0}. Printed amounts ${usd(s.gap_amount_document)}, claims ${usd(s.gap_amount_claim)}, ` +
    `work estimated ${usd(s.gap_amount_estimated_p25)} (p25; median ${usd(s.gap_amount_estimated_median)}), ${s.gaps_amount_unknown ?? 0} with no amount. ` +
    `Reclassification candidates: ${s.reclassification_candidates ?? 0} (${usd(s.reclassification_amount)}). Near matches treated as booked: ${s.near_matches ?? 0}.`, '',
    '| # | Status | Kind | Date | Vendor | Amount | Basis | Confidence | Score | Trace | Look for |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  gaps.forEach((g, i) => {
    const cell = v => String(v ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
    lines.push(`| ${i + 1} | ${g.status} | ${g.trace_kind} | ${g.trace_date}${g.window_end ? ' to ' + g.window_end : ''} | ${cell(g.vendor)} | ${usd(g.amount)} | ${g.amount_basis} | ${g.confidence} | ${g.score ?? ''} | ${cell(g.trace_key)} | ${cell(g.look_for)} |`);
  });
  return lines.join('\n') + '\n';
}

// ---- CLI ----

function args(argv) {
  const a = { limit: 200, exclude: '\\(personal' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = () => argv[++i];
    if (k === '--owner') a.owner = v(); else if (k === '--year') a.year = Number(v()); else if (k === '--out') a.out = v();
    else if (k === '--limit') a.limit = Number(v()); else if (k === '--ebay-csv') a.ebay = v(); else if (k === '--traces') a.traces = v();
    else if (k === '--mail') a.mail = true; else if (k === '--messages') a.messages = true; else if (k === '--exclude') a.exclude = v();
    else if (k === '--dry-run') a.dry = true; else throw new Error(`unknown argument ${k}`);
  }
  if (!a.owner || !UUID.test(a.owner)) throw new Error('--owner <uuid> is required');
  if (!Number.isInteger(a.year)) throw new Error('--year is required');
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  const external = [];
  if (a.ebay) external.push(...ebayTraces(csvRecords(fs.readFileSync(a.ebay, 'utf8')), { year: a.year, exclude: a.exclude ? new RegExp(a.exclude, 'i') : null }));
  if (a.mail) external.push(...mailTraces(await readMailRows(path.join(os.homedir(), 'Library/Mail/V10/MailData/Envelope Index'), a.year), { year: a.year }));
  if (a.messages) external.push(...messageTraces(await readMessageRows(path.join(os.homedir(), 'Library/Messages/chat.db'), a.year), { year: a.year }));
  if (a.traces) external.push(...JSON.parse(fs.readFileSync(a.traces, 'utf8')));
  if (external.length > MAX_EXTERNAL) throw new Error(`${external.length} external traces; the reader takes at most ${MAX_EXTERNAL} per call. Narrow the sources.`);
  console.error(`collected ${external.length} external traces for ${a.year}`);
  if (a.dry) { console.log(JSON.stringify(external, null, 1)); return; }
  const rows = runReader(readerSql(a.owner, a.year, a.limit, external));
  if (!rows.length) throw new Error('no rows: the reader returns nothing unless the caller is the book owner');
  const out = a.out || '.';
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `footprints-${a.year}.json`), JSON.stringify({ year: a.year, external_supplied: external.length, rows }, null, 1));
  fs.writeFileSync(path.join(out, `footprints-${a.year}.md`), markdown(rows, { year: a.year }));
  const s = rows.find(r => r.trace_kind === 'summary')?.reasons || {};
  console.error(`${a.year}: ${s.gaps} gaps of ${s.traces} traces; written to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
