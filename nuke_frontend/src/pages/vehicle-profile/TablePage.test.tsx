// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ direct: [] as any[], publicRows: [] as any[], reportedRows: [] as any[], envelope: undefined as unknown,
  directResponse: undefined as any[] | undefined, publicError: null as any, legacyError: null as any, rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  rpc: fixture.rpc,
  from: (table: string) => {
    let kind: string | undefined;
    const query: any = {
      select: () => query,
      eq: (key: string, value: string) => { if (key === 'kind') kind = value; return query; },
      not: () => query, order: () => query, limit: () => query,
      maybeSingle: () => Promise.resolve({ data: { id: 'synthetic-vehicle', year: 1983, make: 'GMC', model: 'Synthetic' }, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === 'observation_sources' ? [{ id: 'synthetic-source', slug: 'synthetic-owner-source' }]
        : kind === 'work_record' && fixture.directResponse ? fixture.directResponse : fixture.direct.filter(r => r.kind === kind), error: null }).then(resolve, reject),
    };
    return query;
  },
} }));
import TablePage from './TablePage';
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.direct = []; fixture.reportedRows = []; fixture.envelope = undefined; fixture.directResponse = undefined; fixture.publicError = null; fixture.legacyError = null;
  fixture.publicRows = [{ observation_id: 'synthetic-work', done_on: '2025-02-03', item: 'Installed bracket', category: 'Fabrication', supplier: 'Synthetic supplier', labor_minutes: 0, build_stage: 'Mock-up' }];
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((_name, args) => Promise.resolve(args.p_include_reported
    ? { data: fixture.envelope ?? { work_records: fixture.publicRows, reported_work: fixture.reportedRows }, error: fixture.publicError }
    : { data: fixture.publicRows, error: fixture.legacyError }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function renderPage() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/vehicle/synthetic-vehicle/table']}><Routes><Route path="/vehicle/:vehicleId/table" element={<TablePage />} /></Routes></MemoryRouter>));
}
async function filter(value: string) {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('vehicle table public build-log reader', () => {
  it('searches permitted work with original ID/date, masked detail and zero labor', async () => {
    await renderPage();
    expect(fixture.rpc).toHaveBeenCalledWith('vehicle_build_log_public', { p_vehicle_id: 'synthetic-vehicle', p_include_reported: true });
    const row = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(row.tagName).toBe('DIV');
    expect(row.querySelector('a')).toBeNull();
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).toContain('Installed bracket · Fabrication · Mock-up · 0 min');
    expect(row.textContent).toContain('Synthetic supplier');
    expect(row.textContent).toContain('Owner-only detail');
    expect(container.textContent).toContain('ingestion times are unavailable');
    expect(container.textContent).not.toContain('TOTAL $');
    await filter('synthetic supplier');
    expect(container.textContent).toContain('SHOWING 1 OF 1');
    await filter('absent supplier');
    expect(container.textContent).toContain('SHOWING 0 OF 1');
  });
  it('keeps an owner-readable row once with its original drill and source', async () => {
    fixture.direct = [{ id: 'synthetic-work', kind: 'work_record', observed_at: '2025-02-03T09:10:00Z', ingested_at: '2025-02-04T10:00:00Z', content_text: 'Synthetic owner detail', source_id: 'synthetic-source', structured_data: { vendor: 'Synthetic supplier', total: 12 } }];
    await renderPage();
    expect(container.querySelectorAll('[data-observation-id="synthetic-work"]')).toHaveLength(1);
    const row = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(row.tagName).toBe('A');
    expect(row.getAttribute('href')).toBe('/vehicle/synthetic-vehicle/observation/synthetic-work');
    expect(row.textContent).toContain('Synthetic owner detail');
    expect(row.textContent).toContain('synthetic-owner-source');
    expect(container.textContent).not.toContain('Owner-only detail');
  });
  it('reports reader failure instead of claiming empty history', async () => {
    fixture.publicError = { message: 'Synthetic RPC failure' };
    await renderPage();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('work history may be incomplete');
    expect(container.querySelector('[data-observation-id]')).toBeNull();
    expect(container.textContent).not.toContain('Synthetic RPC failure');
  });
  it('preserves unknown dates and distinguishes an empty response from failure', async () => {
    fixture.publicRows = [{ observation_id: 'synthetic-undated', done_on: null, item: 'Undated repair', supplier: null, labor_minutes: null }];
    await renderPage();
    expect(container.querySelector('[data-observation-id="synthetic-undated"]')!.textContent).toContain('—');
    expect(container.querySelector('[role="status"]')).toBeNull();
    fixture.publicRows = [];
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPage();
    expect(container.textContent).toContain('SHOWING 0 OF 0');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

const reportedWork = (extra = {}) => ({
  observation_id: '10000000-0000-4000-8000-000000000001', kind: 'activity', report_status: 'publisher_reported_completion',
  occurrence_status: 'unverified', performer_id: null, performer_status: 'unknown', reported_date: '2026-09',
  independent_source: false, intent_status: 'unknown', observed_at_basis: 'source_testimony_recorded_at',
  date_precision: 'month', reported_date_label: 'September 2026',
  performed_clause: 'Work in September 2026 included rebuilding the carburetor',
  source_value: 'Work in September 2026 included rebuilding the carburetor, an inspection at that time recommended replacing the tires.',
  source_observation_id: '20000000-0000-4000-8000-000000000002', source_id: '30000000-0000-4000-8000-000000000003',
  source_url: 'https://example.com/synthetic-publisher-report', source_captured_at: '2026-10-10T08:00:00.123456Z',
  source_recorded_at: '2026-10-10T08:00:01.654321Z', source_capture_sha256: 'a'.repeat(64), source_capture_basis: 'protected_snapshot',
  source_witness_version: 'retained_description_reported_work_v1', observed_at: '2026-10-10T08:00:01.654321Z',
  ingested_at: '2026-10-11T10:00:00.123456Z', confidence_score: 0.6, ...extra,
});

describe('publisher-reported work in the existing table', () => {
  it('shows a v2 whole-sentence report with its month, source and uncertainty, then respects its withdrawal', async () => {
    const sentence = 'The carburetor was rebuilt in September 2026.';
    fixture.publicRows = [];
    fixture.reportedRows = [reportedWork({ source_witness_version: 'retained_description_reported_work_v2', performed_clause: sentence, source_value: sentence })];
    await renderPage();
    const row = container.querySelector('[data-observation-id="10000000-0000-4000-8000-000000000001"]')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('September 2026Reported month');
    expect(row.textContent).toContain('Performer unknown');
    expect(row.textContent).toContain('Completion reportedOccurrence unverified');
    expect(row.querySelector('blockquote')?.textContent).toBe(sentence);
    expect(row.querySelector('a')?.getAttribute('href')).toBe(reportedWork().source_url);
    expect(row.textContent).toContain('Publisher intent: unknown. Independent confirmation is not established.');
    expect(container.textContent).not.toContain('TOTAL $');
    expect(container.querySelector('[role="status"]')).toBeNull();
    // A fresh reader response after parent withdrawal has no report; never synthesize one from the old source.
    fixture.reportedRows = [];
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPage();
    expect(container.querySelector('[data-observation-id]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('SHOWING 0 OF 0');
  });

  it.each([
    { source_witness_version: 'retained_description_reported_work_v3' },
    { source_witness_version: null },
    { performed_clause: 'The carburetor' },
    { occurrence_status: 'confirmed' },
    { performer_status: 'known' },
    { independent_source: true },
    { intent_status: 'confirmed' },
  ])('withholds unknown witnesses, partial v2 sentences and stronger claims (%j)', async change => {
    const sentence = 'The carburetor was rebuilt in September 2026.';
    fixture.reportedRows = [reportedWork({ source_witness_version: 'retained_description_reported_work_v2', performed_clause: sentence, source_value: sentence, ...change })];
    await renderPage();
    expect(container.querySelector('[data-observation-id="10000000-0000-4000-8000-000000000001"]')).toBeNull();
    expect(container.querySelector('[data-observation-id="synthetic-work"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('history may be incomplete');
  });

  it('shows month precision, unknown performer and unverified occurrence beside confirmed work without invented money or labor', async () => {
    fixture.reportedRows = [reportedWork({ vendor: 'UNSUPPORTED VENDOR', labor_minutes: 120, total: 999, lifecycle_status: 'installed' })];
    fixture.direct = [{ id: 'synthetic-paid-work', kind: 'work_record', observed_at: '2025-01-02', structured_data: { total: 12 }, content_text: 'Confirmed synthetic receipt' }];
    await renderPage();
    const report = container.querySelector('[data-observation-id="10000000-0000-4000-8000-000000000001"]')!;
    expect(report.tagName).toBe('DIV');
    expect(report.textContent).toContain('September 2026Reported month');
    expect(report.textContent).toContain('Performer unknown');
    expect(report.textContent).toContain('Completion reportedOccurrence unverified');
    expect(report.textContent).not.toContain('2026-09-01');
    expect(report.textContent).not.toContain('UNSUPPORTED VENDOR');
    expect(report.textContent).not.toContain('120 min');
    expect(report.textContent).not.toContain('Owner-only detail');
    expect(container.textContent).toContain('TOTAL $12');
    expect(container.textContent).not.toContain('TOTAL $1,011');
    expect(container.textContent).toContain('Reported work rows are publisher reports. Repeated captures may describe the same repair');
    const confirmed = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(confirmed.textContent).toContain('2025-02-03');
    expect(confirmed.textContent).toContain('0 min');
    await filter('september 2026');
    expect(container.textContent).toContain('SHOWING 1 OF 3');
  });

  it('keeps recommendations in the original quote and exposes permitted source custody without an inaccessible activity drill', async () => {
    fixture.publicRows = []; fixture.reportedRows = [reportedWork()];
    await renderPage();
    const row = container.querySelector('[data-observation-id]')!, details = row.querySelector('details')!;
    expect(details.querySelector('blockquote')?.textContent).toBe(reportedWork().source_value);
    expect(details.querySelector('summary')?.textContent).toBe('Publisher quotation and source');
    const body = row.cloneNode(true) as HTMLElement; body.querySelector('details')!.remove();
    expect(body.textContent).toContain(reportedWork().performed_clause);
    expect(body.textContent).not.toContain('recommended replacing');
    expect(details.textContent).toContain('Source captured: 2026-10-10T08:00:00.123456Z');
    expect(details.textContent).toContain('Source recorded: 2026-10-10T08:00:01.654321Z');
    expect(details.textContent).toContain('Claim recorded (processing clock): 2026-10-11T10:00:00.123456Z');
    expect(details.textContent).toContain('Claim observed (source recording clock): 2026-10-10T08:00:01.654321Z');
    expect(details.textContent).toContain('These recording clocks do not establish a work date.');
    expect(details.textContent).toContain('Publisher intent: unknown. Independent confirmation is not established.');
    expect(details.textContent).toContain(reportedWork().source_observation_id);
    expect(details.textContent).toContain(reportedWork().source_capture_sha256);
    const audit = details.querySelector('details')!;
    expect(audit.querySelector('summary')?.textContent).toBe('Technical provenance');
    expect(audit.open).toBe(false);
    const primary = details.cloneNode(true) as HTMLElement; primary.querySelector('details')!.remove();
    expect(primary.textContent).not.toContain(reportedWork().source_observation_id);
    expect(primary.textContent).not.toContain(reportedWork().source_capture_sha256);
    expect(row.querySelector('a')?.getAttribute('href')).toBe(reportedWork().source_url);
    expect(row.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(row.querySelector('a[href*="/observation/"]')).toBeNull();
    expect(container.textContent).not.toContain('Dates are recorded work dates');
  });

  it.each([
    { reported_date: '2026-09-01', date_precision: 'day' },
    { reported_date: null, reported_date_label: null },
    { reported_date: '2026-13' },
    { reported_date_label: 'January 2026' },
    { performer_id: '40000000-0000-4000-8000-000000000004', performer_status: 'known' },
    { occurrence_status: 'verified' },
    { confidence_score: 0.61 },
    { independent_source: true },
    { independent_source: undefined },
    { intent_status: 'confirmed' },
    { intent_status: undefined },
    { observed_at_basis: 'work_completed_at' },
    { observed_at_basis: undefined },
    { source_url: 'javascript:alert(1)' },
    { source_value: 'A different source does not support the performed clause.' },
    { source_capture_sha256: null },
    { source_captured_at: 'unknown' },
  ])('withholds malformed or stronger reports and signals incomplete history (%j)', async change => {
    fixture.reportedRows = [reportedWork(change)];
    await renderPage();
    expect(container.querySelector('[data-observation-id="10000000-0000-4000-8000-000000000001"]')).toBeNull();
    expect(container.querySelector('[data-observation-id="synthetic-work"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('history may be incomplete');
  });

  it('lets the typed report win a same-ID direct activity while retaining unrelated activity meaning', async () => {
    fixture.publicRows = []; fixture.reportedRows = [reportedWork()];
    // Simulate already-readable observations at the consumer response boundary;
    // this does not add an activity query or widen the production reader.
    fixture.directResponse = [
      { id: reportedWork().observation_id, kind: 'activity', observed_at: '2026-10-10T08:00:01.654321Z',
        content_text: 'Generic captured activity', structured_data: { vendor: 'UNSUPPORTED PERFORMER', total: 999, lifecycle_status: 'installed' } },
      { id: 'unrelated-activity', kind: 'activity', observed_at: '2026-07-02', content_text: 'Unrelated observed activity', structured_data: {} },
    ];
    await renderPage();
    expect(container.querySelectorAll(`[data-observation-id="${reportedWork().observation_id}"]`)).toHaveLength(1);
    const report = container.querySelector(`[data-observation-id="${reportedWork().observation_id}"]`)!;
    expect(report.textContent).toContain('September 2026Reported month');
    expect(report.textContent).not.toContain('UNSUPPORTED PERFORMER');
    expect(report.textContent).not.toContain('Generic captured activity');
    expect(container.textContent).not.toContain('TOTAL $');
    const unrelated = container.querySelector('[data-observation-id="unrelated-activity"]')!;
    expect(unrelated.textContent).toContain('activity');
    expect(unrelated.textContent).not.toContain('Reported work');
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'activity')).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('falls back only for a missing opt-in overload and marks reported work unavailable', async () => {
    fixture.publicError = { code: 'PGRST202', message: 'Synthetic missing function overload' };
    await renderPage();
    expect(fixture.rpc).toHaveBeenNthCalledWith(1, 'vehicle_build_log_public', { p_vehicle_id: 'synthetic-vehicle', p_include_reported: true });
    expect(fixture.rpc).toHaveBeenNthCalledWith(2, 'vehicle_build_log_public', { p_vehicle_id: 'synthetic-vehicle' });
    expect(container.querySelector('[data-observation-id="synthetic-work"]')?.textContent).toContain('Installed bracket');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Publisher-reported work unavailable');
    expect(container.textContent).not.toContain('Synthetic missing function overload');
  });

  it('keeps permission/transport errors visible without masking them behind a legacy retry', async () => {
    fixture.publicError = { code: '42501', message: 'Synthetic permission failure' };
    await renderPage();
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-observation-id]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('work history may be incomplete');
    expect(container.textContent).not.toContain('Synthetic permission failure');
  });

  it('treats an invalid envelope as unavailable and a valid empty envelope as empty', async () => {
    fixture.envelope = { work_records: [], reported_work: { source_value: 'MALFORMED PAYLOAD' } };
    await renderPage();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('history may be incomplete');
    expect(container.textContent).not.toContain('MALFORMED PAYLOAD');
    fixture.envelope = { work_records: [], reported_work: [] };
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPage();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('SHOWING 0 OF 0');
  });
});
