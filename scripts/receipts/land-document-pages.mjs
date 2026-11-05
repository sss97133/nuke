#!/usr/bin/env node
// Land transcribed document pages (receipts, invoices, work orders, slips photographed on the phone) on a vehicle
// through the sanctioned writer land_document_pages (migration 20261109110000). Nothing here writes a table.
//
//   dotenvx run -- node scripts/receipts/land-document-pages.mjs \
//     --extract <dir of <FRAME>.json transcriptions> --manifest <frame\tsha256\tbucket/path tsv> \
//     --originals <dir of <FRAME>.HEIC, for byte sizes> --owner <uuid> --vehicle <uuid> --run <text> \
//     [--context "<why these pages belong to this vehicle>"] [--dry] [--out <receipt json path>]
//
// Transcription schema: ~/nuke-logs/firebird-binder-20261102/extract_schema.md (one JSON per frame; continuation pages
// name their parent in continues_from; a web confirmation that repeats an invoice names it in duplicate_of). Pages that
// are not paper (photo prints, magazine pages, folder covers) are skipped and listed. Card numbers never appear in a
// transcription (brand only); the writer refuses the whole batch if one does.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]);
  return acc;
}, []));
for (const k of ['extract', 'manifest', 'originals', 'owner', 'vehicle', 'run']) if (!args[k] || args[k] === true) { console.error(`--${k} required`); process.exit(2); }
const DRY = args.dry === true;
const RECORD_TYPES = new Set(['invoice', 'work_order', 'packing_slip', 'receipt', 'alignment_report', 'order_confirmation', 'estimate', 'statement', 'other']);
const PAPER_TYPES = new Set(['invoice', 'work_order', 'packing_slip', 'receipt', 'alignment_report', 'order_confirmation', 'estimate', 'statement']);

const manifest = Object.fromEntries(readFileSync(args.manifest, 'utf8').trim().split('\n').map(l => {
  const [frame, sha256, bucketPath] = l.split('\t');
  return [frame, { sha256, storage_path: bucketPath.replace(/^user-documents\//, '') }];
}));
const extracts = Object.fromEntries(readdirSync(args.extract).filter(f => f.endsWith('.json')).map(f => {
  const j = JSON.parse(readFileSync(join(args.extract, f), 'utf8'));
  return [j.frame || f.replace('.json', ''), j];
}));
const byteSize = frame => {
  for (const ext of ['.HEIC', '.heic', '.jpg', '.jpeg', '.JPG']) {
    const p = join(args.originals, frame + ext);
    if (existsSync(p)) return String(statSync(p).size);
  }
  throw new Error(`no original for ${frame} under ${args.originals}`);
};
const money = v => (v == null || v === '' ? undefined : Number(v).toFixed(2));
const brandOnly = m => (m ? String(m).replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined : undefined);

// Group frames into documents: a parent page plus its continuation pages; a duplicate confirmation rides as a witness page.
const docs = new Map();
const skipped = [];
for (const frame of Object.keys(extracts).sort()) {
  const j = extracts[frame];
  if (!PAPER_TYPES.has(j.doc_type) && !(j.doc_type === 'other' && (j.lines || []).length)) { skipped.push([frame, j.doc_type]); continue; }
  const parent = j.continues_from && extracts[j.continues_from] ? j.continues_from : (j.duplicate_of && extracts[j.duplicate_of] ? j.duplicate_of : frame);
  if (!docs.has(parent)) docs.set(parent, []);
  docs.get(parent).push({ frame, role: frame === parent ? 'page' : (j.duplicate_of ? 'duplicate_confirmation' : 'continuation') });
}
const documents = [];
for (const [parent, frames] of docs) {
  const p = extracts[parent];
  if (!p) continue;
  const pages = frames.map((f, i) => ({ sha256: manifest[f.frame].sha256, storage_path: manifest[f.frame].storage_path, byte_size: byteSize(f.frame),
    page_no: String(i + 1), role: f.role, source_filename: `${f.frame}.heic` }));
  const contentPages = frames.filter(f => f.role !== 'duplicate_confirmation').map(f => extracts[f.frame]);
  const lines = contentPages.flatMap(pg => (pg.lines || []).map(l => {
    const o = { description: String(l.description || '').slice(0, 500) || 'line' };
    if (l.part_number) o.part_number = String(l.part_number).slice(0, 100);
    if (l.qty != null) o.quantity = money(l.qty);
    if (l.unit_price != null) o.unit_price = money(l.unit_price);
    if (l.ext_price != null) o.amount = money(l.ext_price);
    if (l.line_date) o.line_date = l.line_date;
    if (l.who) o.performer = String(l.who).slice(0, 80);
    if (l.hours != null) o.hours = money(l.hours);
    return o;
  }));
  const date = p.doc_date || (p.other_dates || []).map(d => d.date).find(Boolean) || null;
  const last = contentPages[contentPages.length - 1] || p;
  const d = {
    source_key: `${args.run}:${parent}`,
    doc_type: RECORD_TYPES.has(p.doc_type) ? p.doc_type : 'other',
    vendor: { name: String(p.vendor?.name || 'Unknown vendor').slice(0, 200), address: p.vendor?.address ? String(p.vendor.address).slice(0, 300) : null, phone: null },
    doc_number: p.doc_number ? String(p.doc_number).slice(0, 80) : null,
    doc_date: date,
    date_basis: p.doc_date ? 'printed_document_date' : (date ? 'other_printed_date' : 'none'),
    other_dates: p.other_dates || [],
    bill_to_name: p.bill_to_name ? String(p.bill_to_name).slice(0, 120) : null,
    vehicle_noted: p.vehicle_noted ? String(p.vehicle_noted).slice(0, 200) : null,
    pages, lines,
    subtotal: money(last.subtotal ?? p.subtotal), discount: money(last.discount ?? p.discount), shipping: money(last.shipping ?? p.shipping),
    tax: money(last.tax ?? p.tax), total: money(last.total ?? p.total),
    payment: { method: brandOnly(p.payment?.method), amount: money(p.payment?.amount), date: p.payment?.date || null },
    handwritten: (p.handwritten || []).map(h => String(h).slice(0, 300)),
    confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : undefined,
    notes: p.notes ? String(p.notes).slice(0, 1000) : null,
    vehicle_context: args.context && args.context !== true ? String(args.context).slice(0, 500) : null,
  };
  for (const k of Object.keys(d)) if (d[k] === undefined || d[k] === null) delete d[k];
  for (const k of Object.keys(d.payment)) if (d.payment[k] === undefined || d.payment[k] === null) delete d.payment[k];
  if (!Object.keys(d.payment).length) delete d.payment;
  documents.push(d);
}
const envelope = { storage_base: process.env.SUPABASE_URL, method: 'binder_document_transcription_v1', model: 'claude-opus-5-5', documents };
console.error(`${documents.length} documents from ${Object.keys(extracts).length} frames; skipped ${skipped.length} non-paper frames: ${skipped.map(s => s.join('=')).join(', ')}`);
if (DRY) { console.log(JSON.stringify({ dry: true, documents: documents.map(d => ({ source_key: d.source_key, doc_type: d.doc_type, vendor: d.vendor.name, date: d.doc_date, pages: d.pages.length, lines: d.lines.length, total: d.total })) }, null, 1)); process.exit(0); }
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (run under dotenvx)'); process.exit(2); }
const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/land_document_pages`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  body: JSON.stringify({ p_owner: args.owner, p_vehicle: args.vehicle, p_run: args.run, p_docs: envelope }),
});
const text = await res.text();
let out; try { out = JSON.parse(text); } catch { out = { status: res.status, body: text.slice(0, 2000) }; }
if (args.out && args.out !== true) writeFileSync(args.out, JSON.stringify(out, null, 1));
const summary = out && out.documents ? { status: res.status, landed: out.landed, duplicates: out.duplicates, errors: out.errors,
  links: out.documents.reduce((m, d) => { const k = d.error ? 'error' : `${d.link?.status || 'none'}:${d.link?.basis || d.link?.hold_reason || ''}`; m[k] = (m[k] || 0) + 1; return m; }, {}),
  kinds: out.documents.reduce((m, d) => { const k = d.document_kind || (d.error ? 'error' : '?'); m[k] = (m[k] || 0) + 1; return m; }, {}),
  errors_detail: out.documents.filter(d => d.error).map(d => `${d.source_key}: ${d.error}`) } : out;
console.log(JSON.stringify(summary, null, 1));
process.exit(res.ok ? 0 : 1);
