// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ results: {} as Record<string, any>, calls: [] as any[], downloads: [] as string[], authChanged: null as null | (() => void), listeners: new Set<() => void>() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: async (name: string) => ({ data: name === 'accounting_recent_activity' ? fixture.results.activity || [] : name === 'accounting_similar_classifications' ? fixture.results.similar || [] : fixture.results.grants || [], error: null }), functions: { invoke: async (_name: string, { body }: any) => { fixture.calls.push({ action: body.action }); return { data: { data: fixture.results[body.action] || { lines: [] } }, error: null }; } }, channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, storage: { from(bucket: string) { return { async download(path: string) { fixture.downloads.push(`${bucket}/${path}`); return { data: null, error: new Error('not available') }; } }; } }, auth: { getUser: async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } }, error: null }), onAuthStateChange(callback: () => void) { fixture.listeners.add(callback); fixture.authChanged = () => { for (const listener of [...fixture.listeners]) listener(); }; return { data: { subscription: { unsubscribe() { fixture.listeners.delete(callback); } } } }; } }, from(table: string) {
  const call: any = { table }; fixture.calls.push(call);
  const q: any = {
    select(fields: string) { call.fields = fields; return q; },
    eq(field: string, value: unknown) { call.filter = [field, value]; return q; },
    order() { return q; }, limit() { return q; }, in() { return q; }, single() { return q; }, is() { return q; }, or() { return q; },
    range(a: number, b: number) { call.range = [a, b]; return q; },
    // The records table reads the current records view; serve the tax_read fixture's records through it.
    then(resolve: any, reject: any) { return Promise.resolve(fixture.results[table] || (table === 'v_financial_accounting_records' && fixture.results.tax_read ? { data: fixture.results.tax_read.records, count: fixture.results.tax_read.records.length, error: null } : { data: [], count: 0, error: null })).then(resolve, reject); },
  }; return q;
} } }));
import FinanceDashboard, { invoicePageTotals, concernRevision, reviewedSource, verifySourceRaster, type FinancialDocumentRow } from './FinanceDashboard';
import { webcrypto } from 'node:crypto';
let container: HTMLDivElement; let root: Root;
const invoice = (extra: Partial<FinancialDocumentRow> = {}): FinancialDocumentRow => ({
  id: 'doc-1', duplicate_of: null, doc_type: 'facture', document_number: 'synthetic', document_date: '2026-01-01',
  issuer_name_raw: 'Synthetic merchant', recipient_name_raw: 'Synthetic customer', amount_ttc: 100, currency: 'USD',
  deal_number: null, review_status: 'needs_review', ...extra,
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.calls = []; fixture.results = {}; fixture.downloads = []; fixture.listeners.clear();
  // Node's own experimental localStorage global shadows jsdom's and is undefined here; give the page a plain one.
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, String(value)); }, removeItem: (key: string) => { stored.delete(key); }, clear: () => stored.clear() } });
  window.history.replaceState(null, '', '/accounting');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('excludes duplicates, credit notes and unknown monetary inputs from displayed invoice subtotals', () => {
  expect(invoicePageTotals([invoice(), invoice({ duplicate_of: 'doc-1' }), invoice({ doc_type: 'avoir' }),
    invoice({ amount_ttc: null }), invoice({ currency: null }), invoice({ amount_ttc: 50, currency: 'EUR' })]))
    .toEqual([['USD', 100], ['EUR', 50]]);
});
it('keeps reader failures distinct from no records or access', async () => {
  fixture.results.financial_documents = { error: { message: 'unavailable' }, data: null, count: null };
  await act(async () => root.render(<FinanceDashboard />));
  expect(container.textContent).toContain('invoice totals are unknown');
  expect(container.textContent).not.toContain('No source documents are visible');
});
it('reads pending concerns independently of vehicle/deal allocation and opens retained interpretations', async () => {
  fixture.results.financial_review_queue = { data: [{ id: 'concern-1', document_id: 'doc-1', concern_type: 'cut_off', priority: 'high', status: 'pending', detail: 'Date requires corroboration' }], count: 201 };
  fixture.results.financial_document_extractions = { data: [{ id: 'revision-1', field_key: 'amount_ttc', value_normalized: 100, extractor: 'synthetic', is_superseded: true, superseded_by: 'revision-2' }], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Review questions')!.click());
  expect(container.textContent).toContain('1 of 201 pending concern records across revision history');
  const queueCall = fixture.calls.find(c => c.table === 'financial_review_queue');
  expect(queueCall.filter).toEqual(['status', 'pending']);
  expect(queueCall.range).toEqual([0, 199]);
  if (!Array.from(container.querySelectorAll('button')).some(b => b.textContent === 'View evidence')) await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Source documents')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  expect(container.textContent).toContain('Superseded interpretation');
  expect(container.textContent).toContain('Interpretations are not posted expenses');
  const evidenceCall = fixture.calls.find(c => c.table === 'financial_document_extractions');
  expect(evidenceCall.filter).toEqual(['owner_id', '11111111-1111-4111-8111-111111111111']);
  expect(evidenceCall.fields).not.toContain('value_raw');
  expect(evidenceCall.range).toEqual([0, 199]);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next page')!.click());
  expect(fixture.calls.filter(c => c.table === 'financial_review_queue').at(-1).range).toEqual([200, 399]);
});
it('does not render mixed-currency rollups as a single monetary total', async () => {
  fixture.results.v_financial_deal_flow = { data: [{ deal_number: 'synthetic', mixed_currency: true, invoiced_total: 999, credited_total: 99 }], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Deals')!.click());
  expect(fixture.calls.find(c => c.table === 'v_financial_deal_flow').filter).toEqual(['owner_id', '11111111-1111-4111-8111-111111111111']);
  expect(container.textContent).toContain('MIXED CURRENCIES');
  expect(container.textContent).not.toContain('999.00');
});

it('clears private data and evidence selection on session changes', async () => {
  fixture.results.financial_documents = { data: [invoice()], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Source documents')!.click());
  expect(container.textContent).toContain('Synthetic merchant');
  fixture.results = {};
  await act(async () => fixture.authChanged!());
  expect(container.textContent).not.toContain('Synthetic merchant');
  expect(container.textContent).toContain('No source documents are visible');
});
it('paginates evidence revisions beyond the first page', async () => {
  fixture.results.financial_documents = { data: [invoice()], count: 1 };
  fixture.results.financial_document_extractions = { data: [], count: 250 };
  await act(async () => root.render(<FinanceDashboard />));
  if (!Array.from(container.querySelectorAll('button')).some(b => b.textContent === 'View evidence')) await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Source documents')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Older evidence')!.click());
  expect(fixture.calls.filter(c => c.table === 'financial_document_extractions').at(-1).range).toEqual([200, 399]);
});

it('retires superseded interpretation questions from the active queue without resolving or deleting them', async () => {
  const lineage = { attributes: { runs: [{ run_id: 'old-run' }, { run_id: 'new-run', supersedes_run_id: 'old-run' }] } };
  const old = { id: 'old-concern', document_id: 'doc-1', concern_type: 'cut_off', priority: 'high', status: 'pending', detail: 'Old date question', confidence_factors: { extraction_run_id: 'old-run' }, document: lineage };
  const current = { ...old, id: 'new-concern', detail: 'Current payment question', confidence_factors: { extraction_run_id: 'new-run' } };
  const unknown = { ...current, id: 'unknown-concern', detail: 'Missing lineage question', document: null };
  expect(concernRevision(old)).toBe('superseded');
  expect(concernRevision(current)).toBe('current');
  expect(concernRevision(unknown)).toBe('unknown');
  fixture.results.financial_review_queue = { data: [old, current, unknown], count: 3 };
  await act(async () => root.render(<FinanceDashboard />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Review questions')!.click());
  const activeTable = container.querySelector('section[aria-label="Pending accounting concerns"] table')!;
  expect(activeTable.textContent).not.toContain('Old date question');
  expect(activeTable.textContent).toContain('Current payment question');
  expect(activeTable.textContent).toContain('Missing lineage question');
  expect(activeTable.textContent).toContain('Revision lineage unavailable');
  const history = Array.from(container.querySelectorAll('details')).find(d => d.querySelector('summary')?.textContent?.startsWith('Concerns from superseded'))!;
  expect(history.textContent).toContain('Old date question');
  expect(history.textContent).toContain('retain their pending status');
  expect(old.status).toBe('pending');
});

const derivative = () => ({ contract: 'financial_redacted_source_v1', source_sha256: 'a'.repeat(64), derivative_sha256: 'b'.repeat(64),
  bucket: 'user-documents', storage_path: `owner/redacted/${'a'.repeat(64)}/${'b'.repeat(64)}.png`, mime_type: 'image/png',
  width: 1, height: 1, policy_version: 'financial-private-v1', verification: { pixel_masks: true, metadata_removed: true,
    embedded_text_removed: true, visual_reviewed: true, reviewer: 'Synthetic reviewer', reviewed_at: '2026-01-01T00:00:00Z' } });
it('requires private owner/source/hash binding and attributed visual review before source display', () => {
  const v = derivative();
  expect(reviewedSource(v, 'owner', v.source_sha256)).toEqual(v);
  expect(reviewedSource({ value: v, method: 'synthetic', evidence: { source: 'synthetic' } }, 'owner', v.source_sha256)).toEqual(v);
  expect(reviewedSource(v, 'other-owner', v.source_sha256)).toBeNull();
  expect(reviewedSource(v, 'owner', 'c'.repeat(64))).toBeNull();
  expect(reviewedSource({ ...v, storage_path: 'https://example.test/original.png' }, 'owner', v.source_sha256)).toBeNull();
  expect(reviewedSource({ ...v, verification: { ...v.verification, visual_reviewed: false } }, 'owner', v.source_sha256)).toBeNull();
});
it('rejects tampered or metadata-bearing derivatives even when a review claim is present', async () => {
  vi.stubGlobal('crypto', webcrypto);
  // Synthetic RGB PNG. Parser checks dimensions/chunks before the browser decodes it.
  const chunk = (type: string, data: number[]) => [...[0, 0, 0, data.length], ...Array.from(type).map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const png = (extra: number[] = []) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), ...extra, ...chunk('IDAT', [1]), ...chunk('IEND', [])]).buffer;
  const bytes = png();
  const hash = async (b: ArrayBuffer) => Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', b))).map(n => n.toString(16).padStart(2, '0')).join('');
  const source = { ...derivative(), derivative_sha256: await hash(bytes) };
  await expect(verifySourceRaster(bytes, source)).resolves.toBeUndefined();
  await expect(verifySourceRaster(bytes, derivative())).rejects.toThrow('hash mismatch');
  const metadata = png(chunk('tEXt', [65, 0, 66]));
  await expect(verifySourceRaster(metadata, { ...source, derivative_sha256: await hash(metadata) })).rejects.toThrow('metadata');
  vi.unstubAllGlobals();
});
it('withholds unreviewed and superseded sources and never falls back to original storage', async () => {
  fixture.results.financial_documents = { data: [invoice()], count: 1 };
  const v = derivative();
  fixture.results.financial_document_extractions = { data: [
    { id: 'source-pending', field_key: 'redacted_source', value_normalized: { ...v, verification: { ...v.verification, visual_reviewed: false } }, document: { owner_id: 'owner', content_sha256: v.source_sha256 } },
    { id: 'source-retired', field_key: 'redacted_source', value_normalized: v, is_superseded: true, document: { owner_id: 'owner', content_sha256: v.source_sha256 } },
  ], count: 2 };
  await act(async () => root.render(<FinanceDashboard />));
  if (!Array.from(container.querySelectorAll('button')).some(b => b.textContent === 'View evidence')) await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Source documents')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  expect(container.textContent).toContain('awaits a hash-linked redaction review');
  expect(container.textContent).toContain('Superseded interpretation');
  expect(fixture.downloads).toEqual([]);
  expect(container.querySelector('img')).toBeNull();
});
it('requests only the bound private derivative and exposes download failures', async () => {
  fixture.results.financial_documents = { data: [invoice()], count: 1 };
  const v = derivative();
  fixture.results.financial_document_extractions = { data: [
    { id: 'source-reviewed', field_key: 'redacted_source', value_normalized: v, document: { owner_id: 'owner', content_sha256: v.source_sha256 } },
  ], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  if (!Array.from(container.querySelectorAll('button')).some(b => b.textContent === 'View evidence')) await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Source documents')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  expect(fixture.downloads).toEqual([`user-documents/${v.storage_path}`]);
  expect(container.textContent).toContain('could not be verified or loaded');
  expect(container.querySelector('img')).toBeNull();
});

it('names retained source files and keeps recovery mounted inside a closed advanced panel', async () => {
  fixture.results.financial_documents = { data: [invoice({ source_filename: 'example-bank-export.csv', doc_type: null, document_number: null })], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Source documents')!.click());
  expect(container.textContent).toContain('example-bank-export.csv');
  expect(fixture.calls.find(c => c.table === 'financial_documents' && c.range).fields).toContain('source_filename');
  const advanced = container.querySelector('.accounting-advanced') as HTMLDetailsElement;
  expect(advanced.open).toBe(false);
  expect(advanced.querySelector('input[type="file"]')).not.toBeNull();
  expect(container.textContent).toContain('Tax review is a separate step');
});

it('opens readable evidence with source quote, closed technical detail, and restores focus on Escape', async () => {
  fixture.results.financial_documents = { data: [invoice()], count: 1 };
  fixture.results.financial_document_extractions = { data: [{ id:'readable',field_key:'retained_workpaper_classification_one',value_normalized:{value:{classification:{section:'Owner',category:'Personal subscription',decision:'Retained prior classification'}},evidence:{quote:'Original workbook says personal',source_sheet:'Transactions',source_row:12}},extractor:'retained_source',document:{source_filename:'bookkeeping.csv'} }],count:1 };
  await act(async () => root.render(<FinanceDashboard/>));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Source documents')!.click());
  const trigger = Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='View evidence')!;
  trigger.focus();
  await act(async () => trigger.click());
  const dialog = container.querySelector('dialog')!;
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(dialog.textContent).toContain('Personal subscription');
  expect(dialog.querySelector('blockquote')?.textContent).toBe('Original workbook says personal');
  expect(dialog.textContent).toContain('Transactions · 12');
  expect(dialog.querySelectorAll('details[open]')).toHaveLength(0);
  expect(dialog.querySelector('canvas')).toBeNull();
  await act(async () => dialog.dispatchEvent(new Event('cancel',{bubbles:false,cancelable:true})));
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('keeps the chosen bookkeeping record distinct from its batch and defers payment context until requested', async () => {
  fixture.results.tax_read = { records: [{ id:'bank-row',document_id:'batch-doc',record:{record_kind:'retained_bank_movement',local_id:'bank-one',source_key:'selected-key',year:'2025',date:'2025-02-20',account:'Checking',section:'Owner',category:'Personal subscription',amount:'-13.99',currency:'USD',description:'Chosen synthetic subscription',decision:'Owner-confirmed personal purpose'} }], total_rows:1,next_after:null,controls_valid:true,controls:[] };
  fixture.results.financial_document_extractions = {data:[{id:'selected-field',field_key:'classification',value_normalized:{value:{source_key:'selected-key',classification:{category:'Personal subscription'}}},document:{source_filename:'batch.csv'}},{id:'other-field',field_key:'other_record',value_normalized:{value:{source_key:'other-key',description:'UNRELATED BATCH RECORD'}}}],count:2};
  await act(async () => root.render(<FinanceDashboard/>));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Records')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='View evidence')!.click());
  const dialog = container.querySelector('dialog')!;
  expect(dialog.querySelector('[aria-label="Selected accounting record"]')?.textContent).toContain('Chosen synthetic subscription');
  expect(dialog.textContent).not.toContain('UNRELATED BATCH RECORD');
  expect(fixture.calls.filter(c=>c.action && c.action!=='tax_read')).toHaveLength(0);
  const items = Array.from(dialog.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Source items and payment comparison')!;
  await act(async () => { items.open=true; items.dispatchEvent(new Event('toggle')); });
  expect(fixture.calls.some(c=>c.action==='read')).toBe(true);
});

it('keeps exact UUID-bearing bank evidence behind source details and labels owner decisions plainly', async () => {
  const original = 'PayPal | Synthetic subscription | 12345678-1234-1234-1234-123456789abc, 87654321-4321-4321-4321-cba987654321';
  fixture.results.tax_read = { records:[{id:'bank',document_id:'doc',record:{record_kind:'retained_bank_movement',local_id:'bank',year:'2025',date:'2025-02-20',account:'PayPal',section:'Owner',category:'Personal',amount:'-14',currency:'USD',description:original}}],total_rows:1,next_after:null,controls_valid:true,controls:[] };
  fixture.results.financial_review_queue = {data:[{id:'concern',document_id:'doc',concern_type:'montant_non_corrobore',status:'pending',detail:'Retained amount requires source review'}],count:1};
  fixture.results.financial_document_extractions = {data:[{id:'technical-first',field_key:'retained_relationships',value_normalized:{evidence:{quote:'Owner attributed statement'}}},{id:'owner',field_key:'owner_personal_purpose_resolution_20261022',value_normalized:{value:'Personal purpose',evidence:{quote:'Owner attributed statement'}},document:{source_filename:'book.csv'}},{id:'batch',field_key:'retained_accounting_batch',value_normalized:{value:{source_kind:'derived_retained_snapshot',record_count:25}}}],count:2};
  await act(async () => root.render(<FinanceDashboard/>));
  expect(container.textContent).toContain('Amount needs corroboration');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Records')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='View evidence')!.click());
  const dialog=container.querySelector('dialog')!;
  expect(dialog.querySelector('.accounting-selected-record h3')?.textContent).toBe('PayPal · Synthetic subscription');
  const source=Array.from(dialog.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Original source description')!;
  expect(source.open).toBe(false); expect(source.querySelector('p')?.textContent).toBe(original);
  expect(Array.from(dialog.querySelectorAll('.accounting-evidence-field h4')).map(h=>h.textContent)).toEqual(['Owner decision']);
  expect(dialog.querySelector('blockquote')?.textContent).toBe('Owner attributed statement');
  const technical=Array.from(dialog.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Technical source references')!;
  expect(technical.open).toBe(false); expect(technical.textContent).toContain('derived_retained_snapshot');
  expect(dialog.textContent).toContain('Field reference: owner_personal_purpose_resolution_20261022');
});

it('switches shared book reads without unmounting the owner recovery queue', async () => {
  fixture.results.grants = [{ id: 'grant', owner_id: '22222222-2222-4222-8222-222222222222', member_id: '11111111-1111-4111-8111-111111111111', active: true, can_correct: true, owner_name: 'Shared owner' }];
  await act(async () => root.render(<FinanceDashboard />));
  const recovery = container.querySelector('input[type="file"][multiple]');
  expect(recovery).not.toBeNull();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Active accounting book"] button')).find(b => b.textContent?.startsWith('Shared owner'))!.click());
  expect(container.querySelector('[aria-label="Active accounting book"] button[aria-pressed="true"]')?.textContent).toBe('Shared owner · shared books (review and correct)');
  expect(container.querySelector('input[type="file"][multiple]')).toBe(recovery);
  expect(recovery?.closest('[hidden]')).not.toBeNull();
  expect(container.textContent).toContain('Deal rollups are not included');
  expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent === 'Deals')).toBe(false);
  expect(fixture.calls.filter(c => c.table === 'financial_documents').at(-1).filter).toEqual(['owner_id', '22222222-2222-4222-8222-222222222222']);
  expect(window.localStorage.getItem('accounting.book')).toBe('22222222-2222-4222-8222-222222222222');
  expect(new URL(window.location.href).searchParams.get('book')).toBe('22222222-2222-4222-8222-222222222222');
});
it('opens on the remembered book when a grant covers it, and never loads one it cannot read', async () => {
  fixture.results.grants = [{ id: 'grant', owner_id: '22222222-2222-4222-8222-222222222222', member_id: '11111111-1111-4111-8111-111111111111', active: true, can_correct: true, owner_name: 'Shared owner' }];
  window.localStorage.setItem('accounting.book', '22222222-2222-4222-8222-222222222222');
  await act(async () => root.render(<FinanceDashboard />));
  expect(container.querySelector('[aria-label="Active accounting book"] button[aria-pressed="true"]')?.textContent).toContain('Shared owner');
  expect(new Set(fixture.calls.filter(c => c.table === 'financial_documents').map(c => c.filter[1]))).toEqual(new Set(['22222222-2222-4222-8222-222222222222']));
  await act(async () => root.unmount()); fixture.calls = [];
  window.history.replaceState(null, '', '/accounting?book=33333333-3333-4333-8333-333333333333');
  root = createRoot(container);
  await act(async () => root.render(<FinanceDashboard />));
  expect(container.querySelector('[aria-label="Active accounting book"] button[aria-pressed="true"]')?.textContent).toBe('My books');
  expect(new Set(fixture.calls.filter(c => c.table === 'financial_documents').map(c => c.filter[1]))).toEqual(new Set(['11111111-1111-4111-8111-111111111111']));
});

it('names who changed the shared book from the listed grants and opens the changed source', async () => {
  fixture.results.grants = [{ id: 'grant', owner_id: '22222222-2222-4222-8222-222222222222', member_id: '11111111-1111-4111-8111-111111111111', active: true, can_correct: true, owner_name: 'Shared owner', member_name: 'Reviewer' }];
  fixture.results.activity = [{ document_id: 'changed-doc', source_filename: 'accounting-source-0241.csv', run_id: 'run', actor_user_id: '22222222-2222-4222-8222-222222222222', method: 'authenticated-record-classification', recorded_at: new Date().toISOString(), records_changed: 2, first_reading: false }];
  await act(async () => root.render(<FinanceDashboard />));
  expect(container.querySelector('.accounting-activity-latest')?.textContent).toBe('Latest Shared owner classified 2 records · accounting-source-0241.csv · just now');
  await act(async () => (container.querySelector('.accounting-activity-list button') as HTMLButtonElement).click());
  expect(container.querySelector('dialog[aria-label="Accounting evidence"]')).not.toBeNull();
});
