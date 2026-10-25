// Contract for scripts/books/expense-footprints.mjs: trace adapters, the reader call and the report. Synthetic rows only,
// no network, no env.   node --test scripts/books/expense-footprints.test.mjs   (run by scripts/ci/verify.sh)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { csvRecords, ebayTraces, mailTraces, markdown, messageText, messageTraces, readMailRows, readMessageRows, readerSql } from './expense-footprints.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';

test('marketplace history: year filter, money, exclusions, quoted titles', () => {
  const csv = 'date,total,order,title\n2024-03-02,"1,204.50",01-11111-22222,"Bumper, chrome ""rear"""\n' +
    '2024-04-01,12.00,01-11111-33333,Card (personal collectible)\n2025-01-02,5.00,01-1-1,Next year\n2024-05-01,abc,01-1-2,Bad total\n';
  const t = ebayTraces(csvRecords(csv), { year: 2024, exclude: /\(personal/i });
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { kind: 'marketplace_order', ref: '01-11111-22222', date: '2024-03-02', amount: '1204.50', vendor: 'eBay', what: 'Bumper, chrome "rear"', where: 'eBay purchase history' });
  assert.equal(t[1].amount, null, 'an unreadable total stays unknown, never guessed');
});

test('mail: order confirmations with totals, shipping notices, marketing and statements skipped', () => {
  const day = s => Date.UTC(2024, 5, s) / 1000;
  const rows = [
    { id: 1, received: day(1), sender: 'orders@parts.example', senderName: 'Parts Example', subject: 'Your order #PX-77821 has been received', summary: 'Order total: $86.40 Thanks!' },
    { id: 2, received: day(2), sender: 'ship@parts.example', senderName: '', subject: 'Your package has shipped', summary: 'Order number: PX-77821 tracking 1Z...' },
    { id: 3, received: day(3), sender: 'deals@parts.example', senderName: 'Parts Example', subject: 'Order now: 20% off sale ends', summary: 'Total $10.00' },
    { id: 4, received: day(4), sender: 'bank@example', senderName: 'Bank', subject: 'Your receipt statement is ready', summary: '' },
    { id: 5, received: day(5), sender: 'friend@example', senderName: 'Friend', subject: 'lunch?', summary: '$20' },
    { id: 6, received: Date.UTC(2023, 11, 31) / 1000, sender: 'o@x.example', senderName: 'X', subject: 'Order confirmation #AB12345', summary: 'Total: $5.00' },
  ];
  const t = mailTraces(rows, { year: 2024 });
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { kind: 'order', ref: 'PX-77821', date: '2024-06-01', amount: '86.40', vendor: 'Parts Example', what: 'Your order #PX-77821 has been received', where: 'Mail message 1' });
  assert.equal(t[1].kind, 'shipping'); assert.equal(t[1].ref, 'PX-77821'); assert.equal(t[1].amount, null); assert.equal(t[1].vendor, 'parts.example');
});

test('texts: outgoing payment texts with an amount only', () => {
  const secs = (y, m, d) => Date.UTC(y, m, d) / 1000 - 978307200;
  const rows = [
    { id: 10, secs: secs(2024, 7, 1), fromMe: true, text: 'Sent you $1,000 for the paint labor' },
    { id: 11, secs: secs(2024, 7, 2), fromMe: false, text: 'I paid $50' },
    { id: 12, secs: secs(2024, 7, 3), fromMe: true, text: 'see you at 5' },
    { id: 13, secs: secs(2024, 7, 4), fromMe: true, text: 'paid for parts, $36.25 at the counter' },
    { id: 14, secs: secs(2024, 7, 5), fromMe: true, text: 'zelle me later' },
  ];
  const t = messageTraces(rows, { year: 2024 });
  assert.deepEqual(t.map(x => [x.ref, x.amount, x.date]), [['text-10', '1000.00', '2024-08-01'], ['text-13', '36.25', '2024-08-04']]);
});

test('attributedBody text decoding', () => {
  const s = 'paid $40';
  const body = Buffer.concat([Buffer.from('streamtyped NSString'), Buffer.from([0x01, 0x2b, s.length]), Buffer.from(s), Buffer.from([0x86])]);
  assert.equal(messageText(null, body), s);
  assert.equal(messageText('plain', body), 'plain');
  assert.equal(messageText(null, null), '');
});

test('reader call is read-only, owner-scoped and quoted safely', () => {
  const sql = readerSql(OWNER, 2024, 50, [{ kind: 'order', ref: "a'b", date: '2024-01-01', amount: '1.00' }]);
  assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/);
  assert.match(sql, /SET LOCAL ROLE authenticated;/);
  assert.match(sql, /ROLLBACK;\n$/);
  assert.match(sql, /accounting_expense_footprints\('11111111-1111-4111-8111-111111111111'::uuid, 2024, 50, \$ext\$\[\{"kind":"order","ref":"a'b"/);
  assert.throws(() => readerSql('not-a-uuid', 2024, 50, []));
  assert.throws(() => readerSql(OWNER, 2024, 50, [{ what: 'x$ext$y' }]));
});

test('report keeps printed and estimated dollars apart and lists gaps in rank order', () => {
  const rows = [
    { trace_kind: 'receipt', trace_key: 'receipt:r1', trace_date: '2024-06-01', vendor: 'Speed | Shop', amount: 140, amount_basis: 'document', confidence: 0.95, score: 133, status: 'uncited', look_for: 'Book it' },
    { trace_kind: 'work_episode', trace_key: 'episode:v:2024-09-01', trace_date: '2024-09-01', window_end: '2024-09-05', amount: 200, amount_basis: 'own_history_p25', confidence: 0.65, score: 130, status: 'uncited', look_for: 'Look' },
    { trace_kind: 'summary', reasons: { gaps: 2, traces: 9, gap_amount_document: 140, gap_amount_claim: null, gap_amount_estimated_p25: 200, gap_amount_estimated_median: 300, gaps_amount_unknown: 0, reclassification_candidates: 1, reclassification_amount: 61.25, near_matches: 1 } },
  ];
  const md = markdown(rows, { year: 2024 });
  assert.match(md, /Printed amounts \$140\.00, claims unknown, work estimated \$200\.00 \(p25; median \$300\.00\)/);
  assert.match(md, /\| 1 \| uncited \| receipt \| 2024-06-01 \| Speed \/ Shop \| \$140\.00 \| document/);
  assert.match(md, /\| 2 \| uncited \| work_episode \| 2024-09-01 to 2024-09-05 /);
});

test('local stores are read through their own schemas (skipped where node:sqlite is unavailable)', async t => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footprints-'));
  const mail = new DatabaseSync(path.join(dir, 'Envelope Index'));
  mail.exec(`CREATE TABLE messages(ROWID INTEGER PRIMARY KEY, date_received INTEGER, deleted INTEGER, subject INTEGER, sender INTEGER, summary INTEGER);
    CREATE TABLE subjects(ROWID INTEGER PRIMARY KEY, subject TEXT); CREATE TABLE addresses(ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT);
    CREATE TABLE summaries(ROWID INTEGER PRIMARY KEY, summary TEXT);
    INSERT INTO subjects VALUES (1, 'Your order #PX-10021 is confirmed'); INSERT INTO addresses VALUES (1, 'o@p.example', 'P');
    INSERT INTO summaries VALUES (1, 'Order total: $9.99');
    INSERT INTO messages VALUES (7, ${Date.UTC(2024, 1, 1) / 1000}, 0, 1, 1, 1), (8, ${Date.UTC(2024, 1, 2) / 1000}, 1, 1, 1, 1);`);
  mail.close();
  const m = await readMailRows(path.join(dir, 'Envelope Index'), 2024);
  assert.deepEqual(mailTraces(m, { year: 2024 }).map(x => [x.ref, x.amount, x.where]), [['PX-10021', '9.99', 'Mail message 7']]);
  const chat = new DatabaseSync(path.join(dir, 'chat.db'));
  chat.exec('CREATE TABLE message(ROWID INTEGER PRIMARY KEY, date INTEGER, is_from_me INTEGER, text TEXT, attributedBody BLOB);');
  chat.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(3, BigInt(Date.UTC(2024, 2, 1) / 1000 - 978307200) * 1000000000n, 1, 'paid $75 for labor', null);
  chat.close();
  const r = await readMessageRows(path.join(dir, 'chat.db'), 2024);
  assert.deepEqual(messageTraces(r, { year: 2024 }).map(x => [x.ref, x.amount]), [['text-3', '75.00']]);
});
