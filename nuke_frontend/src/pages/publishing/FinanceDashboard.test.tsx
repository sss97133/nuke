// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ results: {} as Record<string, any>, calls: [] as any[], downloads: [] as string[], authChanged: null as null | (() => void) }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: async () => ({ data: { data: { lines: [] } }, error: null }) }, storage: { from(bucket: string) { return { async download(path: string) { fixture.downloads.push(`${bucket}/${path}`); return { data: null, error: new Error('not available') }; } }; } }, auth: { onAuthStateChange(callback: () => void) { fixture.authChanged = callback; return { data: { subscription: { unsubscribe() {} } } }; } }, from(table: string) {
  const call: any = { table }; fixture.calls.push(call);
  const q: any = {
    select(fields: string) { call.fields = fields; return q; },
    eq(field: string, value: unknown) { call.filter = [field, value]; return q; },
    order() { return q; }, limit() { return q; },
    range(a: number, b: number) { call.range = [a, b]; return q; },
    then(resolve: any, reject: any) { return Promise.resolve(fixture.results[table] || { data: [], count: 0, error: null }).then(resolve, reject); },
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
  fixture.calls = []; fixture.results = {}; fixture.downloads = [];
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
  expect(container.textContent).not.toContain('No financial records are visible');
});
it('reads pending concerns independently of vehicle/deal allocation and opens retained interpretations', async () => {
  fixture.results.financial_review_queue = { data: [{ id: 'concern-1', document_id: 'doc-1', concern_type: 'cut_off', priority: 'high', status: 'pending', detail: 'Date requires corroboration' }], count: 201 };
  fixture.results.financial_document_extractions = { data: [{ id: 'revision-1', field_key: 'amount_ttc', value_normalized: 100, extractor: 'synthetic', is_superseded: true, superseded_by: 'revision-2' }], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  expect(container.textContent).toContain('1 of 201 pending concern records across revision history');
  const queueCall = fixture.calls.find(c => c.table === 'financial_review_queue');
  expect(queueCall.filter).toEqual(['status', 'pending']);
  expect(queueCall.range).toEqual([0, 199]);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  expect(container.textContent).toContain('Superseded by revision-2');
  expect(container.textContent).toContain('Interpretations are not posted expenses');
  const evidenceCall = fixture.calls.find(c => c.table === 'financial_document_extractions');
  expect(evidenceCall.filter).toEqual(['document_id', 'doc-1']);
  expect(evidenceCall.fields).not.toContain('value_raw');
  expect(evidenceCall.range).toEqual([0, 199]);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next page')!.click());
  expect(fixture.calls.filter(c => c.table === 'financial_review_queue').at(-1).range).toEqual([200, 399]);
});
it('does not render mixed-currency rollups as a single monetary total', async () => {
  fixture.results.v_financial_deal_flow = { data: [{ deal_number: 'synthetic', mixed_currency: true, invoiced_total: 999, credited_total: 99 }], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  expect(container.textContent).toContain('MIXED CURRENCIES');
  expect(container.textContent).not.toContain('999.00');
});

it('clears private data and evidence selection on session changes', async () => {
  fixture.results.financial_documents = { data: [invoice()], count: 1 };
  await act(async () => root.render(<FinanceDashboard />));
  expect(container.textContent).toContain('Synthetic merchant');
  fixture.results = {};
  await act(async () => fixture.authChanged!());
  expect(container.textContent).not.toContain('Synthetic merchant');
  expect(container.textContent).toContain('No financial records are visible');
});
it('paginates evidence revisions beyond the first page', async () => {
  fixture.results.financial_documents = { data: [invoice()], count: 1 };
  fixture.results.financial_document_extractions = { data: [], count: 250 };
  await act(async () => root.render(<FinanceDashboard />));
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
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  expect(container.textContent).toContain('awaits a hash-linked redaction review');
  expect(container.textContent).toContain('Source display review superseded');
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
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  expect(fixture.downloads).toEqual([`user-documents/${v.storage_path}`]);
  expect(container.textContent).toContain('could not be verified or loaded');
  expect(container.querySelector('img')).toBeNull();
});
